import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

const ESTADO_ANTERIOR = new Map([
  [EstadoViaje.CHOFER_EN_CAMINO, EstadoViaje.ASIGNADO],
  [EstadoViaje.EN_CURSO, EstadoViaje.CHOFER_EN_CAMINO],
]);

// Avanza el estado de un viaje asignado al chofer (asignado -> chofer_en_camino -> en_curso).
export function crearAvanzarEstadoViaje({ unidadDeTrabajo }) {
  return async function avanzarEstadoViaje({ viajeId, choferId, nuevoEstado }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      const viaje = await viajes.bloquearViaje(viajeId);
      if (!viaje || viaje.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
      }
      if (ESTADO_ANTERIOR.get(nuevoEstado) !== viaje.estado) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'La transición de estado no es válida.');
      }

      await viajes.actualizarEstadoViaje(viajeId, {
        nuevoEstado,
        registrarInicio: nuevoEstado === EstadoViaje.EN_CURSO,
      });
      await viajes.registrarEventoViaje(viajeId, `estado_${nuevoEstado}`);
      return { viajeId, estado: nuevoEstado };
    });
  };
}
