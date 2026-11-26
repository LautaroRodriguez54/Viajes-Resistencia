import { crearCobroViajesPostgres } from './repositorioViajesPostgres.js';
import { crearCobroBilleteraPostgres } from './repositorioBilleterasPostgres.js';

// Unidad de trabajo del cobro: un solo client, un solo BEGIN/COMMIT, y los dos puertos armados
// sobre ese client. Si el trabajo lanza, ROLLBACK: no queda ni el consumo ni el cambio de estado.
// Los bloqueos (FOR UPDATE) duran hasta el COMMIT o el ROLLBACK.
export function crearUnidadDeTrabajoCobroPostgres(pool) {
  return {
    async ejecutar(trabajo) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await trabajo({
          viajes: crearCobroViajesPostgres(client),
          billetera: crearCobroBilleteraPostgres(client),
        });
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
