// Reconstruye las proyecciones desde cero (tema 13, ADR 009):
//   npm run proyecciones:reconstruir
// - Saldos: borra `saldos` en la base `lectura` y vuelve a aplicar todos los eventos de outbox_billetera.
// - Historial: borra `historial_viajes` y vuelve a aplicar los ViajeCambiado de outbox_viajes.
// Los outbox no se borran nunca. Sirve si una proyección se desincroniza o si cambia su forma.
// Conviene correrlo con el servidor apagado; si está prendido no se rompe nada (los saldos se
// deduplican por id de evento y la suma no depende del orden; el historial sólo acepta versiones
// más nuevas), pero un momento se ven vacíos.
import { leerConfiguracion } from '../src/config/env.js';
import { crearPoolPostgres } from '../src/infra/db/postgres.js';
import { crearProyectorSaldosPostgres } from '../src/infra/db/proyectorSaldosPostgres.js';
import { crearProyectorHistorialPostgres } from '../src/infra/db/proyectorHistorialPostgres.js';

const config = leerConfiguracion();
const poolBilletera = crearPoolPostgres({ ...config, DATABASE_URL: config.BILLETERA_DATABASE_URL });
const poolLectura = crearPoolPostgres({ ...config, DATABASE_URL: config.LECTURA_DATABASE_URL });
const poolViajes = crearPoolPostgres(config);

try {
  const proyector = crearProyectorSaldosPostgres(poolLectura);
  await proyector.reiniciar();
  const { rows } = await poolBilletera.query('SELECT id, tipo, datos FROM outbox_billetera ORDER BY created_at, id');
  for (const evento of rows) await proyector.aplicar(evento);
  const saldos = await poolLectura.query('SELECT count(*)::int AS n FROM saldos');
  console.log(`Saldos reconstruidos: ${rows.length} eventos aplicados, ${saldos.rows[0].n} saldos.`);

  const historial = crearProyectorHistorialPostgres(poolLectura);
  await historial.reiniciar();
  const cambios = await poolViajes.query("SELECT id, tipo, datos FROM outbox_viajes WHERE tipo = 'ViajeCambiado' ORDER BY created_at, id");
  for (const evento of cambios.rows) await historial.aplicar(evento);
  const viajes = await poolLectura.query('SELECT count(*)::int AS n FROM historial_viajes');
  console.log(`Historial reconstruido: ${cambios.rows.length} eventos aplicados, ${viajes.rows[0].n} viajes.`);
} finally {
  await Promise.all([poolBilletera.end(), poolLectura.end(), poolViajes.end()]);
}
