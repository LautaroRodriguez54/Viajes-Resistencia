import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPoolPostgres, TIMEOUTS_POOL_DEFECTO } from '../../src/infra/db/postgres.js';

const urlBase = 'postgres://viajes:viajes@localhost:5433/viajes';

test('habilita verificación estricta de certificados cuando DATABASE_SSL es true', async () => {
  const pool = crearPoolPostgres({ DATABASE_URL: urlBase, DATABASE_SSL: true });
  try {
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
  } finally {
    await pool.end();
  }
});

test('mantiene SSL desactivado cuando DATABASE_SSL es false', async () => {
  const pool = crearPoolPostgres({ DATABASE_URL: urlBase, DATABASE_SSL: false });
  try {
    assert.equal(pool.options.ssl, false);
  } finally {
    await pool.end();
  }
});

test('configura timeouts por defecto en el pool de Postgres y permite sobreescribirlos', async () => {
  const porDefecto = crearPoolPostgres({ DATABASE_URL: urlBase, DATABASE_SSL: false });
  const personalizado = crearPoolPostgres({
    DATABASE_URL: urlBase,
    DATABASE_SSL: false,
    DATABASE_CONNECT_TIMEOUT_MS: 2_000,
    DATABASE_IDLE_TIMEOUT_MS: 10_000,
    DATABASE_STATEMENT_TIMEOUT_MS: 8_000,
  });
  try {
    assert.equal(porDefecto.options.connectionTimeoutMillis, TIMEOUTS_POOL_DEFECTO.connectionTimeoutMillis);
    assert.equal(porDefecto.options.idleTimeoutMillis, TIMEOUTS_POOL_DEFECTO.idleTimeoutMillis);
    assert.equal(porDefecto.options.statement_timeout, TIMEOUTS_POOL_DEFECTO.statement_timeout);

    assert.equal(personalizado.options.connectionTimeoutMillis, 2_000);
    assert.equal(personalizado.options.idleTimeoutMillis, 10_000);
    assert.equal(personalizado.options.statement_timeout, 8_000);
  } finally {
    await Promise.all([porDefecto.end(), personalizado.end()]);
  }
});
