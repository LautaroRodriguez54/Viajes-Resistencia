import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// Acepta una oferta pendiente y asigna el viaje al chofer en una sola transacción,
// manteniendo el orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
export function crearAceptarOferta({ unidadDeTrabajo }) {
  return async function aceptarOferta({ ofertaId, choferId }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      const referencia = await viajes.buscarReferenciaOferta(ofertaId);
      if (!referencia) {
        throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
      }
      if (referencia.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
      }

      const viaje = await viajes.bloquearViaje(referencia.viajeId);
      const ofertas = await viajes.bloquearOfertasDelViaje(referencia.viajeId, ofertaId);
      const actual = ofertas.find((fila) => fila.id === ofertaId);
      if (!actual) {
        throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
      }
      if (actual.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
      }
      if (actual.estado !== 'pendiente' || actual.vencida) {
        throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'La oferta venció o ya fue respondida.');
      }
      if (!viaje || viaje.estado !== EstadoViaje.SOLICITADO) {
        throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya no puede asignarse.');
      }

      const chofer = await viajes.bloquearChofer(choferId);
      if (!chofer?.habilitado) {
        throw new ErrorDeDominio('CHOFER_NO_HABILITADO', 'El chofer no está habilitado.');
      }
      if (chofer.tieneViajeActivo) {
        throw new ErrorDeDominio('CHOFER_CON_VIAJE_ACTIVO', 'El chofer ya tiene un viaje activo.');
      }
      if (!chofer.disponible) {
        throw new ErrorDeDominio('CHOFER_NO_DISPONIBLE', 'El chofer no está disponible.');
      }

      await viajes.registrarAceptacionOferta({
        viajeId: referencia.viajeId,
        ofertaId,
        choferId,
      });
      return {
        viajeId: referencia.viajeId,
        ofertaId,
        estado: EstadoViaje.ASIGNADO,
      };
    });
  };
}
