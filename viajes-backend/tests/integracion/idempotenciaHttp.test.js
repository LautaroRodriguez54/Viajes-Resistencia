import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearSolicitarViaje } from '../../src/aplicacion/viajes/solicitarViaje.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const loggerMudo = { info() {}, warn() {}, error() {} };
const ORIGEN = { latitud: -27.4514, longitud: -58.9867 };
const DESTINO = { latitud: -27.44, longitud: -58.98 };

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  assert.equal(new URL(databaseUrl).pathname, '/viajes_test', 'Las pruebas solo pueden ejecutarse contra viajes_test');
  const pool = crearPoolPostgres({ DATABASE_URL: databaseUrl, DATABASE_SSL: false });
  try {
    await ejecutar(pool);
  } finally {
    await pool.end();
  }
}

// La app real (rutas, middleware y repositorios Postgres) con fakes sólo en lo
// que estos tests no usan.
async function conApp(pool, fn) {
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
  const viajes = crearRepositorioViajesPostgres(pool);
  const noUsado = async () => { throw new Error('no usado en este test'); };
  const app = crearApp({
    config,
    logger: loggerMudo,
    verificarDisponibilidad: async () => true,
    autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
    billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, tokens },
    viajes: {
      solicitarViaje: crearSolicitarViaje({ viajes }),
      buscarViajePropio: viajes.buscarPorIdDelPasajero,
      ofrecerAlChoferCercano: viajes.ofrecerAlChoferCercano,
      reintentarCobro: viajes.reintentarCobro,
      tokens,
    },
    ofertas: { aceptarOferta: viajes.aceptarOferta, tokens },
    choferes: { cambiarDisponibilidad: noUsado, registrarUbicacion: noUsado, avanzarEstado: viajes.avanzarEstado, finalizarYCobrar: viajes.finalizarYCobrar, tokens },
    administracion: { establecerHabilitacion: noUsado, tokens },
    idempotencia: crearRepositorioIdempotenciaPostgres(pool),
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

async function asegurarTarifaActiva(pool) {
  await pool.query(
    `INSERT INTO parametros_tarifa
       (base_centavos, por_kilometro_centavos, por_minuto_centavos, maximo_viaje_centavos, velocidad_promedio_kmh)
     VALUES (500, 250, 100, 100000, 30)
     ON CONFLICT DO NOTHING`,
  );
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)',
    [id, `${rol}-${crypto.randomUUID()}@example.com`, 'hash-de-prueba', rol],
  );
  return id;
}

async function crearPasajero(pool) {
  const pasajeroId = await crearUsuario(pool, 'pasajero');
  const billetera = await pool.query('INSERT INTO billeteras (pasajero_id) VALUES ($1) RETURNING id', [pasajeroId]);
  return { pasajeroId, billeteraId: billetera.rows[0].id };
}

async function crearViajeEnCurso(pool, pasajeroId, importe) {
  const choferId = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, FALSE)`,
    [choferId, `TEST-${crypto.randomUUID().slice(0, 8)}`],
  );
  const viaje = await pool.query(
    `INSERT INTO viajes (pasajero_id, chofer_id, estado, origen, destino, estimacion_centavos, asignado_at, iniciado_at)
     VALUES ($1, $2, 'en_curso',
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.98, -27.44), 4326)::geography,
       $3, now(), now())
     RETURNING id`,
    [pasajeroId, choferId, importe],
  );
  return { choferId, viajeId: viaje.rows[0].id };
}

function solicitar(baseUrl, token, clave) {
  return fetch(`${baseUrl}/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': clave },
    body: JSON.stringify({ origen: ORIGEN, destino: DESTINO }),
  });
}

async function contarViajes(pool, pasajeroId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM viajes WHERE pasajero_id = $1', [pasajeroId]);
  return r.rows[0].n;
}

test('POST /viajes repetido con la misma Idempotency-Key crea un solo viaje y devuelve la misma respuesta', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    await asegurarTarifaActiva(pool);
    const { pasajeroId } = await crearPasajero(pool);
    await conApp(pool, async (baseUrl, tokens) => {
      const token = tokens.crearTokenDeAcceso({ usuarioId: pasajeroId, rol: Rol.PASAJERO });
      const clave = crypto.randomUUID();
      const primera = await solicitar(baseUrl, token, clave);
      const segunda = await solicitar(baseUrl, token, clave);
      assert.equal(primera.status, 201);
      assert.equal(segunda.status, 201);
      assert.equal(segunda.headers.get('idempotency-replayed'), 'true');
      const cuerpo1 = await primera.json();
      assert.deepEqual(await segunda.json(), cuerpo1);
      assert.equal(await contarViajes(pool, pasajeroId), 1);

      const guardada = await pool.query(
        'SELECT estado, respuesta_status, respuesta_body FROM claves_idempotencia WHERE actor_id = $1 AND clave = $2',
        [pasajeroId, clave],
      );
      assert.equal(guardada.rows[0].estado, 'completada');
      assert.equal(guardada.rows[0].respuesta_status, 201);
      assert.equal(guardada.rows[0].respuesta_body.viaje.id, cuerpo1.viaje.id);

      // Con otra clave es otra intención: crea otro viaje.
      assert.equal((await solicitar(baseUrl, token, crypto.randomUUID())).status, 201);
      assert.equal(await contarViajes(pool, pasajeroId), 2);
    });
  });
});

