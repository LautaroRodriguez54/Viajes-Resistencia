import { crearCobroViajesPostgres } from './repositorioViajesPostgres.js';

// Unidad de trabajo del cobro sobre la base `viajes`: un client, un BEGIN/COMMIT y el puerto de
// viajes armado sobre ese client. Si el trabajo lanza, ROLLBACK. El FOR UPDATE del viaje dura hasta
// el COMMIT o el ROLLBACK.
// Desde la rama 7 la billetera NO está acá: vive en otra base y cobra en su propia transacción
// (ADR 008). El caso de uso la llama mientras tiene bloqueado el viaje.
export function crearUnidadDeTrabajoCobroPostgres(pool) {
  return {
    async ejecutar(trabajo) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await trabajo({ viajes: crearCobroViajesPostgres(client) });
        await client.query('COMMIT');
        return resultado;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
