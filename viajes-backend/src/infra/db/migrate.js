import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { leerConfiguracion } from '../../config/env.js';
import { DIRECTORIOS_MIGRACIONES, listarArchivosMigracion } from './migraciones.js';

// Prepara las tres bases (tema 12, ADR 008). Se puede correr las veces que haga falta:
//   1. crea el rol de cada módulo (si no existe) y su base;
//   2. saca el permiso de conexión al resto (REVOKE CONNECT ... FROM PUBLIC): cada rol entra sólo a su base;
//   3. aplica las migraciones pendientes y las registra en `schema_migrations`;
//   4. le da al rol del módulo sólo lectura y escritura de filas (sin crear ni borrar tablas).
// Con `--pruebas` prepara viajes_test, billetera_test y lectura_test, a las que los tests entran
// con el superusuario (no se crean roles).
const MODULOS = [
  { url: (c) => c.DATABASE_URL, base: 'viajes', directorio: DIRECTORIOS_MIGRACIONES.viajes, permisos: 'SELECT, INSERT, UPDATE, DELETE' },
  { url: (c) => c.BILLETERA_DATABASE_URL, base: 'billetera', directorio: DIRECTORIOS_MIGRACIONES.billetera, permisos: 'SELECT, INSERT, UPDATE, DELETE' },
  // TRUNCATE: lo usa `npm run proyecciones:reconstruir`.
  { url: (c) => c.LECTURA_DATABASE_URL, base: 'lectura', directorio: DIRECTORIOS_MIGRACIONES.lectura, permisos: 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE' },
];

// Los nombres de rol y de base van dentro del SQL (CREATE ROLE no admite parámetros), así que sólo
// se aceptan identificadores simples.
function identificador(nombre) {
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) throw new Error(`Nombre no válido para una base o un rol: ${nombre}`);
  return `"${nombre}"`;
}

function conBase(url, base) {
  const copia = new URL(url);
  copia.pathname = `/${base}`;
  return copia.toString();
}

async function conCliente(url, trabajo) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await trabajo(client);
  } finally {
    await client.end();
  }
}

async function prepararRol(admin, usuario, clave) {
  const { rows } = await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [usuario]);
  if (rows[0]) return { esSuperusuario: rows[0].rolsuper };
  await admin.query(`CREATE ROLE ${identificador(usuario)} LOGIN PASSWORD ${admin.escapeLiteral(clave)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  return { esSuperusuario: false };
}

async function prepararBase(admin, base) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [base]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE ${identificador(base)}`);
  await admin.query(`REVOKE CONNECT ON DATABASE ${identificador(base)} FROM PUBLIC`);
}

async function aplicarMigraciones(client, directorio) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre TEXT PRIMARY KEY,
      aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await client.query('SELECT nombre FROM schema_migrations');
  const aplicadas = new Set(rows.map((fila) => fila.nombre));
  const archivos = await listarArchivosMigracion(directorio);
  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    await client.query(await readFile(path.join(directorio, archivo), 'utf8'));
    await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [archivo]);
    nuevas += 1;
  }
  return { total: archivos.length, nuevas };
}

async function darPermisos(client, base, usuario, permisos) {
  const rol = identificador(usuario);
  await client.query(`GRANT CONNECT ON DATABASE ${identificador(base)} TO ${rol}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${rol}`);
  await client.query(`GRANT ${permisos} ON ALL TABLES IN SCHEMA public TO ${rol}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${rol}`);
}

const pruebas = process.argv.includes('--pruebas');
const config = leerConfiguracion();
if (!config.ADMIN_DATABASE_URL) throw new Error('Falta ADMIN_DATABASE_URL (ver .env.example): sólo la usa este script.');

for (const modulo of MODULOS) {
  const base = pruebas ? `${modulo.base}_test` : new URL(modulo.url(config)).pathname.slice(1);
  const destino = new URL(modulo.url(config));
  const usuario = decodeURIComponent(destino.username);

  const { esSuperusuario } = await conCliente(config.ADMIN_DATABASE_URL, async (admin) => {
    const rol = pruebas ? { esSuperusuario: true } : await prepararRol(admin, usuario, decodeURIComponent(destino.password));
    await prepararBase(admin, base);
    return rol;
  });

  const resultado = await conCliente(conBase(config.ADMIN_DATABASE_URL, base), async (client) => {
    const estado = await aplicarMigraciones(client, modulo.directorio);
    if (!esSuperusuario) await darPermisos(client, base, usuario, modulo.permisos);
    return estado;
  });
  console.log(`Base ${base}: ${resultado.total} migraciones (${resultado.nuevas} nuevas)${pruebas || esSuperusuario ? '' : `, permisos para ${usuario}`}.`);
}
