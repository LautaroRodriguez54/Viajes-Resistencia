
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }

  const url = new URL(databaseUrl);

  assert.equal(
    url.pathname,
    '/viajes_test',
    'Las pruebas de integración solo pueden ejecutarse contra viajes_test',
  );

  const pool = crearPoolPostgres({
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: false,
  });

  try {
    await ejecutar(pool);
  } finally {
    await pool.end();
  }
}

async function crearPasajero(pool, conBilletera = true) {
  const pasajeroId = crypto.randomUUID();
  const email = `test-${crypto.randomUUID()}@example.com`;

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, rol)
     VALUES ($1, $2, $3, 'pasajero')`,
    [pasajeroId, email, 'hash-de-prueba'],
  );

  let billeteraId = null;

  if (conBilletera) {
    const resultado = await pool.query(
      `INSERT INTO billeteras (pasajero_id)
       VALUES ($1)
       RETURNING id`,
      [pasajeroId],
    );

    billeteraId = resultado.rows[0].id;
  }

  return { pasajeroId, billeteraId };
}

async function crearViaje(pool, pasajeroId) {
  const resultado = await pool.query(
    `INSERT INTO viajes (
       pasajero_id,
       estado,
       origen,
       destino,
       estimacion_centavos
     )
     VALUES (
       $1,
       'solicitado',
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.9800, -27.4400), 4326)::geography,
       1200
     )
     RETURNING id`,
    [pasajeroId],
  );

  return resultado.rows[0].id;
}

function crearEvento(pasajeroId, importeCentavos = 1_000_000) {
  const eventoExternoId = `test-${crypto.randomUUID()}`;

  return {
    eventoExternoId,
    pasajeroId,
    importeCentavos,
    cuerpoCrudo: Buffer.from(JSON.stringify({
      id: eventoExternoId,
      tipo: 'pago.aprobado',
    })),
  };
}

test('un webhook duplicado no acredita dos veces la billetera', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const evento = crearEvento(pasajeroId);
    const repositorio = crearRepositorioBilleterasPostgres(pool);

    const primeraRespuesta = await repositorio.registrarCargaDesdeWebhook(
      evento,
      evento.cuerpoCrudo,
    );

    const segundaRespuesta = await repositorio.registrarCargaDesdeWebhook(
      evento,
      evento.cuerpoCrudo,
    );

    assert.deepEqual(primeraRespuesta, {
      procesado: true,
      duplicado: false,
    });

    assert.deepEqual(segundaRespuesta, {
      procesado: false,
      duplicado: true,
      estado: 'procesado',
    });

    const saldo = await repositorio.consultarSaldoPorPasajero(pasajeroId);
    assert.equal(saldo.saldoCentavos, evento.importeCentavos);

    const movimientos = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM movimientos_billetera
       WHERE referencia_externa = $1`,
      [evento.eventoExternoId],
    );

    assert.equal(movimientos.rows[0].cantidad, 1);

    const eventos = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM eventos_webhook_pago
       WHERE proveedor_evento_id = $1`,
      [evento.eventoExternoId],
    );

    assert.equal(eventos.rows[0].cantidad, 1);
  });
});

test('un webhook fallido revierte el registro del evento si el pasajero no tiene billetera', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool, false);
    const evento = crearEvento(pasajeroId);
    const repositorio = crearRepositorioBilleterasPostgres(pool);

    await assert.rejects(
      repositorio.registrarCargaDesdeWebhook(evento, evento.cuerpoCrudo),
      (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA',
    );

    const resultado = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM eventos_webhook_pago
       WHERE proveedor_evento_id = $1`,
      [evento.eventoExternoId],
    );

    assert.equal(resultado.rows[0].cantidad, 0);
  });
});

