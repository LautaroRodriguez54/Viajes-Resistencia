import pg from 'pg';

export function crearPoolPostgres(config) {
  return new pg.Pool({ connectionString: config.DATABASE_URL, ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : false });
}

export async function verificarPostgres(pool) {
  await pool.query('SELECT 1');
}

