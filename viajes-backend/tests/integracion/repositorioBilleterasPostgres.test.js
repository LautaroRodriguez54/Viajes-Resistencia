
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';

// Desde la rama 7 la billetera tiene su propia base (billetera_test, ADR 008): `pool` es esa base.
// No hay claves foráneas hacia usuarios ni viajes, así que el pasajero y el viaje son uuid sueltos.

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
    DATABASE_URL: urlsDePrueba().billetera,
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

// El viaje vive en la base de viajes: para la billetera es sólo un id.
function crearViaje() {
  return crypto.randomUUID();
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
    const viajeId = crearViaje();

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

async function eventosDelOutbox(pool, pasajeroId) {
  const { rows } = await pool.query(
    "SELECT tipo, datos FROM outbox_billetera WHERE datos->>'pasajeroId' = $1 ORDER BY created_at, id",
    [pasajeroId],
  );
  return rows;
}

test('cobrar es idempotente por viaje: un segundo cobro del mismo viaje no debita otra vez', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const repositorio = crearRepositorioBilleterasPostgres(pool);
    await repositorio.registrarCargaDesdeWebhook(crearEvento(pasajeroId, 10000), Buffer.from('{}'));
    const viajeId = crearViaje();

    const primero = await repositorio.cobrar({ pasajeroId, viajeId, importeCentavos: 4000 });
    const segundo = await repositorio.cobrar({ pasajeroId, viajeId, importeCentavos: 4000 });

    assert.deepEqual(primero, { cobrado: true });
    assert.deepEqual(segundo, { cobrado: true });
    assert.equal((await repositorio.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 6000);
    assert.deepEqual((await eventosDelOutbox(pool, pasajeroId)).map((e) => e.datos.tipo), ['carga', 'consumo']);
  });
});

test('cobrar nunca es parcial y sin billetera lanza BILLETERA_NO_ENCONTRADA', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const repositorio = crearRepositorioBilleterasPostgres(pool);
    await repositorio.registrarCargaDesdeWebhook(crearEvento(pasajeroId, 3000), Buffer.from('{}'));

    assert.deepEqual(await repositorio.cobrar({ pasajeroId, viajeId: crearViaje(), importeCentavos: 3001 }), { cobrado: false });
    assert.equal((await repositorio.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 3000);
    await assert.rejects(
      repositorio.cobrar({ pasajeroId: crypto.randomUUID(), viajeId: crearViaje(), importeCentavos: 100 }),
      (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA',
    );
  });
});

test('crearBilleteraPorEvento crea una sola billetera aunque el evento llegue dos veces', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearRepositorioBilleterasPostgres(pool);
    const pasajeroId = crypto.randomUUID();
    const eventoId = crypto.randomUUID();

    assert.deepEqual(await repositorio.crearBilleteraPorEvento({ eventoId, pasajeroId }), { creada: true, duplicado: false });
    assert.deepEqual(await repositorio.crearBilleteraPorEvento({ eventoId, pasajeroId }), { creada: false, duplicado: true });

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM billeteras WHERE pasajero_id = $1', [pasajeroId]);
    assert.equal(rows[0].n, 1);
    assert.deepEqual((await eventosDelOutbox(pool, pasajeroId)).map((e) => e.tipo), ['BilleteraCreada']);
    assert.equal((await repositorio.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 0);
  });
});

// Tema 12: cada base tiene sólo las tablas de su módulo.
test('propiedad de datos: viajes no tiene tablas de la billetera y billetera no tiene usuarios ni viajes', async (t) => {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    const existe = async (pool, tabla) => (await pool.query('SELECT to_regclass($1) IS NOT NULL AS existe', [tabla])).rows[0].existe;
    for (const tabla of ['billeteras', 'movimientos_billetera', 'eventos_webhook_pago']) {
      assert.equal(await existe(pools.viajes, tabla), false, `viajes no debería tener ${tabla}`);
      assert.equal(await existe(pools.billetera, tabla), true);
    }
    for (const tabla of ['usuarios', 'viajes']) assert.equal(await existe(pools.billetera, tabla), false);
  } finally {
    await cerrarPools(pools);
  }
});
