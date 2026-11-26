import { crearUnidadDeTrabajoViajesPostgres } from '../../src/infra/db/unidadDeTrabajoViajesPostgres.js';
import { crearAvanzarEstadoViaje } from '../../src/aplicacion/viajes/avanzarEstadoViaje.js';
import { crearCancelarViaje } from '../../src/aplicacion/viajes/cancelarViaje.js';

// Envuelve los casos de uso de viajes sobre Postgres para tests de integración y concurrencia.
export function crearCasosDeUsoViajesPostgres(pool, opciones = {}) {
  const unidadDeTrabajo = crearUnidadDeTrabajoViajesPostgres(pool, opciones);
  return {
    unidadDeTrabajo,
    avanzarEstado: crearAvanzarEstadoViaje({ unidadDeTrabajo }),
    cancelarViaje: crearCancelarViaje({ unidadDeTrabajo }),
  };
}
