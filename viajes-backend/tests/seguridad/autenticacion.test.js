
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { ErrorDeDominio } from '../../src/dominio/errores.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';
const SECRET_ALTERNO = 'otro-secreto-de-prueba-con-mas-de-32-caracteres';

const config = {
  JWT_SECRET: SECRET,
  JWT_ACCESS_TOKEN_TTL: '15m',
  IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  CORS_ORIGINS: ['http://localhost:3000'],
};

const tokens = crearServicioJwt(config);

async function levantarApp(overrides = {}) {
  const dependencias = {
    autenticacion: {
      registrarUsuario: async (datos) => ({ usuario: datos }),
      iniciarSesion: async () => {
        throw new ErrorDeDominio(
          'CREDENCIALES_INVALIDAS',
          'Credenciales inválidas.'
        );
      },
      buscarUsuarioPorId: async (id) => ({
        id,
        email: 'pasajero@test.com',
        rol: Rol.PASAJERO,
      }),
      tokens,
      ...overrides.autenticacion,
    },
    billetera: {
      procesarCargaWebhook: async () => ({ procesado: true }),
      consultarSaldoPorPasajero: async () => ({ saldoCentavos: 0 }),
      tokens,
    },
    viajes: {
      solicitarViaje: async () => ({}),
      buscarViajePropio: async () => null,
      ofrecerAlChoferCercano: async () => ({}),
      tokens,
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
    verificarDisponibilidad: async () => true,
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
  };

  const app = crearApp({
    ...dependencias,
    ...overrides,
    autenticacion: {
      ...dependencias.autenticacion,
      ...overrides.autenticacion,
    },
  });

  const server = createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
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

function tokenDePrueba(
  rol = Rol.PASAJERO,
  usuarioId = '11111111-1111-4111-8111-111111111111'
) {
  return tokens.crearTokenDeAcceso({ usuarioId, rol });
}

test('login devuelve una sesión cuando las credenciales son correctas', async () => {
  await conApp(async (url) => {
    const instancia = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pasajero@test.com',
        password: 'password-seguro-123',
      }),
    });

    assert.equal(instancia.status, 200);
  }, {
    autenticacion: {
      iniciarSesion: async () => ({
        token: tokenDePrueba(),
      }),
    },
  });
});

test('login rechaza credenciales incorrectas', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pasajero@test.com',
        password: 'password-incorrecto',
      }),
    });

    assert.equal(respuesta.status, 401);
  });
});

test('login rechaza un email inexistente cuando las credenciales no coinciden', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'inexistente@test.com',
        password: 'password-seguro-123',
      }),
    });

    assert.equal(respuesta.status, 401);
  });
});

test('registro rechaza campos adicionales', async () => {
  let registroEjecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nuevo@test.com',
        password: 'password-seguro-123',
        rol: Rol.PASAJERO,
        administrador: true,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(registroEjecutado, false);
  }, {
    autenticacion: {
      registrarUsuario: async () => {
        registroEjecutado = true;
      },
    },
  });
});

test('registro no permite crear usuarios administradores', async () => {
  let registroEjecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@test.com',
        password: 'password-seguro-123',
        rol: Rol.ADMINISTRADOR,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(registroEjecutado, false);
  }, {
    autenticacion: {
      registrarUsuario: async () => {
        registroEjecutado = true;
      },
    },
  });
});

test('GET /auth/me rechaza solicitudes sin token', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`);

    assert.equal(respuesta.status, 401);
  });
});

test('GET /auth/me rechaza tokens malformados', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`, {
      headers: { Authorization: 'Bearer token-invalido' },
    });

    assert.equal(respuesta.status, 401);
  });
});

test('GET /auth/me rechaza tokens firmados con otra clave', async () => {
  const tokensAlternos = crearServicioJwt({
    ...config,
    JWT_SECRET: SECRET_ALTERNO,
  });

  const token = tokensAlternos.crearTokenDeAcceso({
    usuarioId: '11111111-1111-4111-8111-111111111111',
    rol: Rol.PASAJERO,
  });

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(respuesta.status, 401);
  });
});

test('GET /auth/me rechaza tokens vencidos', async () => {
  const tokensVencidos = crearServicioJwt({
    ...config,
    JWT_ACCESS_TOKEN_TTL: '1s',
  });

  const token = tokensVencidos.crearTokenDeAcceso({
    usuarioId: '11111111-1111-4111-8111-111111111111',
    rol: Rol.PASAJERO,
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(respuesta.status, 401);
  });
});

test('GET /auth/me permite consultar el perfil con token válido', async () => {
  const id = '11111111-1111-4111-8111-111111111111';

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`, {
      headers: {
        Authorization: `Bearer ${tokenDePrueba(Rol.PASAJERO, id)}`,
      },
    });

    assert.equal(respuesta.status, 200);

    const datos = await respuesta.json();

    assert.equal(datos.usuario.id, id);
    assert.equal(datos.usuario.rol, Rol.PASAJERO);
  });
});

test('GET /auth/me rechaza un usuario que ya no existe', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenDePrueba()}` },
    });

    assert.equal(respuesta.status, 401);
  }, {
    autenticacion: {
      buscarUsuarioPorId: async () => null,
    },
  });
});
