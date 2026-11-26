// Puerto de la billetera. Lo implementan repositorioBilleterasPostgres (base `billetera`) y
// repositorioBilleteraEnMemoria. Cada operación abre y cierra su propia transacción.
//
// - registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }, cuerpoCrudo)
//     → { procesado, duplicado }. Un evento repetido no acredita dos veces.
// - consultarSaldoPorPasajero(pasajeroId) → { saldoCentavos }, sumando los movimientos.
//     Lanza BILLETERA_NO_ENCONTRADA. La pantalla lee la proyección (base `lectura`), no esto.
// - cobrar({ pasajeroId, viajeId, importeCentavos }) → { cobrado }.
//     Bloquea la billetera del pasajero, así dos cobros del mismo pasajero van de a uno. Aplica
//     decidirCobro (nunca parcial; importe 0 sin consumo). Idempotente por viajeId: si el viaje ya
//     tiene su consumo, devuelve cobrado sin debitar otra vez. Lanza BILLETERA_NO_ENCONTRADA.
// - crearBilleteraPorEvento({ eventoId, pasajeroId }) → { creada, duplicado }: consumidor del
//     evento UsuarioRegistrado, deduplicado por eventoId.
export const repositorioBilletera = Object.freeze({
  registrarCargaDesdeWebhook: 'registrarCargaDesdeWebhook',
  consultarSaldoPorPasajero: 'consultarSaldoPorPasajero',
  cobrar: 'cobrar',
  crearBilleteraPorEvento: 'crearBilleteraPorEvento',
});
