// Despachador periódico de vencimiento de ofertas: marca vencidas las ofertas expiradas
// y re-ofrece al siguiente candidato o pasa el viaje a sin_choferes_disponibles.
export function crearDespachadorVencimientoOfertas({ procesarOfertasVencidas, logger, intervaloMs = 1_000 }) {
  if (typeof procesarOfertasVencidas !== 'function') {
    throw new Error('Falta la función procesarOfertasVencidas.');
  }
  let temporizador = null;
  let vuelta = Promise.resolve();
  let activo = false;

  async function ejecutarVuelta() {
    return procesarOfertasVencidas();
  }

  function programar() {
    if (!activo) return;
    temporizador = setTimeout(() => {
      vuelta = ejecutarVuelta()
        .catch((error) => logger?.error({ err: error }, 'falló el vencimiento automático de ofertas; se reintenta'))
        .finally(programar);
    }, intervaloMs);
    temporizador.unref?.();
  }

  return {
    ejecutarVuelta,
    iniciar() {
      if (activo) return;
      activo = true;
      programar();
    },
    async detener() {
      activo = false;
      clearTimeout(temporizador);
      await vuelta;
    },
  };
}
