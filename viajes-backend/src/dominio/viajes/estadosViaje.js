import { ErrorDeDominio } from '../errores.js';
import { Rol } from '../usuarios/roles.js';

// Estados requeridos por el enunciado. El tratamiento de pago pendiente se decide en docs/modelo.md.
export const EstadoViaje = Object.freeze({
  SOLICITADO: 'solicitado',
  ASIGNADO: 'asignado',
  CHOFER_EN_CAMINO: 'chofer_en_camino',
  EN_CURSO: 'en_curso',
  FINALIZADO: 'finalizado',
  PAGO_PENDIENTE: 'pago_pendiente',
  CANCELADO_PASAJERO: 'cancelado_pasajero',
  CANCELADO_CHOFER: 'cancelado_chofer',
  CANCELADO_OPERADOR: 'cancelado_operador',
  SIN_CHOFERES_DISPONIBLES: 'sin_choferes_disponibles',
});

export const ESTADOS_ACTIVOS_OPERADOR = Object.freeze([
  EstadoViaje.SOLICITADO,
  EstadoViaje.ASIGNADO,
  EstadoViaje.CHOFER_EN_CAMINO,
  EstadoViaje.EN_CURSO,
  EstadoViaje.PAGO_PENDIENTE,
]);

export const ESTADOS_CON_CHOFER_ACTIVO = Object.freeze([
  EstadoViaje.ASIGNADO,
  EstadoViaje.CHOFER_EN_CAMINO,
  EstadoViaje.EN_CURSO,
]);

const CANCELABLES_PASAJERO = new Set([
  EstadoViaje.SOLICITADO,
  EstadoViaje.ASIGNADO,
  EstadoViaje.CHOFER_EN_CAMINO,
]);

const CANCELABLES_CHOFER = new Set([
  EstadoViaje.ASIGNADO,
  EstadoViaje.CHOFER_EN_CAMINO,
]);

const CANCELABLES_OPERADOR = new Set([
  EstadoViaje.SOLICITADO,
  EstadoViaje.ASIGNADO,
  EstadoViaje.CHOFER_EN_CAMINO,
  EstadoViaje.EN_CURSO,
]);

function normalizarMotivo(motivo, obligatorio) {
  if (motivo === null || motivo === undefined) {
    if (obligatorio) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación es obligatorio.');
    return null;
  }
  if (typeof motivo !== 'string') {
    throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación debe ser texto.');
  }
  const limpio = motivo.trim();
  if (limpio.length === 0) {
    if (obligatorio) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación es obligatorio.');
    return null;
  }
  if (obligatorio && limpio.length < 3) {
    throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación debe tener al menos 3 caracteres.');
  }
  if (limpio.length > 200) {
    throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación no puede superar 200 caracteres.');
  }
  return limpio;
}

export function decidirCancelacion({ estadoActual, rol, motivo = null }) {
  switch (rol) {
    case Rol.PASAJERO: {
      if (!CANCELABLES_PASAJERO.has(estadoActual)) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'El viaje no puede cancelarse en su estado actual.');
      }
      return {
        nuevoEstado: EstadoViaje.CANCELADO_PASAJERO,
        motivo: normalizarMotivo(motivo, false),
        liberarChofer: estadoActual !== EstadoViaje.SOLICITADO,
      };
    }
    case Rol.CHOFER: {
      if (!CANCELABLES_CHOFER.has(estadoActual)) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'El viaje no puede cancelarse en su estado actual.');
      }
      return {
        nuevoEstado: EstadoViaje.CANCELADO_CHOFER,
        motivo: normalizarMotivo(motivo, false),
        liberarChofer: false,
      };
    }
    case Rol.OPERADOR: {
      if (!CANCELABLES_OPERADOR.has(estadoActual)) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'El viaje no puede cancelarse en su estado actual.');
      }
      return {
        nuevoEstado: EstadoViaje.CANCELADO_OPERADOR,
        motivo: normalizarMotivo(motivo, true),
        liberarChofer: ESTADOS_CON_CHOFER_ACTIVO.includes(estadoActual),
      };
    }
    default:
      throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'El rol no tiene permiso para cancelar viajes.');
  }
}
