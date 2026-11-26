// Puerto de la unidad de trabajo del cobro. Lo implementan unidadDeTrabajoCobroPostgres y
// unidadDeTrabajoCobroEnMemoria.
//
// ejecutar(trabajo): corre `trabajo({ viajes })` en UNA transacción de la base `viajes`. Si
// `trabajo` lanza, no queda nada escrito en `viajes`. El bloqueo del viaje dura hasta el final.
//
// `viajes`, sólo lo que necesita el cobro:
// - bloquearParaCobro(viajeId) → { id, estado, pasajeroId, choferId, estimacionCentavos,
//     tarifaFinalCentavos } o null. Bloquea el viaje hasta el fin de la transacción.
// - registrarCobroSolicitado(viajeId, { tarifaFinalCentavos }): en_curso → pago_pendiente.
// - registrarCobroConfirmado(viajeId, { importeCentavos, reintento }): pago_pendiente → finalizado.
// - registrarCobroPendiente(viajeId, { importeCentavos, motivo }): sigue pago_pendiente, con el motivo.
//
// La billetera ya no está en esta unidad de trabajo (rama 7, ADR 008): vive en su propia base y
// `billetera.cobrar` abre su propia transacción (ver repositorioBilletera.js). El caso de uso la
// llama con el viaje bloqueado, así el orden de bloqueo sigue siendo viaje → billetera.
export const unidadDeTrabajoCobro = Object.freeze({
  ejecutar: 'ejecutar',
});
