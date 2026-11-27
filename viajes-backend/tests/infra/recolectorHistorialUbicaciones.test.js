import test from 'node:test';
import assert from 'node:assert/strict';
import { crearRecolectorHistorialUbicaciones } from '../../src/infra/db/recolectorHistorialUbicaciones.js';

test('recolector agrupa inserciones por lote al alcanzar loteMax y usa unnest', async () => {
  const consultas = [];
  const pool = {
    async query(sql, params) {
      consultas.push({ sql, params });
      return { rows: [] };
    },
  };
  const recolector = crearRecolectorHistorialUbicaciones({ pool, intervaloMs: 5_000, loteMax: 3, bufferMax: 10 });

  recolector.encolar({ choferId: 'ch-1', latitud: -27.45, longitud: -58.98 });
  recolector.encolar({ choferId: 'ch-2', latitud: -27.46, longitud: -58.99 });
  assert.equal(consultas.length, 0);

  recolector.encolar({ choferId: 'ch-3', latitud: -27.47, longitud: -58.97 });
  await recolector.detener();

  assert.equal(consultas.length, 1);
  assert.ok(consultas[0].sql.includes('FROM unnest('));
  assert.deepEqual(consultas[0].params[0], ['ch-1', 'ch-2', 'ch-3']);
  assert.deepEqual(recolector.obtenerEstadisticas(), { pendientes: 0, insertados: 3, descartados: 0 });
});

test('recolector acota el buffer ante fallas de Postgres y drena al detenerse cuando vuelve', async () => {
  let fallar = true;
  const lotes = [];
  const errores = [];
  const warnings = [];
  const pool = {
    async query(_sql, params) {
      if (fallar) throw new Error('conexion caída');
      lotes.push(params[0]);
      return { rows: [] };
    },
  };
  const logger = {
    error(d) { errores.push(d); },
    warn(d) { warnings.push(d); },
  };
  const recolector = crearRecolectorHistorialUbicaciones({ pool, logger, intervaloMs: 5_000, loteMax: 2, bufferMax: 3 });

  recolector.encolar({ choferId: 'ch-1', latitud: -27.45, longitud: -58.98 });
  recolector.encolar({ choferId: 'ch-2', latitud: -27.45, longitud: -58.98 });
  await recolector.vaciar();
  assert.equal(errores.length, 1);
  assert.equal(recolector.obtenerEstadisticas().pendientes, 2);

  recolector.encolar({ choferId: 'ch-3', latitud: -27.45, longitud: -58.98 });
  recolector.encolar({ choferId: 'ch-4', latitud: -27.45, longitud: -58.98 });
  assert.equal(warnings.length, 1);
  assert.equal(recolector.obtenerEstadisticas().descartados, 1);

  fallar = false;
  await recolector.detener();
  assert.deepEqual(lotes.flat(), ['ch-2', 'ch-3', 'ch-4']);
  assert.equal(recolector.obtenerEstadisticas().pendientes, 0);
  assert.equal(recolector.obtenerEstadisticas().insertados, 3);
});

test('recolector descarta lote con error de FK 23503 sin bloquear lotes posteriores', async () => {
  const lotesOk = [];
  const pool = {
    async query(_sql, params) {
      if (params[0].includes('inexistente')) {
        const err = new Error('fk violation');
        err.code = '23503';
        throw err;
      }
      lotesOk.push(params[0]);
      return { rows: [] };
    },
  };
  const recolector = crearRecolectorHistorialUbicaciones({ pool, intervaloMs: 5_000, loteMax: 1, bufferMax: 10 });
  recolector.encolar({ choferId: 'inexistente', latitud: -27.45, longitud: -58.98 });
  recolector.encolar({ choferId: 'ch-ok', latitud: -27.45, longitud: -58.98 });
  await recolector.detener();

  assert.deepEqual(lotesOk.flat(), ['ch-ok']);
  assert.deepEqual(recolector.obtenerEstadisticas(), { pendientes: 0, insertados: 1, descartados: 1 });
});

test('recolector no escribe dos veces el mismo lote cuando un volcado completo se encadena a uno en curso', async () => {
  const escritos = [];
  const pool = {
    async query(_sql, params) {
      await new Promise((resolver) => setTimeout(resolver, 30));
      escritos.push(...params[0]);
      return { rows: [] };
    },
  };
  const recolector = crearRecolectorHistorialUbicaciones({ pool, intervaloMs: 5_000, loteMax: 3, bufferMax: 100 });
  let n = 0;
  const encolar = () => recolector.encolar({ choferId: `ch-${n++}`, latitud: -27.45, longitud: -58.98 });

  for (let i = 0; i < 3; i += 1) encolar(); // volcado A con ch-0..ch-2
  encolar(); encolar(); // ch-3 y ch-4: menos de un lote, A no los toma
  recolector.vaciar({ todo: true }); // como el temporizador: B queda encadenado detrás de A
  await new Promise((resolver) => setTimeout(resolver, 35)); // A terminó; B escribe ch-3 y ch-4
  encolar(); // ch-5 completa un lote: antes arrancaba un volcado en paralelo con B
  await recolector.detener();

  assert.deepEqual(escritos, ['ch-0', 'ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5']);
  assert.deepEqual(recolector.obtenerEstadisticas(), { pendientes: 0, insertados: 6, descartados: 0 });
});
