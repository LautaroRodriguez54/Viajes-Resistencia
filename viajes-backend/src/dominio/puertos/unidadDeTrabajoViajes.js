// Puerto de la unidad de trabajo para el ciclo de vida de viajes y ofertas.
// Lo implementan unidadDeTrabajoViajesPostgres y unidadDeTrabajoViajesEnMemoria.
//
// ejecutar(trabajo): corre `trabajo({ viajes })` dentro de UNA transacción en la base `viajes`.
// Si `trabajo` lanza un error, no queda nada persistido.
//
// Operaciones de `viajes` (se amplían por slice manteniendo el orden global de bloqueos
// viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer):
// - bloquearViaje(viajeId) -> { id, estado, pasajeroId, choferId, origen } | null
// - actualizarEstadoViaje(viajeId, { nuevoEstado, registrarInicio })
// - vencerOfertasPendientesDelViaje(viajeId)
// - liberarChoferSiHabilitado(choferId)
// - registrarCancelacionViaje(viajeId, { nuevoEstado, actorId, motivo })
//     -> { viajeId, estado, canceladoAt, motivo }
// - registrarEventoViaje(viajeId, tipo, datos)
// - buscarReferenciaOferta(ofertaId) -> { id, viajeId, choferId } | null
// - bloquearOfertasDelViaje(viajeId, ofertaId?) -> [{ id, viajeId, choferId, estado, vencida }]
// - bloquearChofer(choferId) -> { habilitado, disponible, tieneViajeActivo } | null
// - registrarAceptacionOferta({ viajeId, ofertaId, choferId })
// - bloquearViajeSolicitadoDelPasajero(viajeId, pasajeroId) -> { id, origen } | null
// - vencerOfertasExpiradasDelViaje(viajeId) -> [{ id, choferId }]
// - seleccionarYCrearOferta({ viajeId, origen, estadosExcluidos })
//     -> { ofertaId, choferId, venceAt } | null
// - marcarOfertaRechazada({ viajeId, ofertaId, choferId })
// - marcarOfertasVencidas(viajeId, ofertasVencidas)
// - marcarViajeSinChoferesDisponibles(viajeId, datosEvento)
// - bloquearSiguienteViajeConOfertaVencida() -> { id, estado, origen } | null
export const unidadDeTrabajoViajes = Object.freeze({
  ejecutar: 'ejecutar',
});
