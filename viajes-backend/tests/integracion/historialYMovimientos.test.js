import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearProyectorHistorialPostgres } from '../../src/infra/db/proyectorHistorialPostgres.js';
import { crearUnidadDeTrabajoCobroPostgres } from '../../src/infra/db/unidadDeTrabajoCobroPostgres.js';
import { crearFinalizarViajeYCobrar } from '../../src/aplicacion/viajes/finalizarViajeYCobrar.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

// Rama 10 (tema 13, ADR 009): el historial de viajes sale de la proyección `historial_viajes` en la
// base `lectura`, alimentada por los ViajeCambiado que deja el trigger de la migración 006; los
// movimientos de la billetera se leen de la base `billetera`, sin proyección.

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
    const historial = crearProyectorHistorialPostgres(pools.lectura);
    await ejecutar({ pools, billeteras, historial });
  } finally {
    await cerrarPools(pools);
  }
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)',
    [id, `${rol}-${crypto.randomUUID()}@example.com`, 'hash-de-prueba', rol],
  );
  return id;
}

async function crearChofer(pool) {
  const choferId = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, FALSE)`,
    [choferId, `HIS-${crypto.randomUUID().slice(0, 8)}`],
  );
  return choferId;
}

async function insertarViaje(pool, { pasajeroId, choferId = null, estado = 'solicitado', importe = 1300, solicitadoAt = null }) {
  const { rows } = await pool.query(
    `INSERT INTO viajes (pasajero_id, chofer_id, estado, origen, destino, estimacion_centavos, solicitado_at, asignado_at, iniciado_at)
     VALUES ($1, $2, $3,
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.98, -27.44), 4326)::geography,
       $4, COALESCE($5::timestamptz, now()),
       CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
       CASE WHEN $3 = 'en_curso' THEN now() ELSE NULL END)
     RETURNING id`,
    [pasajeroId, choferId, estado, importe, solicitadoAt],
  );
  return rows[0].id;
}

// Los eventos de un viaje, leídos directo del outbox (sin importar si otro test ya los marcó
// procesados): así el test no depende del despachador ni de los demás archivos que corren a la vez.
async function eventosDelViaje(pools, viajeId) {
  const { rows } = await pools.viajes.query(
    "SELECT id, tipo, datos FROM outbox_viajes WHERE tipo = 'ViajeCambiado' AND datos->>'viajeId' = $1 ORDER BY created_at, id",
    [viajeId],
  );
  return rows;
}

async function proyectar(pools, historial, viajeId) {
  for (const evento of await eventosDelViaje(pools, viajeId)) await historial.aplicar(evento);
}

async function filaDelHistorial(pools, viajeId) {
  const { rows } = await pools.lectura.query('SELECT * FROM historial_viajes WHERE viaje_id = $1', [viajeId]);
  return rows[0];
}

test('el trigger deja un ViajeCambiado por cada INSERT y UPDATE de viajes, con la versión siempre creciente', async (t) => {
  await conBases(t, async ({ pools }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const choferId = await crearChofer(pools.viajes);
    const viajeId = await insertarViaje(pools.viajes, { pasajeroId });
    await pools.viajes.query("UPDATE viajes SET chofer_id = $2, estado = 'asignado', asignado_at = now(), version = version + 1 WHERE id = $1", [viajeId, choferId]);
    // Un UPDATE que se olvida de subir la versión: la sube el trigger (BEFORE UPDATE).
    await pools.viajes.query("UPDATE viajes SET estado = 'chofer_en_camino' WHERE id = $1", [viajeId]);

    const eventos = await eventosDelViaje(pools, viajeId);
    assert.deepEqual(eventos.map((e) => [e.datos.estado, e.datos.version]), [['solicitado', 1], ['asignado', 2], ['chofer_en_camino', 3]]);
    const ultimo = eventos[2].datos;
    assert.equal(ultimo.pasajeroId, pasajeroId);
    assert.equal(ultimo.choferId, choferId);
    assert.deepEqual(ultimo.origen, { latitud: -27.4514, longitud: -58.9867 });
    assert.equal(ultimo.estimacionCentavos, 1300);
    const { rows } = await pools.viajes.query('SELECT version FROM viajes WHERE id = $1', [viajeId]);
    assert.equal(rows[0].version, 3);
  });
});

test('si el cambio del viaje se deshace (ROLLBACK), su evento tampoco queda en el outbox', async (t) => {
  await conBases(t, async ({ pools }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const viajeId = await insertarViaje(pools.viajes, { pasajeroId });
    const client = await pools.viajes.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE viajes SET estado = 'cancelado_pasajero', cancelado_at = now() WHERE id = $1", [viajeId]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    assert.deepEqual((await eventosDelViaje(pools, viajeId)).map((e) => e.datos.estado), ['solicitado']);
  });
});

test('la proyección queda con el último estado aunque los eventos lleguen repetidos, desordenados y a la vez', async (t) => {
  await conBases(t, async ({ pools, historial }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const choferId = await crearChofer(pools.viajes);
    const viajeId = await insertarViaje(pools.viajes, { pasajeroId });
    await pools.viajes.query("UPDATE viajes SET chofer_id = $2, estado = 'asignado', asignado_at = now() WHERE id = $1", [viajeId, choferId]);
    await pools.viajes.query("UPDATE viajes SET estado = 'cancelado_chofer', cancelado_at = now(), motivo_cancelacion = 'auto roto' WHERE id = $1", [viajeId]);
    const eventos = await eventosDelViaje(pools, viajeId);
    assert.equal(eventos.length, 3);

    // El último primero, después todos de nuevo (entrega "al menos una vez"), en paralelo.
    const desordenados = [eventos[2], eventos[0], eventos[1], eventos[2], eventos[1], eventos[0]];
    const resultados = await Promise.all(desordenados.map((e) => historial.aplicar(e)));
    assert.ok(resultados.filter((r) => r.aplicado).length <= 3);

    const fila = await filaDelHistorial(pools, viajeId);
    assert.equal(fila.estado, 'cancelado_chofer');
    assert.equal(fila.version, 3);
    assert.equal(fila.motivo_cancelacion, 'auto roto');
    assert.equal(fila.chofer_id, choferId);
  });
});

test('el cobro real (finalizar con saldo) se ve en el historial, y reconstruir desde el outbox da lo mismo', async (t) => {
  await conBases(t, async ({ pools, billeteras, historial }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    await billeteras.crearBilleteraPorEvento({ eventoId: crypto.randomUUID(), pasajeroId });
    await billeteras.registrarCargaDesdeWebhook({ eventoExternoId: `his-${crypto.randomUUID()}`, pasajeroId, importeCentavos: 5000 }, Buffer.from('{}'));
    const choferId = await crearChofer(pools.viajes);
    const viajeId = await insertarViaje(pools.viajes, { pasajeroId, choferId, estado: 'en_curso', importe: 1300 });

    const finalizar = crearFinalizarViajeYCobrar({ unidadDeTrabajo: crearUnidadDeTrabajoCobroPostgres(pools.viajes), billetera: billeteras, logger: loggerMudo });
    await finalizar({ viajeId, choferId });
    await proyectar(pools, historial, viajeId);

    const fila = await filaDelHistorial(pools, viajeId);
    assert.equal(fila.estado, 'finalizado');
    assert.equal(fila.tarifa_final_centavos, 1300);
    assert.ok(fila.finalizado_at);
    // en_curso (1) → pago_pendiente con la tarifa (2) → finalizado (3): el cobro en dos pasos del ADR 008.
    assert.deepEqual((await eventosDelViaje(pools, viajeId)).map((e) => e.datos.estado), ['en_curso', 'pago_pendiente', 'finalizado']);

    // Reconstrucción: se borra la fila y se reproducen los eventos.
    await pools.lectura.query('DELETE FROM historial_viajes WHERE viaje_id = $1', [viajeId]);
    await proyectar(pools, historial, viajeId);
    const reconstruida = await filaDelHistorial(pools, viajeId);
    assert.deepEqual({ ...reconstruida, actualizado_at: null }, { ...fila, actualizado_at: null });
  });
});

test('los movimientos se listan del más nuevo al más viejo, con tope, y sólo los del pasajero', async (t) => {
  await conBases(t, async ({ billeteras }) => {
    const pasajeroId = crypto.randomUUID();
    const otroId = crypto.randomUUID();
    await billeteras.crearBilleteraPorEvento({ eventoId: crypto.randomUUID(), pasajeroId });
    await billeteras.crearBilleteraPorEvento({ eventoId: crypto.randomUUID(), pasajeroId: otroId });
    const cargar = (id, importe) => billeteras.registrarCargaDesdeWebhook({ eventoExternoId: `mov-${crypto.randomUUID()}`, pasajeroId: id, importeCentavos: importe }, Buffer.from('{}'));
    await cargar(pasajeroId, 10000);
    const viajeId = crypto.randomUUID();
    await billeteras.cobrar({ pasajeroId, viajeId, importeCentavos: 2500 });
    await cargar(pasajeroId, 700);
    await cargar(otroId, 999);

    const movimientos = await billeteras.listarMovimientosPorPasajero(pasajeroId, { limite: 20 });
    assert.deepEqual(movimientos.map((m) => [m.tipo, m.importeCentavos, m.viajeId]), [
      ['carga', 700, null], ['consumo', 2500, viajeId], ['carga', 10000, null],
    ]);
    assert.ok(movimientos[0].creadoAt instanceof Date);
    assert.equal((await billeteras.listarMovimientosPorPasajero(pasajeroId, { limite: 2 })).length, 2);
    await assert.rejects(billeteras.listarMovimientosPorPasajero(crypto.randomUUID(), { limite: 20 }), { codigo: 'BILLETERA_NO_ENCONTRADA' });
  });
});

// La app real con las dos rutas nuevas sobre las bases de prueba.
async function conApp(pools, billeteras, historial, fn) {
  const config = {
    CORS_ORIGINS: ['http://localhost:5173'],
    JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars',
    JWT_ACCESS_TOKEN_TTL: '15m',
    RATE_LIMIT_LOGIN_VENTANA_MS: 60_000,
    RATE_LIMIT_LOGIN_MAX: 100,
    RATE_LIMIT_WEBHOOK_VENTANA_MS: 60_000,
    RATE_LIMIT_WEBHOOK_MAX: 100,
    RATE_LIMIT_UBICACION_VENTANA_MS: 60_000,
    RATE_LIMIT_UBICACION_MAX: 100,
    IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  };
  const tokens = crearServicioJwt(config);
  const noUsado = async () => { throw new Error('no usado en este test'); };
  const app = crearApp({
    config,
    logger: loggerMudo,
    verificarDisponibilidad: async () => true,
    autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
    billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, listarMovimientosPorPasajero: billeteras.listarMovimientosPorPasajero, tokens },
    viajes: { solicitarViaje: noUsado, buscarViajePropio: noUsado, ofrecerAlChoferCercano: noUsado, reintentarCobro: noUsado, cancelarViaje: noUsado, listarHistorial: historial.listarPorPasajero, tokens },
    ofertas: { aceptarOferta: noUsado, rechazarOferta: noUsado, tokens },
    choferes: { cambiarDisponibilidad: noUsado, registrarUbicacion: noUsado, avanzarEstado: noUsado, finalizarYCobrar: noUsado, cancelarViaje: noUsado, buscarOfertaPendiente: noUsado, buscarViajeActual: noUsado, tokens },
    administracion: { establecerHabilitacion: noUsado, tokens },
    operador: { listarViajesActivos: noUsado, cancelarViaje: noUsado, reintentarCobro: noUsado, tokens },
    idempotencia: crearRepositorioIdempotenciaPostgres(pools.viajes),
  });
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`, tokens);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
}

