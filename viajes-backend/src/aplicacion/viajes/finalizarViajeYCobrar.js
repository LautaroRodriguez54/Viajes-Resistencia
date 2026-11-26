import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';
import { cobrarViajePendiente } from './cobrarViajePendiente.js';

const loggerMudo = { warn() {} };

// El chofer finaliza un viaje en curso y se le cobra al pasajero, en dos pasos (ADR 008):
//   1. en `viajes`: en_curso → pago_pendiente con la tarifa final (COMMIT);
//   2. cobrarViajePendiente: con el viaje bloqueado, la billetera cobra; si sale, → finalizado.
// Si el paso 2 no llega (caída, billetera sin responder, saldo insuficiente), el viaje queda en
// pago_pendiente y se cobra con el reintento del pasajero.
export function crearFinalizarViajeYCobrar({ unidadDeTrabajo, billetera, logger = loggerMudo }) {
  return async function finalizarViajeYCobrar({ viajeId, choferId }) {
    const esDelChofer = (viaje) => {
      if (!viaje || viaje.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
      }
    };

    await unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      const viaje = await viajes.bloquearParaCobro(viajeId);
      esDelChofer(viaje);
      if (viaje.estado !== EstadoViaje.EN_CURSO) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Sólo un viaje en curso puede finalizar.');
      }
      // Hasta tener recorrido y duración reales, la tarifa final es la estimación.
      await viajes.registrarCobroSolicitado(viajeId, { tarifaFinalCentavos: viaje.estimacionCentavos });
    });

    return cobrarViajePendiente({ unidadDeTrabajo, billetera, logger }, { viajeId, verificar: esDelChofer, estricto: false });
  };
}
