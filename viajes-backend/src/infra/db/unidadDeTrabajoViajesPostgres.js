import { crearOperacionesViajesPostgres } from './repositorioViajesPostgres.js';

// Unidad de trabajo de viajes y ofertas sobre la base `viajes`: un client, BEGIN/COMMIT y
// ROLLBACK ante cualquier error. Todos los bloqueos FOR UPDATE duran hasta el fin de la transacción.
export function crearUnidadDeTrabajoViajesPostgres(pool, opciones = {}) {
  return {
    async ejecutar(trabajo) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await trabajo({ viajes: crearOperacionesViajesPostgres(client, opciones) });
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
