// Apagado ordenado del servidor HTTP ante SIGTERM/SIGINT:
// espera las conexiones en curso, cierra procesos y pools, y loguea si vence el timeout.
export function crearManejadorApagado({
  server,
  cerrar,
  logger,
  timeoutMs,
  salir = (codigo) => process.exit(codigo),
}) {
  let apagando = false;

  return function apagar(signal) {
    if (apagando) return;
    apagando = true;
    logger.info({ signal }, 'inicio de apagado ordenado');

    const limite = setTimeout(() => {
      logger.error({ signal, timeoutMs }, 'tiempo de apagado ordenado agotado; forzando salida');
      salir(1);
    }, timeoutMs);
    limite.unref?.();

    server.close(async (errorCierre) => {
      try {
        if (errorCierre) throw errorCierre;
        await cerrar();
        clearTimeout(limite);
        logger.info({ signal }, 'apagado completo');
        salir(0);
      } catch (error) {
        clearTimeout(limite);
        logger.error({ err: error, signal }, 'error durante el apagado ordenado');
        salir(1);
      }
    });
    server.closeIdleConnections?.();
  };
}
