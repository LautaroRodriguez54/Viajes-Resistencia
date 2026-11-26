
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = {
  JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
  JWT_ACCESS_TOKEN_TTL: '15m',
  IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  CORS_ORIGINS: ['http://localhost:3000'],
};

const tokens = crearServicioJwt(config);

const pasajeroId = '11111111-1111-4111-8111-111111111111';
const choferId = '33333333-3333-4333-8333-333333333333';

function autorizacion(rol, usuarioId) {
  return {
    Authorization: `Bearer ${tokens.crearTokenDeAcceso({ rol, usuarioId })}`,
    'Idempotency-Key': crypto.randomUUID(),
    'Content-Type': 'application/json',
  };
}

async function levantarApp(overrides = {}) {
  const dependencias = {
    config,
    logger: { error() {}, warn() {}, info() {} },
    verificarDisponibilidad: async () => true,
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),

    autenticacion: {
      registrarUsuario: async () => ({}),
      iniciarSesion: async () => ({}),
      buscarUsuarioPorId: async (id) => ({
        id,
        email: 'usuario@test.com',
        rol: Rol.PASAJERO,
      }),
      tokens,
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
  };

  const app = crearApp({
    ...dependencias,
    ...overrides,
    autenticacion: {
      ...dependencias.autenticacion,
      ...overrides.autenticacion,
    },
    billetera: {
      ...dependencias.billetera,
      ...overrides.billetera,
    },
    viajes: {
      ...dependencias.viajes,
      ...overrides.viajes,
    },
    ofertas: {
      ...dependencias.ofertas,
      ...overrides.ofertas,
    },
    choferes: {
      ...dependencias.choferes,
      ...overrides.choferes,
    },
    administracion: {
      ...dependencias.administracion,
      ...overrides.administracion,
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

function prototipoIntacto() {
  assert.equal(
    Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'),
    false,
    'Object.prototype no debe adquirir la propiedad polluted',
  );

  assert.equal(
    ({}).polluted,
    undefined,
    'Los objetos nuevos no deben heredar la propiedad polluted',
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(Object.prototype, 'administrador'),
    false,
    'Object.prototype no debe adquirir la propiedad administrador',
  );
}

test('registro rechaza una propiedad __proto__', async () => {
  const cuerpo = JSON.parse(`{
    "email": "nuevo@test.com",
    "password": "password-seguro-123",
    "rol": "PASAJERO",
    "__proto__": {
      "polluted": true
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    autenticacion: {
      registrarUsuario: async () => {
        ejecutado = true;
      },
    },
  });
});

test('registro rechaza constructor.prototype', async () => {
  const cuerpo = JSON.parse(`{
    "email": "nuevo@test.com",
    "password": "password-seguro-123",
    "rol": "PASAJERO",
    "constructor": {
      "prototype": {
        "administrador": true
      }
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    autenticacion: {
      registrarUsuario: async () => {
        ejecutado = true;
      },
    },
  });
});

test('solicitud de viaje rechaza __proto__ en un objeto anidado', async () => {
  const cuerpo = JSON.parse(`{
    "origen": {
      "latitud": -27.4514,
      "longitud": -58.9867,
      "__proto__": {
        "polluted": true
      }
    },
    "destino": {
      "latitud": -27.46,
      "longitud": -58.99
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('solicitud de viaje rechaza constructor.prototype anidado', async () => {
  const cuerpo = JSON.parse(`{
    "origen": {
      "latitud": -27.4514,
      "longitud": -58.9867
    },
    "destino": {
      "latitud": -27.46,
      "longitud": -58.99,
      "constructor": {
        "prototype": {
          "administrador": true
        }
      }
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('disponibilidad rechaza propiedades maliciosas', async () => {
  const cuerpo = JSON.parse(`{
    "disponible": true,
    "__proto__": {
      "polluted": true
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/disponibilidad`, {
      method: 'PUT',
      headers: autorizacion(Rol.CHOFER, choferId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    choferes: {
      cambiarDisponibilidad: async () => {
        ejecutado = true;
      },
    },
  });
});

test('ubicación rechaza constructor.prototype', async () => {
  const cuerpo = JSON.parse(`{
    "latitud": -27.4514,
    "longitud": -58.9867,
    "constructor": {
      "prototype": {
        "administrador": true
      }
    }
  }`);

  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/ubicacion`, {
      method: 'PUT',
      headers: autorizacion(Rol.CHOFER, choferId),
      body: JSON.stringify(cuerpo),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
    prototipoIntacto();
  }, {
    choferes: {
      registrarUbicacion: async () => {
        ejecutado = true;
      },
    },
  });
});

test('una solicitud maliciosa no afecta solicitudes posteriores', async () => {
  const cuerpoMalicioso = JSON.parse(`{
    "email": "nuevo@test.com",
    "password": "password-seguro-123",
    "rol": "PASAJERO",
    "__proto__": {
      "polluted": true
    }
  }`);

  let registrosEjecutados = 0;

  await conApp(async (url) => {
    const maliciosa = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify(cuerpoMalicioso),
    });

    assert.equal(maliciosa.status, 400);
    prototipoIntacto();

    const normal = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({
        email: 'normal@test.com',
        password: 'password-seguro-123',
        rol: Rol.PASAJERO,
      }),
    });

    assert.equal(normal.status, 201);
    assert.equal(registrosEjecutados, 1);
    prototipoIntacto();
  }, {
    autenticacion: {
      registrarUsuario: async (datos) => {
        registrosEjecutados++;
        return { usuario: datos };
      },
    },
  });
});
