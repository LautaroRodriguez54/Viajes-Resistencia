import crypto from 'node:crypto';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { decidirCobro } from '../../dominio/billetera/billetera.js';

// Adaptador Postgres del puerto repositorioBilletera, sobre el pool de la base `billetera` (tema 12):
// ninguna consulta toca `usuarios` ni `viajes`, que viven en otra base.
// Cada operación que registra un movimiento deja su evento en `outbox_billetera` en la misma
// transacción; de ahí lo toma el proyector de saldos (tema 13).
export function crearRepositorioBilleterasPostgres(pool) {
  async function enTransaccion(trabajo) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resultado = await trabajo(client);
      await client.query('COMMIT');
      return resultado;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function bloquearBilletera(client, pasajeroId) {
    const { rows } = await client.query('SELECT id FROM billeteras WHERE pasajero_id = $1 FOR UPDATE', [pasajeroId]);
    if (!rows[0]) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
    return rows[0].id;
  }

  async function registrarEvento(client, tipo, datos) {
    await client.query('INSERT INTO outbox_billetera (tipo, datos) VALUES ($1, $2::jsonb)', [tipo, JSON.stringify(datos)]);
  }

  return {
    async registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }, cuerpoCrudo) {
      return enTransaccion(async (client) => {
        const payloadSha256 = crypto.createHash('sha256').update(cuerpoCrudo).digest('hex');
        const evento = await client.query(
          `INSERT INTO eventos_webhook_pago
             (proveedor_evento_id, payload, payload_sha256, firma_valida, estado, procesado_at)
           VALUES ($1, $2::jsonb, $3, TRUE, 'recibido', NULL)
           ON CONFLICT (proveedor_evento_id) DO NOTHING
           RETURNING id`,
          [eventoExternoId, cuerpoCrudo.toString('utf8'), payloadSha256],
        );

        if (evento.rowCount === 0) {
          const existente = await client.query(
            'SELECT estado FROM eventos_webhook_pago WHERE proveedor_evento_id = $1',
            [eventoExternoId],
          );
          return { procesado: false, duplicado: true, estado: existente.rows[0].estado };
        }

        const billeteraId = await bloquearBilletera(client, pasajeroId);
        await client.query(
          `INSERT INTO movimientos_billetera (billetera_id, tipo, importe_centavos, referencia_externa)
           VALUES ($1, 'carga', $2, $3)`,
          [billeteraId, importeCentavos, eventoExternoId],
        );
        await registrarEvento(client, 'MovimientoRegistrado', { pasajeroId, tipo: 'carga', importeCentavos });
        await client.query(
          `UPDATE eventos_webhook_pago
           SET estado = 'procesado', procesado_at = now()
           WHERE id = $1`,
          [evento.rows[0].id],
        );
        return { procesado: true, duplicado: false };
      });
    },

    // Saldo del modelo de escritura (suma de movimientos). La pantalla lee la proyección de la base
    // `lectura`; esto queda para verificar que la proyección coincide.
    async consultarSaldoPorPasajero(pasajeroId) {
      const { rows } = await pool.query(
        `SELECT b.id,
                COALESCE(SUM(CASE WHEN m.tipo = 'carga' THEN m.importe_centavos ELSE -m.importe_centavos END), 0) AS saldo_centavos
         FROM billeteras b
         LEFT JOIN movimientos_billetera m ON m.billetera_id = b.id
         WHERE b.pasajero_id = $1
         GROUP BY b.id`,
        [pasajeroId],
      );
      if (!rows[0]) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
      return { saldoCentavos: Number(rows[0].saldo_centavos) };
    },

    // Movimientos del pasajero, del más nuevo al más viejo (GET /billetera/me/movimientos). Se leen
    // de la base `billetera`, que es la fuente de verdad del dinero: sin proyección y sin atraso.
    async listarMovimientosPorPasajero(pasajeroId, { limite }) {
      const billetera = await pool.query('SELECT id FROM billeteras WHERE pasajero_id = $1', [pasajeroId]);
      if (!billetera.rows[0]) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
      const { rows } = await pool.query(
        `SELECT id, tipo, importe_centavos AS "importeCentavos", viaje_id AS "viajeId", created_at AS "creadoAt"
         FROM movimientos_billetera
         WHERE billetera_id = $1
         ORDER BY created_at DESC, id
         LIMIT $2`,
        [billetera.rows[0].id, limite],
      );
      return rows;
    },

    // Cobro con su propia transacción en la base `billetera`.
    // - FOR UPDATE sobre la billetera: dos cobros del mismo pasajero van de a uno y el segundo ve el
    //   consumo del primero (la carrera de la variante D se sigue resolviendo dentro de una sola base).
    // - Idempotente por viajeId (tema 3): si el viaje ya tiene su consumo, devuelve cobrado sin
    //   debitar otra vez. Es lo que hace seguro reintentar después de una caída.
    async cobrar({ pasajeroId, viajeId, importeCentavos }) {
      return enTransaccion(async (client) => {
        const billeteraId = await bloquearBilletera(client, pasajeroId);
        const previo = await client.query(
          "SELECT 1 FROM movimientos_billetera WHERE viaje_id = $1 AND tipo = 'consumo'",
          [viajeId],
        );
        if (previo.rowCount > 0) return { cobrado: true };

        const saldo = await client.query(
          "SELECT COALESCE(SUM(CASE WHEN tipo = 'carga' THEN importe_centavos ELSE -importe_centavos END), 0) AS centavos FROM movimientos_billetera WHERE billetera_id = $1",
          [billeteraId],
        );
        const decision = decidirCobro({ saldoCentavos: Number(saldo.rows[0].centavos), importeCentavos });
        if (decision.generaConsumo) {
          await client.query(
            "INSERT INTO movimientos_billetera (billetera_id, viaje_id, tipo, importe_centavos) VALUES ($1, $2, 'consumo', $3)",
            [billeteraId, viajeId, importeCentavos],
          );
          await registrarEvento(client, 'MovimientoRegistrado', { pasajeroId, tipo: 'consumo', importeCentavos, viajeId });
        }
        return { cobrado: decision.cobrado };
      });
    },

    // Consumidor del evento UsuarioRegistrado (outbox de Viajes). Deduplicado por id de evento:
    // si el despachador lo entrega dos veces, la segunda no hace nada.
    async crearBilleteraPorEvento({ eventoId, pasajeroId }) {
      return enTransaccion(async (client) => {
        const nuevo = await client.query(
          "INSERT INTO eventos_consumidos (evento_id, tipo) VALUES ($1, 'UsuarioRegistrado') ON CONFLICT DO NOTHING RETURNING evento_id",
          [eventoId],
        );
        if (nuevo.rowCount === 0) return { creada: false, duplicado: true };
        const billetera = await client.query(
          'INSERT INTO billeteras (pasajero_id) VALUES ($1) ON CONFLICT (pasajero_id) DO NOTHING RETURNING id',
          [pasajeroId],
        );
        if (billetera.rowCount > 0) await registrarEvento(client, 'BilleteraCreada', { pasajeroId });
        return { creada: billetera.rowCount > 0, duplicado: false };
      });
    },
  };
}
