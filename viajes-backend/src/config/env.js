import 'dotenv/config';
import { z } from 'zod';
import { TIMEOUTS_POOL_DEFECTO } from '../infra/db/postgres.js';

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
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(TIMEOUTS_POOL_DEFECTO.connectionTimeoutMillis),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(TIMEOUTS_POOL_DEFECTO.idleTimeoutMillis),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(TIMEOUTS_POOL_DEFECTO.statement_timeout),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Debe tener formato, por ejemplo, 15m.'),
  ARGON2_MEMORY_COST: z.coerce.number().int().positive(),
  ARGON2_TIME_COST: z.coerce.number().int().positive(),
  ARGON2_PARALLELISM: z.coerce.number().int().positive(),
  WEBHOOK_HMAC_SECRET: z.string().min(32),
  // Pasarela de pagos simulada (carga de saldo desde la web, para la demo). Vacío: activa salvo en producción.
  PASARELA_SIMULADA_HABILITADA: z.enum(['true', 'false', '']).optional().transform((value) => (value ? value === 'true' : undefined)),
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
  OFERTA_TTL_SEGUNDOS: z.coerce.number().int().positive().default(30),
  OFERTA_VERIFICACION_MS: z.coerce.number().int().positive().default(1_000),
  UBICACION_TTL_SEGUNDOS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  HISTORIAL_UBICACIONES_FLUSH_MS: z.coerce.number().int().positive().default(1_000),
  HISTORIAL_UBICACIONES_LOTE_MAX: z.coerce.number().int().positive().default(250),
  HISTORIAL_UBICACIONES_BUFFER_MAX: z.coerce.number().int().positive().default(10_000),
});

export function leerConfiguracion(environment = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const errores = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuración inválida: ${errores}`);
  }
  return result.data;
}

