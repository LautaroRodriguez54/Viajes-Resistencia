import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const contexto = new AsyncLocalStorage();

export function contextoPorPedido(req, res, next) {
  const requestId = req.get('x-request-id') ?? crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  contexto.run({ requestId, startedAt: process.hrtime.bigint() }, next);
}