test('GET /viajes devuelve el historial del pasajero desde la proyección: sólo los suyos, del más nuevo al más viejo', async (t) => {
  await conBases(t, async ({ pools, billeteras, historial }) => {
    const pasajeroId = await crearUsuario(pools.viajes, 'pasajero');
    const otroId = await crearUsuario(pools.viajes, 'pasajero');
    const viejo = await insertarViaje(pools.viajes, { pasajeroId, solicitadoAt: '2026-11-01T10:00:00Z' });
    const nuevo = await insertarViaje(pools.viajes, { pasajeroId, solicitadoAt: '2026-11-02T10:00:00Z' });
    const ajeno = await insertarViaje(pools.viajes, { pasajeroId: otroId });
    for (const id of [viejo, nuevo, ajeno]) await proyectar(pools, historial, id);

    await conApp(pools, billeteras, historial, async (baseUrl, tokens) => {
      const pedir = (consulta, rol = Rol.PASAJERO, id = pasajeroId) => fetch(`${baseUrl}/viajes${consulta}`, {
        headers: { authorization: `Bearer ${tokens.crearTokenDeAcceso({ usuarioId: id, rol })}` },
      });

      const respuesta = await pedir('');
      assert.equal(respuesta.status, 200);
      const { viajes } = await respuesta.json();
      assert.deepEqual(viajes.map((v) => v.viajeId), [nuevo, viejo]);
      assert.equal(viajes[0].estado, 'solicitado');
      assert.deepEqual(viajes[0].destino, { latitud: -27.44, longitud: -58.98 });
      assert.equal(viajes[0].pasajeroId, undefined, 'no hace falta devolver el id propio');

      assert.deepEqual((await (await pedir('?limite=1')).json()).viajes.map((v) => v.viajeId), [nuevo]);
      for (const mala of ['?limite=0', '?limite=51', '?limite=abc', '?pasajeroId=x']) {
        assert.equal((await pedir(mala)).status, 400, mala);
      }
      assert.equal((await pedir('', Rol.CHOFER)).status, 403);
      assert.equal((await fetch(`${baseUrl}/viajes`)).status, 401);
    });
  });
});

