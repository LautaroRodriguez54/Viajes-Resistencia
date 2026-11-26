import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const contexto = new AsyncLocalStorage();

const PATRON_REQUEST_ID = /^[\x21-\x7e]{1,128}$/;

function obtenerRequestId(req) {
  const entrante = req.get('x-request-id');
  if (typeof entrante === 'string' && PATRON_REQUEST_ID.test(entrante)) return entrante;
  return crypto.randomUUID();
}

export function crearContextoPorPedido(logger) {
  return (req, res, next) => {
    const requestId = obtenerRequestId(req);
    const startedAt = process.hrtime.bigint();
    res.setHeader('x-request-id', requestId);

    if (logger) {
      res.on('finish', () => {
        const duracionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2));
        const datos = {
          requestId,
          metodo: req.method,
          ruta: (req.originalUrl ?? req.url ?? '').split('?')[0],
          status: res.statusCode,
          duracionMs,
        };
        if (res.statusCode >= 500) logger.error(datos, 'pedido http');
        else if (res.statusCode >= 400) logger.warn(datos, 'pedido http');
        else logger.info(datos, 'pedido http');
      });
    }

    contexto.run({ requestId, startedAt }, next);
  };
}

export function contextoPorPedido(req, res, next) {
  return crearContextoPorPedido()(req, res, next);
}
