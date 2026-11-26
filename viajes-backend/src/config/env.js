import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Una base por módulo (tema 12), cada una con su propio rol: viajes, billetera y lectura (proyecciones).
  DATABASE_URL: z.string().url(),
  BILLETERA_DATABASE_URL: z.string().url(),
  LECTURA_DATABASE_URL: z.string().url(),
  // Sólo para `npm run migrate`: superusuario que crea bases, roles y extensiones. La app no lo usa.
  ADMIN_DATABASE_URL: z.string().url().optional(),
  OUTBOX_INTERVALO_MS: z.coerce.number().int().positive().default(500),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Debe tener formato, por ejemplo, 15m.'),
  ARGON2_MEMORY_COST: z.coerce.number().int().positive(),
  ARGON2_TIME_COST: z.coerce.number().int().positive(),
  ARGON2_PARALLELISM: z.coerce.number().int().positive(),
  WEBHOOK_HMAC_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().min(1).transform((value) => value.split(',').map((origin) => origin.trim())),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  RATE_LIMIT_LOGIN_VENTANA_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WEBHOOK_VENTANA_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_UBICACION_VENTANA_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_UBICACION_MAX: z.coerce.number().int().positive().default(60),
  IDEMPOTENCIA_TTL_SEGUNDOS: z.coerce.number().int().positive().default(86_400),
});

export function leerConfiguracion(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const errores = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuración inválida: ${errores}`);
  }
  return result.data;
}

