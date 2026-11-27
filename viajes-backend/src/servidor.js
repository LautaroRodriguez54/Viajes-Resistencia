import { componerAplicacion } from './composicion.js';
import { crearManejadorApagado } from './infra/http/apagadoOrdenado.js';

const { app, config, logger, cerrar, iniciarProcesos } = componerAplicacion();
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'servidor iniciado'));
// Despachadores de los outbox (billetera nueva, proyección de saldos). `cerrar` los detiene antes de los pools.
iniciarProcesos();

const apagar = crearManejadorApagado({
  server,
  cerrar,
  logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
});

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

