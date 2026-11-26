// Puerto de la unidad de trabajo del cobro. Lo implementan unidadDeTrabajoCobroPostgres y
// unidadDeTrabajoCobroEnMemoria.
//
// ejecutar(trabajo): corre `trabajo({ viajes, billetera })` en UNA sola transacción. Si `trabajo`
// lanza, no queda nada escrito (ni el consumo ni el cambio de estado). Los bloqueos se sueltan
// recién al terminar, así que el orden en que el caso de uso llama a los puertos es el orden de
// bloqueo: primero el viaje, después la billetera (ver viajes-backend/CLAUDE.md).
//
// `viajes`, sólo lo que necesita el cobro:
// - bloquearParaCobro(viajeId) → { id, estado, pasajeroId, choferId, estimacionCentavos,
//     tarifaFinalCentavos } o null. Bloquea el viaje hasta el fin de la transacción.
// - registrarFinalizacion(viajeId, { estado, tarifaFinalCentavos }): finalizado o pago_pendiente,
//     con su evento cobro_confirmado o cobro_pendiente.
// - registrarPagoDeDeuda(viajeId, { importeCentavos }): de pago_pendiente a finalizado, con el
//     evento cobro_confirmado { reintento: true }.
//
// `billetera`: cobrar({ pasajeroId, viajeId, importeCentavos }) → { cobrado } (ver repositorioBilletera.js).
//
// En la rama 7 la billetera pasa a su propia base y sale de esta unidad de trabajo: el cobro deja
// de ser una transacción única y el caso de uso pasa al flujo pago_pendiente → cobrar → finalizado.
export const unidadDeTrabajoCobro = Object.freeze({
  ejecutar: 'ejecutar',
});
