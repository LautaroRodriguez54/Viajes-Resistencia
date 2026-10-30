import crypto from 'node:crypto';
import { ErrorDeDominio } from '../../dominio/errores.js';

export function crearRepositorioBilleterasPostgres(pool) {
  return {
    async registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }, cuerpoCrudo) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
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
          await client.query('COMMIT');
          return { procesado: false, duplicado: true, estado: existente.rows[0].estado };
        }

        const billetera = await client.query(
          'SELECT id FROM billeteras WHERE pasajero_id = $1 FOR UPDATE',
          [pasajeroId],
        );
        if (billetera.rowCount === 0) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');

        await client.query(
          `INSERT INTO movimientos_billetera (billetera_id, tipo, importe_centavos, referencia_externa)
           VALUES ($1, 'carga', $2, $3)`,
          [billetera.rows[0].id, importeCentavos, eventoExternoId],
        );
        await client.query(
          `UPDATE eventos_webhook_pago
           SET estado = 'procesado', procesado_at = now()
           WHERE id = $1`,
          [evento.rows[0].id],
        );
        await client.query('COMMIT');
        return { procesado: true, duplicado: false };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

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
  };
}

