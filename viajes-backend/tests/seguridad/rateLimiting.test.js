
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { ErrorDeDominio } from '../../src/dominio/errores.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';

const SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';

const config = {
  JWT_SECRET: SECRET,
  JWT_ACCESS_TOKEN_TTL: '15m',
  CORS_ORIGINS: ['http://localhost:3000'],
  IDEMPOTENCIA_TTL_SEGUNDOS: 86400,
  RATE_LIMIT_LOGIN_MAX: 5,
  RATE_LIMIT_LOGIN_VENTANA_MS: 900000,
};

const tokens = crearServicioJwt(config);

async function levantarApp(overrides = {}) {
  const dependencias = {
    autenticacion: {
      registrarUsuario: async () => ({}),
      iniciarSesion: async () => {
        throw new ErrorDeDominio(
          'CREDENCIALES_INVALIDAS',
          'Credenciales inválidas.',
        );
      },
      buscarUsuarioPorId: async () => null,
      tokens,
      ...overrides.autenticacion,
    },
    billetera: {
      procesarCargaWebhook: async () => ({}),
      consultarSaldoPorPasajero: async () => ({}),
      tokens,
    },
    viajes: {
      solicitarViaje: async () => ({}),
      buscarViajePropio: async () => null,
      ofrecerAlChoferCercano: async () => ({}),
      tokens,
      ...overrides.viajes,
    },
    ofertas: {
      aceptarOferta: async () => ({}),
      tokens,
    },
    choferes: {
      cambiarDisponibilidad: async () => ({}),
      registrarUbicacion: async () => ({}),
      avanzarEstado: async () => ({}),
      finalizarYCobrar: async () => ({}),
      tokens,
    },
    administracion: {
      establecerHabilitacion: async () => ({}),
      tokens,
    },
    config,
    logger: { error() {}, warn() {}, info() {} },
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
    verificarDisponibilidad: async () => true,
  };

  const app = crearApp({
    ...dependencias,
    ...overrides,
    autenticacion: {
      ...dependencias.autenticacion,
      ...overrides.autenticacion,
    },
    viajes: {
      ...dependencias.viajes,
      ...overrides.viajes,
    },
  });

  const server = createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async cerrar() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

async function conApp(callback, overrides = {}) {
  const instancia = await levantarApp(overrides);

  try {
    await callback(instancia.baseUrl);
  } finally {
    await instancia.cerrar();
  }
}

async function intentarLogin(url) {
  return fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'pasajero@test.com',
      password: 'password-seguro-123',
    }),
  });
}

function verificarHeadersRateLimit(respuesta, limiteEsperado) {
  const headers = respuesta.headers;

  const limite =
    headers.get('ratelimit-limit') ??
    headers.get('x-ratelimit-limit');

  const restantes =
    headers.get('ratelimit-remaining') ??
    headers.get('x-ratelimit-remaining');

  const reset =
    headers.get('ratelimit-reset') ??
    headers.get('x-ratelimit-reset');

  assert.ok(limite, 'Falta el header que informa el límite.');
  assert.ok(restantes, 'Falta el header que informa las solicitudes restantes.');
  assert.ok(reset, 'Falta el header que informa el reinicio del límite.');

  assert.equal(Number(limite), limiteEsperado);
  assert.ok(Number(restantes) >= 0);
  assert.ok(Number(reset) > 0);
}

test('Rate limiting - login permite hasta cinco intentos fallidos', async () => {
  let intentosEjecutados = 0;

  await conApp(async (url) => {
    for (let i = 0; i < 5; i++) {
      const respuesta = await intentarLogin(url);
      assert.equal(respuesta.status, 401);
    }

    assert.equal(intentosEjecutados, 5);
  }, {
    autenticacion: {
      iniciarSesion: async () => {
        intentosEjecutados++;
        throw new ErrorDeDominio(
          'CREDENCIALES_INVALIDAS',
          'Credenciales inválidas.',
        );
      },
    },
  });
});

test('Rate limiting - login bloquea el sexto intento fallido', async () => {
  let intentosEjecutados = 0;

  await conApp(async (url) => {
    for (let i = 0; i < 5; i++) {
      await intentarLogin(url);
    }

    const respuesta = await intentarLogin(url);

    assert.equal(respuesta.status, 429);
    assert.equal(intentosEjecutados, 5);

    verificarHeadersRateLimit(respuesta, 5);
  }, {
    autenticacion: {
      iniciarSesion: async () => {
        intentosEjecutados++;
        throw new ErrorDeDominio(
          'CREDENCIALES_INVALIDAS',
          'Credenciales inválidas.',
        );
      },
    },
  });
});
