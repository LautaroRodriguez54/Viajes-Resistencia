import { crearUnidadDeTrabajoViajesPostgres } from '../../src/infra/db/unidadDeTrabajoViajesPostgres.js';
import { crearAvanzarEstadoViaje } from '../../src/aplicacion/viajes/avanzarEstadoViaje.js';
import { crearCancelarViaje } from '../../src/aplicacion/viajes/cancelarViaje.js';
import { crearAceptarOferta } from '../../src/aplicacion/viajes/aceptarOferta.js';
import { crearOfrecerAlChoferCercano } from '../../src/aplicacion/viajes/ofrecerAlChoferCercano.js';
import { crearRechazarOferta } from '../../src/aplicacion/viajes/rechazarOferta.js';
import { crearProcesarOfertasVencidas } from '../../src/aplicacion/viajes/procesarOfertasVencidas.js';

// Envuelve los casos de uso de viajes sobre Postgres para tests de integración y concurrencia.
export function crearCasosDeUsoViajesPostgres(pool, opciones = {}) {
  const unidadDeTrabajo = crearUnidadDeTrabajoViajesPostgres(pool, opciones);
  return {
    unidadDeTrabajo,
    avanzarEstado: crearAvanzarEstadoViaje({ unidadDeTrabajo }),
    cancelarViaje: crearCancelarViaje({ unidadDeTrabajo }),
    aceptarOferta: crearAceptarOferta({ unidadDeTrabajo }),
    ofrecerAlChoferCercano: crearOfrecerAlChoferCercano({ unidadDeTrabajo }),
    rechazarOferta: crearRechazarOferta({ unidadDeTrabajo }),
    procesarOfertasVencidas: crearProcesarOfertasVencidas({ unidadDeTrabajo }),
  };
}
