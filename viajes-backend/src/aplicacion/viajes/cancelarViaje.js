import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { decidirCancelacion } from '../../dominio/viajes/estadosViaje.js';

// Cancela un viaje aplicando las reglas de dominio por rol (pasajero, chofer u operador),
// venciendo ofertas pendientes y liberando al chofer habilitado cuando corresponde.
export function crearCancelarViaje({ unidadDeTrabajo }) {
  return async function cancelarViaje({ viajeId, actorId, rol, motivo = null }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
      const viaje = await viajes.bloquearViaje(viajeId);
      if (!viaje) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe.');
      }
      if (rol === Rol.PASAJERO && viaje.pasajeroId !== actorId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
      }
      if (rol === Rol.CHOFER && viaje.choferId !== actorId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
      }

      const decision = decidirCancelacion({ estadoActual: viaje.estado, rol, motivo });

      await viajes.vencerOfertasPendientesDelViaje(viajeId);
      if (decision.liberarChofer && viaje.choferId) {
        await viajes.liberarChoferSiHabilitado(viaje.choferId);
      }

      const cancelacion = await viajes.registrarCancelacionViaje(viajeId, {
        nuevoEstado: decision.nuevoEstado,
        actorId,
        motivo: decision.motivo,
      });
      await viajes.registrarEventoViaje(viajeId, decision.nuevoEstado, {
        actorId,
        rol,
        motivo: decision.motivo,
      });
      return cancelacion;
    });
  };
}
