import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorDeDominio } from '../../dominio/errores.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));

export const DIRECTORIOS_MIGRACIONES = Object.freeze({
  viajes: path.join(raiz, 'migraciones'),
  billetera: path.join(raiz, 'migraciones-billetera'),
  lectura: path.join(raiz, 'migraciones-lectura'),
});

export async function listarArchivosMigracion(directorio) {
  return (await readdir(directorio)).filter((archivo) => archivo.endsWith('.sql')).sort();
}

export async function verificarMigracionesAplicadas(pool, directorio) {
  const esperadas = await listarArchivosMigracion(directorio);
  let rows;
  try {
    ({ rows } = await pool.query('SELECT nombre FROM schema_migrations'));
  } catch {
    throw new ErrorDeDominio('SERVICIO_NO_DISPONIBLE', 'La base de datos no está disponible o faltan migraciones.');
  }
  const aplicadas = new Set(rows.map((fila) => fila.nombre));
  const faltantes = esperadas.filter((nombre) => !aplicadas.has(nombre));
  if (faltantes.length > 0) {
    throw new ErrorDeDominio('SERVICIO_NO_DISPONIBLE', 'Faltan migraciones por aplicar.');
  }
}
