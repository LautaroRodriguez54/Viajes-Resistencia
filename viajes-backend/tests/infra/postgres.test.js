import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPoolPostgres, TIMEOUTS_POOL_DEFECTO } from '../../src/infra/db/postgres.js';
import { leerConfiguracion } from '../../src/config/env.js';

const urlBase = 'postgres://viajes:viajes@localhost:5433/viajes';

const envMinimo = {
  DATABASE_URL: urlBase,
  BILLETERA_DATABASE_URL: 'postgres://billetera:billetera@localhost:5433/billetera',
  LECTURA_DATABASE_URL: 'postgres://lectura:lectura@localhost:5433/lectura',
  JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
  JWT_ACCESS_TOKEN_TTL: '15m',
  ARGON2_MEMORY_COST: '19456',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  WEBHOOK_HMAC_SECRET: 'secreto-webhook-prueba-con-mas-de-32-caracteres',
  CORS_ORIGINS: 'http://localhost:3000',
};

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

test('registra error en clientes inactivos del pool sin derribar el proceso', async () => {
  const errores = [];
  const logger = {
    error(datos, mensaje) {
      errores.push({ datos, mensaje });
    },
  };
  const pool = crearPoolPostgres({ DATABASE_URL: urlBase, DATABASE_SSL: false }, { logger, nombre: 'viajes' });
  try {
    const falla = new Error('Connection terminated unexpectedly');
    pool.emit('error', falla);
    assert.equal(errores.length, 1);
    assert.equal(errores[0].datos.err, falla);
    assert.equal(errores[0].datos.pool, 'viajes');
  } finally {
    await pool.end();
  }
});

test('leerConfiguracion expone timeouts de pool por defecto y valida sobreescrituras', () => {
  const porDefecto = leerConfiguracion(envMinimo);
  assert.equal(porDefecto.DATABASE_CONNECT_TIMEOUT_MS, TIMEOUTS_POOL_DEFECTO.connectionTimeoutMillis);
  assert.equal(porDefecto.DATABASE_IDLE_TIMEOUT_MS, TIMEOUTS_POOL_DEFECTO.idleTimeoutMillis);
  assert.equal(porDefecto.DATABASE_STATEMENT_TIMEOUT_MS, TIMEOUTS_POOL_DEFECTO.statement_timeout);

  const personalizado = leerConfiguracion({
    ...envMinimo,
    DATABASE_CONNECT_TIMEOUT_MS: '2500',
    DATABASE_IDLE_TIMEOUT_MS: '12000',
    DATABASE_STATEMENT_TIMEOUT_MS: '9000',
  });
  assert.equal(personalizado.DATABASE_CONNECT_TIMEOUT_MS, 2_500);
  assert.equal(personalizado.DATABASE_IDLE_TIMEOUT_MS, 12_000);
  assert.equal(personalizado.DATABASE_STATEMENT_TIMEOUT_MS, 9_000);

  assert.throws(
    () => leerConfiguracion({ ...envMinimo, DATABASE_CONNECT_TIMEOUT_MS: '0' }),
    /DATABASE_CONNECT_TIMEOUT_MS/,
  );
});
