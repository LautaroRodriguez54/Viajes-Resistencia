// Adaptador de `claves_idempotencia` (001_inicial.sql). Cada fila recuerda una
// intención HTTP de un actor: (actor_id, ambito, clave) es único, así que dos
// pedidos con la misma clave no pueden reservarla a la vez.
const INTENTOS_RESERVA = 3;

function aReserva(fila) {
  return {
    nueva: false,
    id: fila.id,
    requestSha256: fila.request_sha256,
    estado: fila.estado,
    respuestaStatus: fila.respuesta_status,
    respuestaCuerpo: fila.respuesta_body,
  };
}

export function crearRepositorioIdempotenciaPostgres(pool) {
  return {
    // Reserva la clave en estado `procesando` o devuelve la fila que ya existe.
    // Una clave vencida (created_at + TTL) se borra antes y se trata como nueva.
    async reservar({ actorId, ambito, clave, requestSha256, ttlSegundos }) {
      await pool.query(
        `DELETE FROM claves_idempotencia
         WHERE actor_id = $1 AND ambito = $2 AND clave = $3
           AND created_at <= now() - ($4::integer * interval '1 second')`,
        [actorId, ambito, clave, ttlSegundos],
      );
      // El INSERT y el SELECT van en sentencias separadas: si entre las dos otro
      // pedido libera la clave (respuesta 5xx), el SELECT no encuentra nada y se
      // vuelve a intentar la reserva.
      for (let intento = 0; intento < INTENTOS_RESERVA; intento += 1) {
        const insertada = await pool.query(
          `INSERT INTO claves_idempotencia (actor_id, ambito, clave, request_sha256, estado)
           VALUES ($1, $2, $3, $4, 'procesando')
           ON CONFLICT (actor_id, ambito, clave) DO NOTHING
           RETURNING id`,
          [actorId, ambito, clave, requestSha256],
        );
        if (insertada.rowCount === 1) return { nueva: true, id: insertada.rows[0].id };

        const existente = await pool.query(
          `SELECT id, request_sha256, estado, respuesta_status, respuesta_body
           FROM claves_idempotencia
           WHERE actor_id = $1 AND ambito = $2 AND clave = $3`,
          [actorId, ambito, clave],
        );
        if (existente.rowCount === 1) return aReserva(existente.rows[0]);
      }
      throw new Error('No se pudo reservar la clave de idempotencia.');
    },

    async completar(id, { status, cuerpo }) {
      await pool.query(
        `UPDATE claves_idempotencia
         SET estado = 'completada', respuesta_status = $2, respuesta_body = $3::jsonb, completed_at = now()
         WHERE id = $1 AND estado = 'procesando'`,
        [id, status, JSON.stringify(cuerpo ?? null)],
      );
    },

    // Libera la clave después de un 5xx: el cliente puede reintentar con la misma.
    async liberar(id) {
      await pool.query("DELETE FROM claves_idempotencia WHERE id = $1 AND estado = 'procesando'", [id]);
    },
  };
}
