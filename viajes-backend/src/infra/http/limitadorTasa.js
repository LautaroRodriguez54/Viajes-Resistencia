import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { contexto } from './contexto.js';

/**
 * Crea un middleware de límite de tasa con encabezados estándar IETF (draft-6)
 * y respuesta JSON uniforme incluyendo el requestId del contexto activo.
 */
export function crearLimitador({ ventanaMs, maximo, clavePorPedido }) {
  return rateLimit({
    windowMs: ventanaMs,
    limit: maximo,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    ...(clavePorPedido ? { keyGenerator: clavePorPedido } : {}),
    handler: (_req, res, _next, options) => {
      const requestId = contexto.getStore()?.requestId;
      res.status(options.statusCode).json({ error: { codigo: 'LIMITE_DE_PETICIONES_EXCEDIDO', requestId } });
    },
  });
}

/**
 * Construye los limitadores de tasa para rutas sensibles a abuso o costo de cómputo.
 */
export function crearLimitadores(config = {}) {
  return {
    login: crearLimitador({
      ventanaMs: config.RATE_LIMIT_LOGIN_VENTANA_MS ?? 900_000,
      maximo: config.RATE_LIMIT_LOGIN_MAX ?? 10,
    }),
    webhook: crearLimitador({
      ventanaMs: config.RATE_LIMIT_WEBHOOK_VENTANA_MS ?? 60_000,
      maximo: config.RATE_LIMIT_WEBHOOK_MAX ?? 60,
    }),
    ubicacion: crearLimitador({
      ventanaMs: config.RATE_LIMIT_UBICACION_VENTANA_MS ?? 60_000,
      maximo: config.RATE_LIMIT_UBICACION_MAX ?? 60,
      clavePorPedido: (req) => (req.autenticacion?.usuarioId ? `chofer:${req.autenticacion.usuarioId}` : ipKeyGenerator(req.ip ?? '0.0.0.0')),
    }),
  };
}
