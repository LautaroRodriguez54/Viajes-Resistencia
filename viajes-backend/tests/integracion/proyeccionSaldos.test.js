import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearProyectorSaldosPostgres } from '../../src/infra/db/proyectorSaldosPostgres.js';
import { crearDespachadorOutbox } from '../../src/infra/db/despachadorOutbox.js';

// CQRS (tema 13, ADR 009): la proyección de saldos en `lectura` tiene que coincidir con la suma de
// movimientos en `billetera` una vez entregados los eventos, también con concurrencia.

const loggerMudo = { info() {}, warn() {}, error() {} };

async function conBases(t, ejecutar) {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    const billeteras = crearRepositorioBilleterasPostgres(pools.billetera);
    const proyector = crearProyectorSaldosPostgres(pools.lectura);
    const despachador = () => crearDespachadorOutbox({
      pool: pools.billetera, tabla: 'outbox_billetera', logger: loggerMudo, manejar: (evento) => proyector.aplicar(evento),
    });
    await ejecutar({ pools, billeteras, proyector, despachador });
  } finally {
    await cerrarPools(pools);
  }
}

async function crearPasajeroConBilletera(billeteras) {
  const pasajeroId = crypto.randomUUID();
  await billeteras.crearBilleteraPorEvento({ eventoId: crypto.randomUUID(), pasajeroId });
  return pasajeroId;
}

const cargar = (billeteras, pasajeroId, importeCentavos) => billeteras.registrarCargaDesdeWebhook(
  { eventoExternoId: `test-${crypto.randomUUID()}`, pasajeroId, importeCentavos },
  Buffer.from('{}'),
);

async function sonIguales(billeteras, proyector, pasajeroId) {
  const escritura = (await billeteras.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos;
  const lectura = (await proyector.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos;
  assert.equal(lectura, escritura, 'la proyección tiene que coincidir con la suma de movimientos');
  return lectura;
}

test('la proyección de saldos coincide con la suma de movimientos después de entregar los eventos', async (t) => {
  await conBases(t, async ({ billeteras, proyector, despachador }) => {
    const pasajeroId = await crearPasajeroConBilletera(billeteras);
    await despachador().procesarPendientes();
    assert.equal(await sonIguales(billeteras, proyector, pasajeroId), 0);

    await cargar(billeteras, pasajeroId, 10000);
    await billeteras.cobrar({ pasajeroId, viajeId: crypto.randomUUID(), importeCentavos: 2500 });
    await billeteras.cobrar({ pasajeroId, viajeId: crypto.randomUUID(), importeCentavos: 99999 }); // no alcanza: sin evento

    // Antes de entregar, la pantalla todavía muestra el saldo anterior (consistencia eventual).
    assert.equal((await proyector.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 0);
    await despachador().procesarPendientes();
    assert.equal(await sonIguales(billeteras, proyector, pasajeroId), 7500);
  });
});

test('con cargas y cobros simultáneos y dos despachadores a la vez, la proyección coincide', async (t) => {
  await conBases(t, async ({ billeteras, proyector, despachador }) => {
    const pasajeroId = await crearPasajeroConBilletera(billeteras);
    await cargar(billeteras, pasajeroId, 5000);

    await Promise.all([
      ...Array.from({ length: 10 }, () => cargar(billeteras, pasajeroId, 1000)),
      ...Array.from({ length: 10 }, () => billeteras.cobrar({ pasajeroId, viajeId: crypto.randomUUID(), importeCentavos: 1500 })),
    ]);
    // Dos despachadores en paralelo (como dos instancias del backend): SKIP LOCKED reparte los eventos.
    const [a, b] = await Promise.all([despachador().procesarPendientes(), despachador().procesarPendientes()]);
    assert.ok(a + b > 0);

    const saldo = await sonIguales(billeteras, proyector, pasajeroId);
    assert.ok(saldo >= 0, 'el cobro nunca deja el saldo negativo');
  });
});

test('un evento entregado dos veces se aplica una sola vez', async (t) => {
  await conBases(t, async ({ pools, billeteras, proyector, despachador }) => {
    const pasajeroId = await crearPasajeroConBilletera(billeteras);
    await cargar(billeteras, pasajeroId, 4000);
    await despachador().procesarPendientes();

    const { rows } = await pools.billetera.query(
      "SELECT id, tipo, datos FROM outbox_billetera WHERE tipo = 'MovimientoRegistrado' AND datos->>'pasajeroId' = $1",
      [pasajeroId],
    );
    assert.deepEqual(await proyector.aplicar(rows[0]), { aplicado: false });
    assert.equal(await sonIguales(billeteras, proyector, pasajeroId), 4000);
  });
});

test('la proyección se reconstruye desde cero reproduciendo el outbox', async (t) => {
  await conBases(t, async ({ pools, billeteras, proyector, despachador }) => {
    const pasajeroId = await crearPasajeroConBilletera(billeteras);
    await cargar(billeteras, pasajeroId, 9000);
    await billeteras.cobrar({ pasajeroId, viajeId: crypto.randomUUID(), importeCentavos: 1000 });
    await despachador().procesarPendientes();

    // Desincronización simulada: alguien pisa la proyección.
    await pools.lectura.query('UPDATE saldos SET saldo_centavos = 123 WHERE pasajero_id = $1', [pasajeroId]);
    await proyector.reiniciar();
    const { rows } = await pools.billetera.query('SELECT id, tipo, datos FROM outbox_billetera ORDER BY created_at, id');
    for (const evento of rows) await proyector.aplicar(evento);

    assert.equal(await sonIguales(billeteras, proyector, pasajeroId), 8000);
  });
});
