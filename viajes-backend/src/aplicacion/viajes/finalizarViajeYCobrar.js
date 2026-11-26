import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// El chofer finaliza un viaje en curso y se cobra al pasajero, todo en una transacción.
// Orden de bloqueo: primero el viaje, después la billetera (el mismo que reintentarCobro).
export function crearFinalizarViajeYCobrar({ unidadDeTrabajo }) {
  return function finalizarViajeYCobrar({ viajeId, choferId }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes, billetera }) => {
      const viaje = await viajes.bloquearParaCobro(viajeId);
      if (!viaje || viaje.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
      }
      if (viaje.estado !== EstadoViaje.EN_CURSO) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Sólo un viaje en curso puede finalizar.');
      }

      // Hasta tener recorrido y duración reales, la tarifa final es la estimación.
      const importeCentavos = viaje.estimacionCentavos;
      const { cobrado } = await billetera.cobrar({ pasajeroId: viaje.pasajeroId, viajeId, importeCentavos });
      const estado = cobrado ? EstadoViaje.FINALIZADO : EstadoViaje.PAGO_PENDIENTE;
      await viajes.registrarFinalizacion(viajeId, { estado, tarifaFinalCentavos: importeCentavos });
      return { viajeId, estado, importeCentavos };
    });
  };
}
