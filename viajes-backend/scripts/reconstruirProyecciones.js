// Reconstruye la proyección de saldos desde cero (tema 13, ADR 009):
//   npm run proyecciones:reconstruir
// Borra `saldos` en la base `lectura` y vuelve a aplicar todos los eventos de outbox_billetera, que
// no se borran nunca. Sirve si la proyección se desincroniza o si cambia su forma.
// Conviene correrlo con el servidor apagado; si está prendido no se rompe nada (el proyector
// deduplica por id de evento y la suma no depende del orden), pero el saldo se ve en 0 un momento.
import { leerConfiguracion } from '../src/config/env.js';
import { crearPoolPostgres } from '../src/infra/db/postgres.js';
import { crearProyectorSaldosPostgres } from '../src/infra/db/proyectorSaldosPostgres.js';

const config = leerConfiguracion();
const poolBilletera = crearPoolPostgres({ ...config, DATABASE_URL: config.BILLETERA_DATABASE_URL });
const poolLectura = crearPoolPostgres({ ...config, DATABASE_URL: config.LECTURA_DATABASE_URL });

try {
  const proyector = crearProyectorSaldosPostgres(poolLectura);
  await proyector.reiniciar();
  const { rows } = await poolBilletera.query('SELECT id, tipo, datos FROM outbox_billetera ORDER BY created_at, id');
  for (const evento of rows) await proyector.aplicar(evento);
  const saldos = await poolLectura.query('SELECT count(*)::int AS n FROM saldos');
  console.log(`Proyección reconstruida: ${rows.length} eventos aplicados, ${saldos.rows[0].n} saldos.`);
} finally {
  await Promise.all([poolBilletera.end(), poolLectura.end()]);
}
