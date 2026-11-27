import { ErrorDeDominio } from '../../dominio/errores.js';

// Busca al chofer elegible más cercano dentro del radio configurado y emite una oferta pendiente.
export function crearOfrecerAlChoferCercano({ unidadDeTrabajo }) {
  return async function ofrecerAlChoferCercano({ viajeId, pasajeroId }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      const viaje = await viajes.bloquearViajeSolicitadoDelPasajero(viajeId, pasajeroId);
      if (!viaje) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no está disponible para recibir ofertas.');
      }

      // Limpia ofertas ya vencidas de este viaje para no bloquear al único chofer disponible en demos.
      await viajes.vencerOfertasExpiradasDelViaje(viajeId);

      const oferta = await viajes.seleccionarYCrearOferta({
        viajeId,
        origen: viaje.origen,
        estadosExcluidos: ['pendiente', 'rechazada'],
      });
      if (!oferta) {
        throw new ErrorDeDominio('SIN_CHOFERES_CERCANOS', 'No hay choferes disponibles en el radio configurado.');
      }
      return oferta;
    });
  };
}
