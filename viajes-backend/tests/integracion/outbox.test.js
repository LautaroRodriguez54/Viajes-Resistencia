import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioUsuariosPostgres } from '../../src/infra/db/repositorioUsuariosPostgres.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearDespachadorOutbox } from '../../src/infra/db/despachadorOutbox.js';

// Outbox de Viajes → Billetera (temas 12 y 3): el registro deja UsuarioRegistrado en la misma
// transacción y el despachador crea la billetera en la otra base.

const loggerMudo = { info() {}, warn() {}, error() {} };

async function conBases(t, ejecutar) {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    // Cada test empieza sin eventos pendientes de otros tests.
    await pools.viajes.query('UPDATE outbox_viajes SET procesado_at = now() WHERE procesado_at IS NULL');
    await ejecutar(pools);
  } finally {
    await cerrarPools(pools);
  }
}

function despachadorDeUsuarios(pools, billeteras, manejarExtra = async () => {}) {
  return crearDespachadorOutbox({
    pool: pools.viajes,
    tabla: 'outbox_viajes',
    logger: loggerMudo,
    manejar: async (evento) => {
      await manejarExtra(evento);
      if (evento.tipo === 'UsuarioRegistrado' && evento.datos.rol === 'pasajero') {
        await billeteras.crearBilleteraPorEvento({ eventoId: evento.id, pasajeroId: evento.datos.usuarioId });
      }
    },
  });
}

const registrar = (usuarios, rol) => usuarios.crear({
  email: `${rol}-${crypto.randomUUID()}@example.com`,
  passwordHash: 'hash-de-prueba',
  rol,
  vehiculo: { patente: `OUT-${crypto.randomUUID().slice(0, 8)}`, marca: 'Toyota', modelo: 'Etios' },
});

test('registrar un pasajero deja UsuarioRegistrado en el outbox y el despachador crea su billetera', async (t) => {
  await conBases(t, async (pools) => {
    const usuarios = crearRepositorioUsuariosPostgres(pools.viajes);
    const billeteras = crearRepositorioBilleterasPostgres(pools.billetera);
    const pasajero = await registrar(usuarios, 'pasajero');
    await registrar(usuarios, 'chofer');

    await assert.rejects(billeteras.consultarSaldoPorPasajero(pasajero.id), (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA');

    const entregados = await despachadorDeUsuarios(pools, billeteras).procesarPendientes();

    assert.equal(entregados, 1, 'el chofer no genera evento');
    assert.equal((await billeteras.consultarSaldoPorPasajero(pasajero.id)).saldoCentavos, 0);
    assert.equal(await despachadorDeUsuarios(pools, billeteras).procesarPendientes(), 0);
  });
});

test('si la entrega falla, el evento queda pendiente; si se entrega dos veces, hay una sola billetera', async (t) => {
  await conBases(t, async (pools) => {
    const usuarios = crearRepositorioUsuariosPostgres(pools.viajes);
    const billeteras = crearRepositorioBilleterasPostgres(pools.billetera);
    const pasajero = await registrar(usuarios, 'pasajero');

    const queFalla = despachadorDeUsuarios(pools, billeteras, async () => { throw new Error('billetera caída'); });
    await assert.rejects(queFalla.procesarPendientes(), /billetera caída/);
    const pendientes = await pools.viajes.query("SELECT id FROM outbox_viajes WHERE procesado_at IS NULL AND datos->>'usuarioId' = $1", [pasajero.id]);
    assert.equal(pendientes.rowCount, 1);

    // Entrega duplicada (por ejemplo, el UPDATE de procesado no llegó): la billetera deduplica.
    const evento = pendientes.rows[0].id;
    await billeteras.crearBilleteraPorEvento({ eventoId: evento, pasajeroId: pasajero.id });
    await despachadorDeUsuarios(pools, billeteras).procesarPendientes();

    const { rows } = await pools.billetera.query('SELECT COUNT(*)::int AS n FROM billeteras WHERE pasajero_id = $1', [pasajero.id]);
    assert.equal(rows[0].n, 1);
  });
});
