import pg from 'pg';

export const TIMEOUTS_POOL_DEFECTO = Object.freeze({
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
});

export function crearPoolPostgres(config, opciones = {}) {
  const { logger, nombre = 'postgres' } = opciones;
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS ?? TIMEOUTS_POOL_DEFECTO.connectionTimeoutMillis,
    idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS ?? TIMEOUTS_POOL_DEFECTO.idleTimeoutMillis,
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS ?? TIMEOUTS_POOL_DEFECTO.statement_timeout,
  });
  pool.on('error', (error) => {
    logger?.error({ err: error, pool: nombre }, 'error inesperado en cliente inactivo del pool de PostgreSQL');
  });
  return pool;
}

export async function verificarPostgres(pool) {
  await pool.query('SELECT 1');
}

