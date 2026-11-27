import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearProcesarCargaWebhook } from '../../src/aplicacion/billetera/procesarCargaWebhook.js';
import { crearIniciarCargaDeSaldo, crearConfirmarCargaDeSaldo } from '../../src/aplicacion/billetera/cargarSaldoDesdeWeb.js';
import { crearPasarelaPagosSimulada } from '../../src/infra/externos/pasarelaPagosSimulada.js';
import { crearVerificadorWebhookHmac } from '../../src/infra/externos/verificadorWebhookHmac.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

// Carga de saldo desde la web con la pasarela simulada: la intenciÃ³n no mueve plata, el pago manda
// el webhook firmado de siempre y pagar dos veces (o dos a la vez) acredita una sola vez.

const SECRETO = 'secreto-de-webhook-para-pruebas-de-32-caracteres';
const loggerMudo = { info() {}, warn() {}, error() {} };

async function conApp(t, ejecutar) {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integraciÃ³n');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    const billeteras = crearRepositorioBilleterasPostgres(pools.billetera);
    const procesarCargaWebhook = crearProcesarCargaWebhook({ verificadorFirma: crearVerificadorWebhookHmac(SECRETO), billeteras });
    const pasarela = crearPasarelaPagosSimulada({ secreto: SECRETO, procesarCargaWebhook });
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
      billetera: {
        procesarCargaWebhook,
        consultarSaldoPorPasajero: billeteras.consultarSaldoPorPasajero,
        listarMovimientosPorPasajero: billeteras.listarMovimientosPorPasajero,
        iniciarCargaDeSaldo: crearIniciarCargaDeSaldo({ billeteras }),
        confirmarCargaDeSaldo: crearConfirmarCargaDeSaldo({ billeteras, pasarela }),
        tokens,
      },
      viajes: { solicitarViaje: noUsado, buscarViajePropio: noUsado, ofrecerAlChoferCercano: noUsado, reintentarCobro: noUsado, cancelarViaje: noUsado, listarHistorial: noUsado, tokens },
      ofertas: { aceptarOferta: noUsado, rechazarOferta: noUsado, tokens },
      choferes: { cambiarDisponibilidad: noUsado, registrarUbicacion: noUsado, avanzarEstado: noUsado, finalizarYCobrar: noUsado, cancelarViaje: noUsado, buscarOfertaPendiente: noUsado, buscarViajeActual: noUsado, tokens },
      administracion: { establecerHabilitacion: noUsado, tokens },
      operador: { listarViajesActivos: noUsado, cancelarViaje: noUsado, reintentarCobro: noUsado, tokens },
      idempotencia: crearRepositorioIdempotenciaPostgres(pools.viajes),
    });
    const servidor = await new Promise((resolver) => {
      const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
    });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    try {
      await ejecutar({ pools, billeteras, tokens, base });
    } finally {
      await new Promise((r) => servidor.close(r));
    }
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

async function nuevoPasajero(pools, tokens) {
  const pasajeroId = await crearUsuario(pools.viajes, Rol.PASAJERO);
  await pools.billetera.query('INSERT INTO billeteras (pasajero_id) VALUES ($1)', [pasajeroId]);
  const token = tokens.crearTokenDeAcceso({ usuarioId: pasajeroId, rol: Rol.PASAJERO });
  return { pasajeroId, token };
}

function pedir(base, token, ruta, { cuerpo, clave = crypto.randomUUID() } = {}) {
  return fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': clave },
    body: JSON.stringify(cuerpo ?? {}),
  }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
}

test('carga desde la web: la intenciÃ³n no acredita; al pagar acredita una vez, aunque se pague dos veces a la vez', async (t) => {
  await conApp(t, async ({ pools, billeteras, tokens, base }) => {
    const { pasajeroId, token } = await nuevoPasajero(pools, tokens);

    const creada = await pedir(base, token, '/billetera/me/cargas', { cuerpo: { importeCentavos: 1_000_000 } });
    assert.equal(creada.status, 201);
    assert.equal(creada.cuerpo.carga.estado, 'pendiente');
    assert.equal((await billeteras.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 0);

    const ruta = `/billetera/me/cargas/${creada.cuerpo.carga.id}/pagar`;
    const pagos = await Promise.all([pedir(base, token, ruta), pedir(base, token, ruta), pedir(base, token, ruta)]);
    assert.deepEqual(pagos.map((p) => p.status), [200, 200, 200]);
    assert.ok(pagos.every((p) => p.cuerpo.carga.estado === 'pagada'));
    assert.equal((await billeteras.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 1_000_000);

    const { rows } = await pools.billetera.query(
      'SELECT referencia_externa FROM movimientos_billetera m JOIN billeteras b ON b.id = m.billetera_id WHERE b.pasajero_id = $1',
      [pasajeroId],
    );
    assert.deepEqual(rows.map((r) => r.referencia_externa), [`checkout-${creada.cuerpo.carga.id}`]);
  });
});

test('carga desde la web: si se cae despuÃ©s de acreditar, el prÃ³ximo pago no acredita de nuevo', async (t) => {
  await conApp(t, async ({ pools, billeteras, tokens }) => {
    const { pasajeroId } = await nuevoPasajero(pools, tokens);
    const procesarCargaWebhook = crearProcesarCargaWebhook({ verificadorFirma: crearVerificadorWebhookHmac(SECRETO), billeteras });
    const pasarela = crearPasarelaPagosSimulada({ secreto: SECRETO, procesarCargaWebhook });
    const intencion = await crearIniciarCargaDeSaldo({ billeteras })({ pasajeroId, importeCentavos: 500_000 });

    // La pasarela acredita y justo despuÃ©s "se cae": la intenciÃ³n queda pendiente (ROLLBACK).
    const conCaida = crearConfirmarCargaDeSaldo({
      billeteras,
      pasarela: { confirmarPago: async (i) => { await pasarela.confirmarPago(i); throw new Error('caÃ­da'); } },
    });
    await assert.rejects(conCaida({ intencionId: intencion.id, pasajeroId }), /caÃ­da/);

    const pago = await crearConfirmarCargaDeSaldo({ billeteras, pasarela })({ intencionId: intencion.id, pasajeroId });
    assert.equal(pago.estado, 'pagada');
    assert.equal((await billeteras.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos, 500_000);
  });
});

test('carga desde la web: importes fuera de rango, carga ajena y rol equivocado', async (t) => {
  await conApp(t, async ({ pools, tokens, base }) => {
    const { token } = await nuevoPasajero(pools, tokens);
    const otro = await nuevoPasajero(pools, tokens);

    for (const importeCentavos of [9_999, 50_000_001, 10.5, -1]) {
      const r = await pedir(base, token, '/billetera/me/cargas', { cuerpo: { importeCentavos } });
      assert.equal(r.status, 400, `importe ${importeCentavos}`);
    }
    const extra = await pedir(base, token, '/billetera/me/cargas', { cuerpo: { importeCentavos: 100_000, pasajeroId: otro.pasajeroId } });
    assert.equal(extra.status, 400);

    const ajena = await pedir(base, otro.token, '/billetera/me/cargas', { cuerpo: { importeCentavos: 100_000 } });
    const robo = await pedir(base, token, `/billetera/me/cargas/${ajena.cuerpo.carga.id}/pagar`);
    assert.equal(robo.status, 404);

    const chofer = tokens.crearTokenDeAcceso({ usuarioId: await crearUsuario(pools.viajes, Rol.CHOFER), rol: Rol.CHOFER });
    assert.equal((await pedir(base, chofer, '/billetera/me/cargas', { cuerpo: { importeCentavos: 100_000 } })).status, 403);
  });
});
