import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// Procesa viajes con ofertas pendientes vencidas: marca vencidas las expiradas y re-ofrece
// al siguiente candidato o pasa el viaje a sin_choferes_disponibles.
export function crearProcesarOfertasVencidas({ unidadDeTrabajo }) {
  return async function procesarOfertasVencidas({ maxPorVuelta = 100 } = {}) {
    const resultados = [];
    for (let i = 0; i < maxPorVuelta; i += 1) {
      const vuelta = await unidadDeTrabajo.ejecutar(async ({ viajes }) => {
        const viaje = await viajes.bloquearSiguienteViajeConOfertaVencida();
        if (!viaje) return { encontrada: false };

        const ofertas = await viajes.bloquearOfertasDelViaje(viaje.id);
        const vencidas = ofertas.filter((fila) => fila.vencida);
        const vigentes = ofertas.filter((fila) => !fila.vencida);
        if (vencidas.length === 0) return { encontrada: true, procesada: false };

        await viajes.marcarOfertasVencidas(viaje.id, vencidas);

        let viajeEstado = viaje.estado;
        let reofrecida = false;
        let nuevaOferta = null;
        if (viajeEstado === EstadoViaje.SOLICITADO && vigentes.length === 0) {
          nuevaOferta = await viajes.seleccionarYCrearOferta({
            viajeId: viaje.id,
            origen: viaje.origen,
            estadosExcluidos: ['pendiente', 'rechazada', 'vencida'],
          });
          if (nuevaOferta) {
            reofrecida = true;
          } else {
            await viajes.marcarViajeSinChoferesDisponibles(viaje.id, {
              motivo: 'sin_candidatos_tras_vencimiento',
              ofertasVencidas: vencidas.map((fila) => fila.id),
            });
            viajeEstado = EstadoViaje.SIN_CHOFERES_DISPONIBLES;
          }
        }

        return {
          encontrada: true,
          procesada: true,
          resultado: { viajeId: viaje.id, vencidas: vencidas.length, reofrecida, viajeEstado, nuevaOferta },
        };
      });

      if (!vuelta.encontrada) break;
      if (vuelta.procesada) resultados.push(vuelta.resultado);
    }
    return resultados;
  };
}
