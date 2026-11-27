import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearProyectorHistorialPostgres } from '../../src/infra/db/proyectorHistorialPostgres.js';

// Migración 007: el viaje guarda el nombre del origen y del destino, y GET /viajes/:id le muestra al
// pasajero el vehículo y la posición de su chofer sólo mientras el viaje está activo (privacidad, 6.4).

const estimacion = { importeCentavos: 1300, distanciaKm: 1, duracionMinutos: 2 };
const plaza = { latitud: -27.4514, longitud: -58.9867, nombre: 'Plaza 25 de Mayo' };
const hospital = { latitud: -27.4581, longitud: -58.9757, nombre: 'Hospital Perrando' };

async function conBases(t, ejecutar) {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    await ejecutar({ pools, viajes: crearRepositorioViajesPostgres(pools.viajes), historial: crearProyectorHistorialPostgres(pools.lectura) });
  } finally {
    await cerrarPools(pools);
  }
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)',
    [id, `${rol}-${id}@example.com`, 'hash-de-prueba', rol]);
  return id;
}

async function crearChoferConUbicacion(pool) {
  const id = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Fiat', 'Cronos', TRUE, FALSE)`, [id, `NOM-${id.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO ubicaciones_actuales_chofer (chofer_id, ubicacion, reportada_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint(-58.9860, -27.4520), 4326)::geography, now())`, [id],
  );
  return id;
}

const asignar = (pool, viajeId, choferId, estado) => pool.query(
  'UPDATE viajes SET chofer_id = $2, estado = $3, version = version + 1 WHERE id = $1', [viajeId, choferId, estado],
);

test('el nombre del origen y del destino se guarda, lo ve el chofer y llega al historial', async (t) => {
  await conBases(t, async ({ pools, viajes, historial }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const creado = await viajes.crearSolicitud({ pasajeroId, origen: plaza, destino: hospital, estimacion });
    assert.deepEqual(creado.origen, plaza);
    assert.deepEqual(creado.destino, hospital);

    const choferId = await crearChoferConUbicacion(pools.viajes);
    await asignar(pools.viajes, creado.id, choferId, 'asignado');
    const delChofer = await viajes.buscarViajeActualDelChofer(choferId);
    assert.equal(delChofer.origen.nombre, 'Plaza 25 de Mayo');
    assert.equal(delChofer.destino.nombre, 'Hospital Perrando');

    // El trigger deja la foto con los nombres; la proyección los guarda.
    const { rows } = await pools.viajes.query(
      "SELECT id, tipo, datos FROM outbox_viajes WHERE tipo = 'ViajeCambiado' AND datos->>'viajeId' = $1 ORDER BY id",
      [creado.id],
    );
    for (const evento of rows) await historial.aplicar(evento);
    const [enHistorial] = await historial.listarPorPasajero(pasajeroId, { limite: 1 });
    assert.equal(enHistorial.origen.nombre, 'Plaza 25 de Mayo');
    assert.equal(enHistorial.destino.nombre, 'Hospital Perrando');
  });
});

test('sin nombre, el punto queda con nombre null (viajes viejos y clientes que no lo mandan)', async (t) => {
  await conBases(t, async ({ pools, viajes }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const { latitud, longitud } = plaza;
    const creado = await viajes.crearSolicitud({ pasajeroId, origen: { latitud, longitud }, destino: { latitud: -27.46, longitud: -58.98 }, estimacion });
    assert.equal(creado.origen.nombre, null);
    const leido = await viajes.buscarPorIdDelPasajero(creado.id, pasajeroId);
    assert.equal(leido.destino.nombre, null);
  });
});

test('GET /viajes/:id: el pasajero ve vehículo y posición del chofer sólo mientras el viaje está activo', async (t) => {
  await conBases(t, async ({ pools, viajes }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const otroPasajero = await crearUsuario(pools.viajes, 'pasajero');
    const { id } = await viajes.crearSolicitud({ pasajeroId, origen: plaza, destino: hospital, estimacion });

    const sinChofer = await viajes.buscarPorIdDelPasajero(id, pasajeroId);
    assert.equal(sinChofer.chofer, null, 'solicitado: todavía no hay chofer');

    const choferId = await crearChoferConUbicacion(pools.viajes);
    for (const estado of ['asignado', 'chofer_en_camino', 'en_curso']) {
      await asignar(pools.viajes, id, choferId, estado);
      const activo = await viajes.buscarPorIdDelPasajero(id, pasajeroId);
      assert.deepEqual(activo.chofer.vehiculo, { patente: `NOM-${choferId.slice(0, 8)}`, marca: 'Fiat', modelo: 'Cronos' }, estado);
      assert.ok(Math.abs(activo.chofer.ubicacion.latitud - -27.452) < 1e-9, estado);
      assert.ok(Math.abs(activo.chofer.ubicacion.longitud - -58.986) < 1e-9, estado);
    }

    // Otro pasajero no ve el viaje (ni la posición del chofer).
    assert.equal(await viajes.buscarPorIdDelPasajero(id, otroPasajero), null);

    // Terminado, ya no se expone dónde está el chofer.
    for (const estado of ['finalizado', 'cancelado_chofer']) {
      await asignar(pools.viajes, id, choferId, estado);
      const terminado = await viajes.buscarPorIdDelPasajero(id, pasajeroId);
      assert.equal(terminado.chofer, null, estado);
    }
  });
});
