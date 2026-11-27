import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';
import { crearRecolectorHistorialUbicaciones } from '../../src/infra/db/recolectorHistorialUbicaciones.js';

const urls = urlsDePrueba();

test('registrarUbicacion actualiza ubicación actual, valida estado y drena lote en historial al detener', { skip: !urls }, async () => {
  const pools = crearPoolsDePrueba(urls);
  const pool = pools.viajes;
  const choferId = crypto.randomUUID();
  const recolector = crearRecolectorHistorialUbicaciones({
    pool,
    intervaloMs: 10_000,
    loteMax: 50,
    bufferMax: 100,
  });

  try {
    await pool.query(
      `INSERT INTO usuarios (id, email, password_hash, rol)
       VALUES ($1, $2, 'hash', 'chofer')`,
      [choferId, `batch-${choferId}@test.local`],
    );
    await pool.query(
      `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
       VALUES ($1, $2, 'Test', 'Batch', FALSE, FALSE)`,
      [choferId, `BT${choferId.slice(0, 6)}`],
    );

    const repo = crearRepositorioChoferesPostgres(pool, { recolectorHistorial: recolector });
    await assert.rejects(
      repo.registrarUbicacion(choferId, { latitud: -27.45, longitud: -58.98 }),
      (err) => err.codigo === 'CHOFER_NO_HABILITADO',
    );

    await repo.establecerHabilitacion(choferId, true);
    await assert.rejects(
      repo.registrarUbicacion(choferId, { latitud: -27.45, longitud: -58.98 }),
      (err) => err.codigo === 'CHOFER_NO_DISPONIBLE',
    );

    await repo.cambiarDisponibilidad(choferId, true);
    await repo.registrarUbicacion(choferId, { latitud: -27.4514, longitud: -58.9867 });
    await repo.registrarUbicacion(choferId, { latitud: -27.4520, longitud: -58.9870 });

    const antesDeDrenar = await pool.query('SELECT COUNT(*)::int AS total FROM historial_ubicaciones_chofer WHERE chofer_id = $1', [choferId]);
    assert.equal(antesDeDrenar.rows[0].total, 0);

    await recolector.detener();

    const actual = await pool.query('SELECT ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lon FROM ubicaciones_actuales_chofer WHERE chofer_id = $1', [choferId]);
    assert.equal(actual.rows.length, 1);
    assert.ok(Math.abs(actual.rows[0].lat - (-27.4520)) < 0.0001);

    const historial = await pool.query('SELECT COUNT(*)::int AS total FROM historial_ubicaciones_chofer WHERE chofer_id = $1', [choferId]);
    assert.equal(historial.rows[0].total, 2);
  } finally {
    await recolector.detener();
    await pool.query('DELETE FROM historial_ubicaciones_chofer WHERE chofer_id = $1', [choferId]);
    await pool.query('DELETE FROM ubicaciones_actuales_chofer WHERE chofer_id = $1', [choferId]);
    await pool.query('DELETE FROM perfiles_chofer WHERE usuario_id = $1', [choferId]);
    await pool.query('DELETE FROM usuarios WHERE id = $1', [choferId]);
    await cerrarPools(pools);
  }
});