test('PostgreSQL rechaza movimientos con datos inválidos', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { billeteraId } = await crearPasajero(pool);

    await assert.rejects(
      pool.query(
        `INSERT INTO movimientos_billetera
           (billetera_id, tipo, importe_centavos)
         VALUES ($1, 'devolucion', 100)`,
        [billeteraId],
      ),
      (error) => error.code === '23514',
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO movimientos_billetera
           (billetera_id, tipo, importe_centavos)
         VALUES ($1, 'consumo', 100)`,
        [billeteraId],
      ),
      (error) => error.code === '23514',
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO movimientos_billetera
           (billetera_id, tipo, importe_centavos)
         VALUES ($1, 'carga', -100)`,
        [billeteraId],
      ),
      (error) => error.code === '23514',
    );
  });
});

test('PostgreSQL impide reutilizar una referencia externa', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { billeteraId } = await crearPasajero(pool);
    const referencia = `ref-${crypto.randomUUID()}`;

    await pool.query(
      `INSERT INTO movimientos_billetera
         (billetera_id, tipo, importe_centavos, referencia_externa)
       VALUES ($1, 'carga', 1000, $2)`,
      [billeteraId, referencia],
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO movimientos_billetera
           (billetera_id, tipo, importe_centavos, referencia_externa)
         VALUES ($1, 'carga', 2000, $2)`,
        [billeteraId, referencia],
      ),
      (error) => error.code === '23505',
    );
  });
});

test('los movimientos de billetera son inmutables', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { billeteraId } = await crearPasajero(pool);

    const movimiento = await pool.query(
      `INSERT INTO movimientos_billetera
         (billetera_id, tipo, importe_centavos)
       VALUES ($1, 'carga', 5000)
       RETURNING id`,
      [billeteraId],
    );

    const movimientoId = movimiento.rows[0].id;

    await assert.rejects(
      pool.query(
        `UPDATE movimientos_billetera
         SET importe_centavos = 9000
         WHERE id = $1`,
        [movimientoId],
      ),
      /inmutables/i,
    );

    await assert.rejects(
      pool.query(
        'DELETE FROM movimientos_billetera WHERE id = $1',
        [movimientoId],
      ),
      /inmutables/i,
    );

    const resultado = await pool.query(
      'SELECT importe_centavos FROM movimientos_billetera WHERE id = $1',
      [movimientoId],
    );

    assert.equal(resultado.rows[0].importe_centavos, 5000);
  });
});

test('el saldo suma las cargas y resta los consumos', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const viajeId = await crearViaje(pool, pasajeroId);

    await pool.query(
      `INSERT INTO movimientos_billetera
         (billetera_id, tipo, importe_centavos)
       VALUES ($1, 'carga', 10000)`,
      [billeteraId],
    );

    await pool.query(
      `INSERT INTO movimientos_billetera
         (billetera_id, viaje_id, tipo, importe_centavos)
       VALUES ($1, $2, 'consumo', 2500)`,
      [billeteraId, viajeId],
    );

    const repositorio = crearRepositorioBilleterasPostgres(pool);
    const saldo = await repositorio.consultarSaldoPorPasajero(pasajeroId);

    assert.equal(saldo.saldoCentavos, 7500);
  });
});

test('dos solicitudes simultáneas del mismo webhook generan una sola carga', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const evento = crearEvento(pasajeroId);
    const repositorio = crearRepositorioBilleterasPostgres(pool);

    const respuestas = await Promise.all([
      repositorio.registrarCargaDesdeWebhook(evento, evento.cuerpoCrudo),
      repositorio.registrarCargaDesdeWebhook(evento, evento.cuerpoCrudo),
    ]);

    assert.equal(
      respuestas.filter((respuesta) => respuesta.procesado).length,
      1,
    );

    assert.equal(
      respuestas.filter((respuesta) => respuesta.duplicado).length,
      1,
    );

    const saldo = await repositorio.consultarSaldoPorPasajero(pasajeroId);
    assert.equal(saldo.saldoCentavos, evento.importeCentavos);

    const resultado = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM movimientos_billetera
          WHERE referencia_externa = $1) AS movimientos,
         (SELECT COUNT(*)::int
          FROM eventos_webhook_pago
          WHERE proveedor_evento_id = $1) AS eventos`,
      [evento.eventoExternoId],
    );

    assert.equal(resultado.rows[0].movimientos, 1);
    assert.equal(resultado.rows[0].eventos, 1);
  });
});
