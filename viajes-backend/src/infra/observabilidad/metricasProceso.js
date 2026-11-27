import { monitorEventLoopDelay } from 'node:perf_hooks';

const NANOSEGUNDOS_POR_MILISEGUNDO = 1_000_000;
const BYTES_POR_MEBIBYTE = 1024 * 1024;

function redondear(valor) {
  return Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0;
}

function nsAMs(nanosegundos) {
  if (!Number.isFinite(nanosegundos) || nanosegundos < 0) return 0;
  return redondear(nanosegundos / NANOSEGUNDOS_POR_MILISEGUNDO);
}

function bytesAMib(bytes) {
  return redondear(bytes / BYTES_POR_MEBIBYTE);
}

/**
 * Mide el lag del event loop (con `monitorEventLoopDelay`) y el uso de memoria
 * del proceso Node para exponerlos en `GET /admin/metricas`.
 */
export function crearMetricasProceso({ resolucionMs = 20 } = {}) {
  const monitor = monitorEventLoopDelay({ resolution: resolucionMs });
  monitor.enable();

  return {
    obtenerInstantanea({ reiniciar = false } = {}) {
      const memoria = process.memoryUsage();
      const instantanea = {
        eventLoopLagMs: {
          min: nsAMs(monitor.min),
          max: nsAMs(monitor.max),
          media: nsAMs(monitor.mean),
          p50: nsAMs(monitor.percentile(50)),
          p95: nsAMs(monitor.percentile(95)),
          p99: nsAMs(monitor.percentile(99)),
        },
        memoriaMb: {
          rss: bytesAMib(memoria.rss),
          heapTotal: bytesAMib(memoria.heapTotal),
          heapUsed: bytesAMib(memoria.heapUsed),
          external: bytesAMib(memoria.external),
        },
        uptimeSegundos: redondear(process.uptime()),
      };
      if (reiniciar) {
        monitor.reset();
      }
      return instantanea;
    },
    cerrar() {
      monitor.disable();
    },
  };
}
