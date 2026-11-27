import { ErrorDeDominio } from '../../dominio/errores.js';
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
        if (error?.code === '23505') {
          if (error.constraint === 'ux_chofer_un_viaje_activo') {
            throw new ErrorDeDominio('CHOFER_CON_VIAJE_ACTIVO', 'El chofer ya tiene un viaje activo.');
          }
          if (error.constraint === 'ux_una_oferta_aceptada_por_viaje') {
            throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya fue asignado a otro chofer.');
          }
          if (error.constraint === 'ux_oferta_pendiente_viaje_chofer') {
            throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'Ya existe una oferta pendiente para ese chofer en este viaje.');
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
