import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// Rechaza una oferta pendiente y, si no queda otra vigente, re-ofrece al siguiente chofer
// elegible o pasa el viaje a sin_choferes_disponibles.
export function crearRechazarOferta({ unidadDeTrabajo }) {
  return async function rechazarOferta({ ofertaId, choferId }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
      const referencia = await viajes.buscarReferenciaOferta(ofertaId);
      if (!referencia) {
        throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
      }
      if (referencia.choferId !== choferId) {
        throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
      }

      // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
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
        throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya no admite respuestas sobre ofertas.');
      }

      await viajes.marcarOfertaRechazada({
        viajeId: referencia.viajeId,
        ofertaId,
        choferId,
      });

      const otrasVencidas = ofertas.filter(
        (fila) => fila.id !== ofertaId && fila.estado === 'pendiente' && fila.vencida,
      );
      if (otrasVencidas.length > 0) {
        await viajes.marcarOfertasVencidas(referencia.viajeId, otrasVencidas);
      }

      const quedaVigente = ofertas.some(
        (fila) => fila.id !== ofertaId && fila.estado === 'pendiente' && !fila.vencida,
      );
      let viajeEstado = viaje.estado;
      let reofrecida = false;
      if (!quedaVigente) {
        const nuevaOferta = await viajes.seleccionarYCrearOferta({
          viajeId: referencia.viajeId,
          origen: viaje.origen,
          estadosExcluidos: ['pendiente', 'rechazada', 'vencida'],
        });
        if (nuevaOferta) {
          reofrecida = true;
        } else {
          await viajes.marcarViajeSinChoferesDisponibles(referencia.viajeId, {
            motivo: 'sin_candidatos_tras_rechazo',
            ofertaId,
          });
          viajeEstado = EstadoViaje.SIN_CHOFERES_DISPONIBLES;
        }
      }

      return {
        viajeId: referencia.viajeId,
        ofertaId,
        estado: 'rechazada',
        viajeEstado,
        reofrecida,
      };
    });
  };
}
