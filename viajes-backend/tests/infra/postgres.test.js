import test from 'node:test';
import assert from 'node:assert/strict';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';

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
