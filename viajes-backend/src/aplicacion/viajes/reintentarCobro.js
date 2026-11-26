import { ErrorDeDominio } from '../../dominio/errores.js';
import { cobrarViajePendiente } from './cobrarViajePendiente.js';

const loggerMudo = { warn() {} };

// Salida de pago_pendiente: el pasajero, después de cargar saldo, paga la deuda del viaje.
// Usa el mismo cobro que el finalizar (orden viaje → billetera), pero estricto: si no se puede
// cobrar, el pasajero recibe el error (SALDO_INSUFICIENTE, BILLETERA_NO_ENCONTRADA...).
export function crearReintentarCobro({ unidadDeTrabajo, billetera, logger = loggerMudo }) {
  return function reintentarCobro({ viajeId, pasajeroId }) {
    const esDelPasajero = (viaje) => {
      if (!viaje || viaje.pasajeroId !== pasajeroId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
      }
    };
    return cobrarViajePendiente({ unidadDeTrabajo, billetera, logger }, { viajeId, verificar: esDelPasajero, estricto: true });
  };
}
