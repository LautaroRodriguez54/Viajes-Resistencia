import assert from 'node:assert/strict';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';

// Las pruebas de integración usan tres bases (ADR 008): viajes_test, billetera_test y lectura_test,
// en el mismo servidor que DATABASE_URL y con las mismas credenciales. Se crean con
// `npm run setup:test`. Sin DATABASE_URL, las pruebas de integración se saltean.
export function urlsDePrueba() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  assert.equal(new URL(databaseUrl).pathname, '/viajes_test', 'Las pruebas solo pueden ejecutarse contra viajes_test');
  const conBase = (base) => {
    const url = new URL(databaseUrl);
    url.pathname = `/${base}`;
    return url.toString();
  };
  return { viajes: databaseUrl, billetera: conBase('billetera_test'), lectura: conBase('lectura_test') };
}

export function crearPoolsDePrueba(urls) {
  const pool = (url) => crearPoolPostgres({ DATABASE_URL: url, DATABASE_SSL: false });
  return { viajes: pool(urls.viajes), billetera: pool(urls.billetera), lectura: pool(urls.lectura) };
}

export async function cerrarPools(pools) {
  await Promise.all(Object.values(pools).map((p) => p.end()));
}