test('10 POST /viajes simultáneos con la misma Idempotency-Key crean exactamente un viaje', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    await asegurarTarifaActiva(pool);
    const { pasajeroId } = await crearPasajero(pool);
    await conApp(pool, async (baseUrl, tokens) => {
      const token = tokens.crearTokenDeAcceso({ usuarioId: pasajeroId, rol: Rol.PASAJERO });
      const clave = crypto.randomUUID();
      const respuestas = await Promise.all(Array.from({ length: 10 }, () => solicitar(baseUrl, token, clave)));
      const estados = respuestas.map((r) => r.status);
      assert.ok(estados.includes(201), `alguna debe crear: ${estados}`);
      assert.ok(estados.every((s) => s === 201 || s === 409), `sólo 201 o 409: ${estados}`);
      const ids = new Set();
      for (const r of respuestas) {
        const cuerpo = await r.json();
        if (r.status === 201) ids.add(cuerpo.viaje.id);
        else assert.equal(cuerpo.error.codigo, 'PEDIDO_EN_CURSO');
      }
      assert.equal(ids.size, 1, 'todas las 201 devuelven el mismo viaje');
      assert.equal(await contarViajes(pool, pasajeroId), 1);
    });
  });
});

test('finalizar repetido con la misma clave devuelve el mismo cobro; con otra clave el viaje ya está finalizado', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    await pool.query("INSERT INTO movimientos_billetera (billetera_id, tipo, importe_centavos) VALUES ($1, 'carga', 10000)", [billeteraId]);
    const { choferId, viajeId } = await crearViajeEnCurso(pool, pasajeroId, 5000);
    await conApp(pool, async (baseUrl, tokens) => {
      const token = tokens.crearTokenDeAcceso({ usuarioId: choferId, rol: Rol.CHOFER });
      const finalizar = (clave) => fetch(`${baseUrl}/choferes/viajes/${viajeId}/finalizar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': clave },
      });
      const clave = crypto.randomUUID();
      const primera = await finalizar(clave);
      const reintento = await finalizar(clave);
      assert.equal(primera.status, 200);
      assert.equal(reintento.status, 200);
      assert.deepEqual(await reintento.json(), await primera.json());

      const otraClave = await finalizar(crypto.randomUUID());
      assert.equal(otraClave.status, 409);
      assert.equal((await otraClave.json()).error.codigo, 'TRANSICION_INVALIDA');

      const consumos = await pool.query("SELECT COUNT(*)::int AS n FROM movimientos_billetera WHERE viaje_id = $1 AND tipo = 'consumo'", [viajeId]);
      assert.equal(consumos.rows[0].n, 1);
    });
  });
});

test('repositorioIdempotenciaPostgres: una clave vencida o liberada se puede reservar de nuevo', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const repo = crearRepositorioIdempotenciaPostgres(pool);
    const pedido = { actorId: pasajeroId, ambito: 'pruebas', clave: crypto.randomUUID(), requestSha256: 'a'.repeat(64), ttlSegundos: 60 };

    const primera = await repo.reservar(pedido);
    assert.equal(primera.nueva, true);
    const enCurso = await repo.reservar(pedido);
    assert.equal(enCurso.nueva, false);
    assert.equal(enCurso.estado, 'procesando');

    await repo.liberar(primera.id);
    const trasLiberar = await repo.reservar(pedido);
    assert.equal(trasLiberar.nueva, true);

    await repo.completar(trasLiberar.id, { status: 201, cuerpo: { ok: true } });
    const completada = await repo.reservar(pedido);
    assert.deepEqual(
      { estado: completada.estado, status: completada.respuestaStatus, cuerpo: completada.respuestaCuerpo },
      { estado: 'completada', status: 201, cuerpo: { ok: true } },
    );
    // liberar no borra una clave completada
    await repo.liberar(trasLiberar.id);
    assert.equal((await repo.reservar(pedido)).nueva, false);

    await pool.query("UPDATE claves_idempotencia SET created_at = now() - interval '61 seconds' WHERE id = $1", [trasLiberar.id]);
    assert.equal((await repo.reservar(pedido)).nueva, true);
  });
});
