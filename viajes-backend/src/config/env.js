import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
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
});

export function leerConfiguracion(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const errores = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuración inválida: ${errores}`);
  }
  return result.data;
}

