import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { ErrorDeDominio } from '../../src/dominio/errores.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { crearValidadorOpenApi } from '../ayudantes/validadorOpenApi.js';

const validador = crearValidadorOpenApi();

const config = {
  JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
  JWT_ACCESS_TOKEN_TTL: '15m',
  WEBHOOK_HMAC_SECRET: 'secreto-webhook-de-prueba-con-mas-de-32-caracteres',
  CORS_ORIGINS: ['http://localhost:3000'],
  IDEMPOTENCIA_TTL_SEGUNDOS: 86400,
  RATE_LIMIT_LOGIN_VENTANA_MS: 900000,
  RATE_LIMIT_LOGIN_MAX: 50,
  RATE_LIMIT_WEBHOOK_VENTANA_MS: 60000,
  RATE_LIMIT_WEBHOOK_MAX: 50,
  RATE_LIMIT_UBICACION_VENTANA_MS: 60000,
  RATE_LIMIT_UBICACION_MAX: 50,
};

const tokens = crearServicioJwt(config);

const IDS = {
  pasajero: '11111111-1111-4111-8111-111111111111',
  chofer: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  operador: '44444444-4444-4444-8444-444444444444',
  viaje: '55555555-5555-4555-8555-555555555555',
  oferta: '66666666-6666-4666-8666-666666666666',
  billetera: '77777777-7777-4777-8777-777777777777',
  movimiento: '88888888-8888-4888-8888-888888888888',
  tarifa: '99999999-9999-4999-8999-999999999999',
};

const FECHA = '2026-11-27T12:00:00.000Z';

const VIAJE_BASE = {
  id: IDS.viaje,
  estado: 'solicitado',
  pasajeroId: IDS.pasajero,
  choferId: null,
  estimacionCentavos: 784000,
  tarifaFinalCentavos: null,
  solicitadoAt: FECHA,
  origen: { latitud: -27.4514, longitud: -58.9867, nombre: 'Plaza 25 de Mayo' },
  destino: { latitud: -27.44, longitud: -58.98, nombre: 'Terminal' },
};

function token(rol, usuarioId) {
  return tokens.crearTokenDeAcceso({ usuarioId, rol });
}