test('GET /billetera/me/movimientos lee la base billetera: 200 con los movimientos, 404 sin billetera, 403 para un chofer', async (t) => {
  await conBases(t, async ({ pools, billeteras, historial }) => {
    const pasajeroId = crypto.randomUUID();
    await billeteras.crearBilleteraPorEvento({ eventoId: crypto.randomUUID(), pasajeroId });
    await billeteras.registrarCargaDesdeWebhook({ eventoExternoId: `http-${crypto.randomUUID()}`, pasajeroId, importeCentavos: 4200 }, Buffer.from('{}'));

    await conApp(pools, billeteras, historial, async (baseUrl, tokens) => {
      const pedir = (consulta, rol = Rol.PASAJERO, id = pasajeroId) => fetch(`${baseUrl}/billetera/me/movimientos${consulta}`, {
        headers: { authorization: `Bearer ${tokens.crearTokenDeAcceso({ usuarioId: id, rol })}` },
      });
      const respuesta = await pedir('');
      assert.equal(respuesta.status, 200);
      const { movimientos } = await respuesta.json();
      assert.equal(movimientos.length, 1);
      assert.equal(movimientos[0].tipo, 'carga');
      assert.equal(movimientos[0].importeCentavos, 4200);
      assert.equal(movimientos[0].viajeId, null);
      assert.ok(!Number.isNaN(Date.parse(movimientos[0].creadoAt)));

      assert.equal((await pedir('?limite=0')).status, 400);
      assert.equal((await pedir('', Rol.PASAJERO, crypto.randomUUID())).status, 404);
      assert.equal((await pedir('', Rol.CHOFER)).status, 403);
    });
  });
});
