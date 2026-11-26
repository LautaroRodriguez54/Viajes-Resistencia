import { ErrorDeDominio } from '../../dominio/errores.js';

// Proyección de saldos (tema 13, ADR 009) sobre la base `lectura`. La alimentan los eventos del
// outbox de la billetera (BilleteraCreada, MovimientoRegistrado) y la lee GET /billetera/me.
// - Es sólo para mostrar: el cobro decide siempre sumando los movimientos en la base `billetera`.
// - Deduplicada por id de evento: si un evento llega dos veces, la segunda no suma (tema 3).
// - El orden no importa: cada evento suma o resta un importe, y la suma es la misma en cualquier
//   orden. Por eso no hace falta una versión por billetera.
// - Se puede reconstruir desde cero reproduciendo el outbox (`npm run proyecciones:reconstruir`).
export function crearProyectorSaldosPostgres(pool) {
  function variacion(evento) {
    const { tipo, importeCentavos } = evento.datos;
    if (tipo === 'carga') return importeCentavos;
    if (tipo === 'consumo') return -importeCentavos;
    throw new Error(`Movimiento desconocido en el evento ${evento.id}: ${tipo}`);
  }

  return {
    async aplicar(evento) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const nuevo = await client.query('INSERT INTO eventos_aplicados (evento_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING evento_id', [evento.id]);
        if (nuevo.rowCount > 0) {
          const { pasajeroId } = evento.datos;
          if (evento.tipo === 'BilleteraCreada') {
            await client.query('INSERT INTO saldos (pasajero_id) VALUES ($1) ON CONFLICT DO NOTHING', [pasajeroId]);
          } else if (evento.tipo === 'MovimientoRegistrado') {
            await client.query(
              `INSERT INTO saldos (pasajero_id, saldo_centavos) VALUES ($1, $2)
               ON CONFLICT (pasajero_id) DO UPDATE
               SET saldo_centavos = saldos.saldo_centavos + EXCLUDED.saldo_centavos, actualizado_at = now()`,
              [pasajeroId, variacion(evento)],
            );
          }
        }
        await client.query('COMMIT');
        return { aplicado: nuevo.rowCount > 0 };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async consultarSaldoPorPasajero(pasajeroId) {
      const { rows } = await pool.query('SELECT saldo_centavos FROM saldos WHERE pasajero_id = $1', [pasajeroId]);
      if (!rows[0]) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
      return { saldoCentavos: Number(rows[0].saldo_centavos) };
    },

    // Para reconstruir: borra la proyección y lo aplicado. Después se reproduce el outbox entero.
    async reiniciar() {
      await pool.query('TRUNCATE saldos, eventos_aplicados');
    },
  };
}