async function conServidor(trabajo, {
  verificarDisponibilidad = async () => true,
  viajesOverrides = {},
  ofertasOverrides = {},
} = {}) {
  const app = crearApp({
    config,
    logger: { error() {}, warn() {}, info() {} },
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
    verificarDisponibilidad,
    autenticacion: {
      tokens,
      registrarUsuario: async ({ email, rol }) => ({
        usuario: { id: IDS.pasajero, email, rol },
        accessToken: token(rol, IDS.pasajero),
      }),
      iniciarSesion: async ({ email }) => ({
        usuario: { id: IDS.pasajero, email, rol: Rol.PASAJERO },
        accessToken: token(Rol.PASAJERO, IDS.pasajero),
      }),
      buscarUsuarioPorId: async (id) => ({
        id,
        email: 'pasajero@demo.local',
        rol: Rol.PASAJERO,
        createdAt: FECHA,
      }),
    },
    viajes: {
      tokens,
      estimarViaje: async () => ({
        importeCentavos: 784000,
        kilometros: 4.64,
        minutos: 12,
      }),
      solicitarViaje: async () => ({
        ...VIAJE_BASE,
        estimacion: { importeCentavos: 784000, kilometros: 4.64, minutos: 12 },
      }),
      listarHistorial: async () => ([{
        viajeId: IDS.viaje,
        choferId: null,
        estado: 'solicitado',
        origen: VIAJE_BASE.origen,
        destino: VIAJE_BASE.destino,
        estimacionCentavos: 784000,
        tarifaFinalCentavos: null,
        solicitadoAt: FECHA,
        asignadoAt: null,
        iniciadoAt: null,
        finalizadoAt: null,
        canceladoAt: null,
        motivoCancelacion: null,
      }]),
      buscarViajePropio: async () => ({
        ...VIAJE_BASE,
        tieneOfertaVigente: false,
        chofer: null,
      }),
      ofrecerAlChoferCercano: async () => ({
        ofertaId: IDS.oferta,
        choferId: IDS.chofer,
        venceAt: FECHA,
      }),
      reintentarCobro: async () => ({
        viajeId: IDS.viaje,
        estado: 'finalizado',
        importeCentavos: 784000,
      }),
      cancelarViaje: async () => ({
        viajeId: IDS.viaje,
        estado: 'cancelado_pasajero',
        canceladoAt: FECHA,
        motivo: 'Cambio de planes',
      }),
      ...viajesOverrides,
    },
    ofertas: {
      tokens,
      aceptarOferta: async () => ({
        viajeId: IDS.viaje,
        ofertaId: IDS.oferta,
        estado: 'asignado',
      }),
      rechazarOferta: async () => ({
        viajeId: IDS.viaje,
        ofertaId: IDS.oferta,
        estado: 'rechazada',
        viajeEstado: 'sin_choferes_disponibles',
        reofrecida: false,
      }),
      ...ofertasOverrides,
    },
    choferes: {
      tokens,
      cambiarDisponibilidad: async (_id, disponible) => ({ choferId: IDS.chofer, disponible, updatedAt: FECHA }),
      registrarUbicacion: async (_id, { latitud, longitud }) => ({
        choferId: IDS.chofer,
        latitud,
        longitud,
      }),
      buscarOfertaPendiente: async () => null,
      buscarViajeActual: async () => null,
      avanzarEstado: async () => ({
        viajeId: IDS.viaje,
        estado: 'chofer_en_camino',
      }),
      finalizarYCobrar: async () => ({
        viajeId: IDS.viaje,
        estado: 'finalizado',
        importeCentavos: 784000,
      }),
      cancelarViaje: async () => ({
        viajeId: IDS.viaje,
        estado: 'cancelado_chofer',
        canceladoAt: FECHA,
        motivo: null,
      }),
    },
    billetera: {
      tokens,
      consultarSaldoPorPasajero: async () => ({ saldoCentavos: 500000 }),
      listarMovimientosPorPasajero: async () => ([{
        id: IDS.movimiento,
        tipo: 'carga',
        importeCentavos: 500000,
        viajeId: null,
        creadoAt: FECHA,
      }]),
      procesarCargaWebhook: async ({ firma }) => {
        if (!firma) throw new ErrorDeDominio('FIRMA_WEBHOOK_INVALIDA', 'Firma inválida.');
        return { procesado: true, duplicado: false };
      },
    },
    operador: {
      tokens,
      listarViajesActivos: async () => ([
        { ...VIAJE_BASE, choferId: IDS.chofer, patente: 'DEMO001', estado: 'asignado' },
      ]),
      cancelarViaje: async () => ({
        viajeId: IDS.viaje,
        estado: 'cancelado_operador',
        canceladoAt: FECHA,
        motivo: 'Incidente reportado',
      }),
      reintentarCobro: async () => ({
        viajeId: IDS.viaje,
        estado: 'finalizado',
        importeCentavos: 784000,
      }),
    },
    administracion: {
      tokens,
      listarChoferes: async () => ([{
        choferId: IDS.chofer,
        email: 'chofer@demo.local',
        vehiculo: { patente: 'DEMO001', marca: 'Fiat', modelo: 'Cronos' },
        habilitado: true,
        disponible: false,
        registradoAt: FECHA,
      }]),
      establecerHabilitacion: async (choferId, habilitado) => ({
        choferId,
        habilitado,
        disponible: habilitado,
      }),
      obtenerTarifa: async () => ({
        id: IDS.tarifa,
        baseCentavos: 150000,
        porKilometroCentavos: 90000,
        porMinutoCentavos: 18000,
        velocidadPromedioKmh: 25,
        maximoViajeCentavos: 10000000,
        vigenteDesde: FECHA,
      }),
      reemplazarTarifa: async () => ({
        id: IDS.tarifa,
        baseCentavos: 160000,
        porKilometroCentavos: 90000,
        porMinutoCentavos: 18000,
        velocidadPromedioKmh: 25,
        maximoViajeCentavos: 10000000,
        vigenteDesde: FECHA,
      }),
      obtenerMetricas: async () => ({
        uptimeSegundos: 12,
        eventLoopLagMs: { min: 0.1, max: 2.0, media: 0.3, p50: 0.2, p95: 0.5, p99: 1.1 },
        memoriaMb: { rss: 48, heapTotal: 32, heapUsed: 20, external: 2 },
        negocio: { viajesActivos: 1, pagosPendientes: 0, choferesHabilitados: 1, choferesPorHabilitar: 0, choferesDisponibles: 1 },
      }),
    },
  });

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await trabajo(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function pedir(baseUrl, metodo, rutaUrl, { jwt, idempotencyKey, body } = {}) {
  const headers = {};
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${rutaUrl}`, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('OpenAPI 3.1: el contrato declara version 3.1.0 y sus endpoints principales', () => {
  assert.equal(validador.documento.openapi, '3.1.0');
  assert.ok(Object.keys(validador.documento.paths).length >= 29);
});

test('Contrato OpenAPI: las respuestas 2xx de los endpoints principales cumplen el esquema', async () => {
  const jwtPasajero = token(Rol.PASAJERO, IDS.pasajero);
  const jwtChofer = token(Rol.CHOFER, IDS.chofer);
  const jwtOperador = token(Rol.OPERADOR, IDS.operador);
  const jwtAdmin = token(Rol.ADMINISTRADOR, IDS.admin);

  await conServidor(async (baseUrl) => {
    const casos = [
      ['GET', '/health', '/health', 200, {}],
      ['GET', '/ready', '/ready', 200, {}],
      ['POST', '/auth/register', '/auth/register', 201, { body: { email: 'nuevo@demo.local', password: 'PasswordSeguro123!', rol: 'pasajero' } }],
      ['POST', '/auth/login', '/auth/login', 200, { body: { email: 'pasajero@demo.local', password: 'PasswordSeguro123!' } }],
      ['GET', '/auth/me', '/auth/me', 200, { jwt: jwtPasajero }],
      ['POST', '/viajes/estimacion', '/viajes/estimacion', 200, { jwt: jwtPasajero, body: { origen: { latitud: -27.4514, longitud: -58.9867 }, destino: { latitud: -27.44, longitud: -58.98 } } }],
      ['POST', '/viajes', '/viajes', 201, { jwt: jwtPasajero, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', body: { origen: { latitud: -27.4514, longitud: -58.9867, nombre: 'Plaza 25 de Mayo' }, destino: { latitud: -27.44, longitud: -58.98, nombre: 'Terminal' } } }],
      ['GET', '/viajes', '/viajes', 200, { jwt: jwtPasajero }],
      ['GET', '/viajes/{viajeId}', `/viajes/${IDS.viaje}`, 200, { jwt: jwtPasajero }],
      ['POST', '/viajes/{viajeId}/ofertas', `/viajes/${IDS.viaje}/ofertas`, 201, { jwt: jwtPasajero, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' }],
      ['POST', '/viajes/{viajeId}/reintentar-cobro', `/viajes/${IDS.viaje}/reintentar-cobro`, 200, { jwt: jwtPasajero, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' }],
      ['POST', '/viajes/{viajeId}/cancelar', `/viajes/${IDS.viaje}/cancelar`, 200, { jwt: jwtPasajero, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', body: { motivo: 'Cambio de planes' } }],
      ['POST', '/ofertas/{ofertaId}/aceptar', `/ofertas/${IDS.oferta}/aceptar`, 200, { jwt: jwtChofer, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5' }],
      ['POST', '/ofertas/{ofertaId}/rechazar', `/ofertas/${IDS.oferta}/rechazar`, 200, { jwt: jwtChofer, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6' }],
      ['PUT', '/choferes/me/disponibilidad', '/choferes/me/disponibilidad', 200, { jwt: jwtChofer, body: { disponible: true } }],
      ['PUT', '/choferes/me/ubicacion', '/choferes/me/ubicacion', 200, { jwt: jwtChofer, body: { latitud: -27.4514, longitud: -58.9867 } }],
      ['GET', '/choferes/me/ofertas', '/choferes/me/ofertas', 200, { jwt: jwtChofer }],
      ['GET', '/choferes/me/viaje-actual', '/choferes/me/viaje-actual', 200, { jwt: jwtChofer }],
      ['POST', '/choferes/viajes/{viajeId}/estado', `/choferes/viajes/${IDS.viaje}/estado`, 200, { jwt: jwtChofer, body: { estado: 'chofer_en_camino' } }],
      ['POST', '/choferes/viajes/{viajeId}/finalizar', `/choferes/viajes/${IDS.viaje}/finalizar`, 200, { jwt: jwtChofer, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7' }],
      ['POST', '/choferes/viajes/{viajeId}/cancelar', `/choferes/viajes/${IDS.viaje}/cancelar`, 200, { jwt: jwtChofer, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8' }],
      ['GET', '/billetera/me', '/billetera/me', 200, { jwt: jwtPasajero }],
      ['GET', '/billetera/me/movimientos', '/billetera/me/movimientos', 200, { jwt: jwtPasajero }],
      ['GET', '/operador/viajes', '/operador/viajes?estado=activos', 200, { jwt: jwtOperador }],
      ['POST', '/operador/viajes/{viajeId}/cancelar', `/operador/viajes/${IDS.viaje}/cancelar`, 200, { jwt: jwtOperador, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', body: { motivo: 'Incidente reportado' } }],
      ['POST', '/operador/viajes/{viajeId}/reintentar-cobro', `/operador/viajes/${IDS.viaje}/reintentar-cobro`, 200, { jwt: jwtOperador, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10' }],
      ['GET', '/admin/choferes', '/admin/choferes', 200, { jwt: jwtAdmin }],
      ['PATCH', '/admin/choferes/{choferId}/habilitacion', `/admin/choferes/${IDS.chofer}/habilitacion`, 200, { jwt: jwtAdmin, body: { habilitado: true } }],
      ['GET', '/admin/tarifa', '/admin/tarifa', 200, { jwt: jwtAdmin }],
      ['POST', '/admin/tarifa', '/admin/tarifa', 201, { jwt: jwtAdmin, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11', body: { baseCentavos: 160000, porKilometroCentavos: 90000, porMinutoCentavos: 18000, maximoViajeCentavos: 10000000 } }],
      ['GET', '/admin/metricas', '/admin/metricas', 200, { jwt: jwtAdmin }],
    ];

    for (const [metodo, rutaOpenApi, rutaReal, statusEsperado, opciones] of casos) {
      const { status, json } = await pedir(baseUrl, metodo, rutaReal, opciones);
      assert.equal(status, statusEsperado, `${metodo} ${rutaReal} devolvió ${status}: ${JSON.stringify(json)}`);
      validador.validarRespuesta(metodo, rutaOpenApi, status, json);
    }

    const cuerpoWebhook = JSON.stringify({
      eventoExternoId: 'demo-contrato-1',
      pasajeroId: IDS.pasajero,
      importeCentavos: 500000,
    });
    const firma = `sha256=${createHmac('sha256', config.WEBHOOK_HMAC_SECRET).update(cuerpoWebhook).digest('hex')}`;
    const resWebhook = await fetch(`${baseUrl}/billetera/webhooks/cargas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': firma },
      body: cuerpoWebhook,
    });
    assert.equal(resWebhook.status, 201);
    validador.validarRespuesta('POST', '/billetera/webhooks/cargas', 201, await resWebhook.json());
  });
});

