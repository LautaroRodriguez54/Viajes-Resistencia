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
  SIN_CHOFERES_DISPONIBLES: 'sin_choferes_disponibles',
});

