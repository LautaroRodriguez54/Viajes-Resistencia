// Puerto de la billetera. Lo implementan repositorioBilleterasPostgres y repositorioBilleteraEnMemoria.
//
// Operaciones propias (cada una abre y cierra su transacción):
// - registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }, cuerpoCrudo)
//     → { procesado, duplicado }. Un evento repetido no acredita dos veces.
// - consultarSaldoPorPasajero(pasajeroId) → { saldoCentavos }. Lanza BILLETERA_NO_ENCONTRADA.
//
// Operación dentro de la unidad de trabajo del cobro (ver unidadDeTrabajoCobro.js):
// - cobrar({ pasajeroId, viajeId, importeCentavos }) → { cobrado }.
//     Bloquea la billetera del pasajero hasta el fin de la transacción, así dos cobros del mismo
//     pasajero van de a uno. Aplica decidirCobro: nunca parcial e importe 0 sin consumo.
//     Lanza BILLETERA_NO_ENCONTRADA. Cuando la billetera tenga su propia base (rama 7) la firma
//     sigue igual: cambia sólo quién abre la transacción.
export const repositorioBilletera = Object.freeze({
  registrarCargaDesdeWebhook: 'registrarCargaDesdeWebhook',
  consultarSaldoPorPasajero: 'consultarSaldoPorPasajero',
  cobrar: 'cobrar',
});