test('Contrato OpenAPI: las respuestas de error 400, 401, 403, 404, 409, 422 y 503 cumplen el esquema Error', async () => {
  const jwtPasajero = token(Rol.PASAJERO, IDS.pasajero);
  const jwtChofer = token(Rol.CHOFER, IDS.chofer);

  await conServidor(async (baseUrl) => {
    const sinToken = await pedir(baseUrl, 'GET', '/auth/me');
    assert.equal(sinToken.status, 401);
    validador.validarRespuesta('GET', '/auth/me', 401, sinToken.json);

    const firmaInvalida = await pedir(baseUrl, 'POST', '/billetera/webhooks/cargas', {
      body: { eventoExternoId: 'demo-bad', pasajeroId: IDS.pasajero, importeCentavos: 1000 },
    });
    assert.equal(firmaInvalida.status, 401);
    validador.validarRespuesta('POST', '/billetera/webhooks/cargas', 401, firmaInvalida.json);

    const rolIncorrecto = await pedir(baseUrl, 'GET', '/admin/tarifa', { jwt: jwtChofer });
    assert.equal(rolIncorrecto.status, 403);
    validador.validarRespuesta('GET', '/admin/tarifa', 403, rolIncorrecto.json);

    const sinIdempotencia = await pedir(baseUrl, 'POST', '/viajes', {
      jwt: jwtPasajero,
      body: { origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.44, longitud: -58.97 } },
    });
    assert.equal(sinIdempotencia.status, 400);
    validador.validarRespuesta('POST', '/viajes', 400, sinIdempotencia.json);

    const uuidInvalido = await pedir(baseUrl, 'GET', '/viajes/no-es-uuid', { jwt: jwtPasajero });
    assert.equal(uuidInvalido.status, 400);
    validador.validarRespuesta('GET', '/viajes/{viajeId}', 400, uuidInvalido.json);

    const noEncontrado = await pedir(baseUrl, 'GET', `/viajes/${IDS.viaje}`, { jwt: jwtPasajero });
    assert.equal(noEncontrado.status, 404);
    validador.validarRespuesta('GET', '/viajes/{viajeId}', 404, noEncontrado.json);

    const conflicto = await pedir(baseUrl, 'POST', `/ofertas/${IDS.oferta}/aceptar`, {
      jwt: jwtChofer,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa98',
    });
    assert.equal(conflicto.status, 409);
    validador.validarRespuesta('POST', '/ofertas/{ofertaId}/aceptar', 409, conflicto.json);

    const superaMaximo = await pedir(baseUrl, 'POST', '/viajes', {
      jwt: jwtPasajero,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99',
      body: { origen: { latitud: -27.45, longitud: -58.98 }, destino: { latitud: -27.44, longitud: -58.97 } },
    });
    assert.equal(superaMaximo.status, 422);
    validador.validarRespuesta('POST', '/viajes', 422, superaMaximo.json);
  }, {
    viajesOverrides: {
      buscarViajePropio: async () => null,
      solicitarViaje: async () => {
        throw new ErrorDeDominio('VIAJE_SUPERA_MAXIMO', 'Supera máximo.');
      },
    },
    ofertasOverrides: {
      aceptarOferta: async () => {
        throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'Otro chofer aceptó.');
      },
    },
  });

  await conServidor(async (baseUrl) => {
    const noListo = await pedir(baseUrl, 'GET', '/ready');
    assert.equal(noListo.status, 503);
    validador.validarRespuesta('GET', '/ready', 503, noListo.json);
  }, {
    verificarDisponibilidad: async () => {
      throw new ErrorDeDominio('SERVICIO_NO_DISPONIBLE', 'Base caída');
    },
  });
});
