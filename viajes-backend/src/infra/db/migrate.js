import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerConfiguracion } from '../../config/env.js';
import { crearPoolPostgres } from './postgres.js';

const directorio = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migraciones');
const pool = crearPoolPostgres(leerConfiguracion());

try {
  const archivos = (await readdir(directorio)).filter((archivo) => archivo.endsWith('.sql')).sort();
  for (const archivo of archivos) await pool.query(await readFile(path.join(directorio, archivo), 'utf8'));
  console.log(`Migraciones aplicadas: ${archivos.length}`);
} finally {
  await pool.end();
}

