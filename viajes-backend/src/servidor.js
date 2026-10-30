import { componerAplicacion } from './composicion.js';

const { app, config, logger, cerrar } = componerAplicacion();
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'servidor iniciado'));

let apagando = false;
async function apagar(signal) {
  if (apagando) return;
  apagando = true;
  logger.info({ signal }, 'inicio de apagado ordenado');
  const limite = setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS).unref();
  server.close(async () => {
    await cerrar();
    clearTimeout(limite);
    logger.info('apagado completo');
    process.exit(0);
  });
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

