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
