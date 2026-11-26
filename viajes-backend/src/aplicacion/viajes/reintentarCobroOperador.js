import { ErrorDeDominio } from '../../dominio/errores.js';
import { cobrarViajePendiente } from './cobrarViajePendiente.js';

const loggerMudo = { warn() {} };

// Reintento de cobro iniciado por un operador sobre cualquier viaje en `pago_pendiente`.
export function crearReintentarCobroOperador({ unidadDeTrabajo, billetera, logger = loggerMudo }) {
  return function reintentarCobroOperador({ viajeId }) {
    const existe = (viaje) => {
      if (!viaje) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe.');
      }
    };
    return cobrarViajePendiente({ unidadDeTrabajo, billetera, logger }, { viajeId, verificar: existe, estricto: true });
  };
}
