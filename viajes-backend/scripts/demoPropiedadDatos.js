// Demo del tema 12 (base de datos por servicio, ADR 008): cada módulo entra sólo a su base.
//   npm run demo:propiedad-datos
// Usa los roles del .env: el de Viajes intenta leer la base de la billetera y al revés.
import pg from 'pg';
import { leerConfiguracion } from '../src/config/env.js';

const config = leerConfiguracion();
const conBase = (url, base) => {
  const copia = new URL(url);
  copia.pathname = `/${base}`;
  return copia.toString();
};
const baseDe = (url) => new URL(url).pathname.slice(1);

const intentos = [
  ['Viajes lee su propia base', config.DATABASE_URL, 'SELECT count(*) AS filas FROM viajes'],
  ['Billetera lee su propia base', config.BILLETERA_DATABASE_URL, 'SELECT count(*) AS filas FROM movimientos_billetera'],
  ['Viajes intenta leer la base de la billetera', conBase(config.DATABASE_URL, baseDe(config.BILLETERA_DATABASE_URL)), 'SELECT count(*) AS filas FROM movimientos_billetera'],
  ['Billetera intenta leer la base de viajes', conBase(config.BILLETERA_DATABASE_URL, baseDe(config.DATABASE_URL)), 'SELECT count(*) AS filas FROM usuarios'],
  ['Viajes intenta borrar una tabla propia', config.DATABASE_URL, 'DROP TABLE viajes'],
];

for (const [descripcion, url, sql] of intentos) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query(sql);
    console.log(`PERMITIDO  ${descripcion}: ${rows[0]?.filas ?? 'ok'} filas`);
  } catch (error) {
    console.log(`RECHAZADO  ${descripcion}: ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}
