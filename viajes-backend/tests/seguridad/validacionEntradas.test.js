
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
const viajeId = '44444444-4444-4444-8444-444444444444';

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
      solicitarViaje: async () => ({ id: viajeId }),
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

function solicitudValida() {
  return {
    origen: { latitud: -27.4514, longitud: -58.9867 },
    destino: { latitud: -27.46, longitud: -58.99 },
  };
}

test('solicitar viaje rechaza campos obligatorios ausentes', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({ origen: solicitudValida().origen }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});
test('solicitar viaje rechaza coordenadas con tipos incorrectos', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({
        origen: { latitud: '-27.4514', longitud: -58.9867 },
        destino: solicitudValida().destino,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('solicitar viaje rechaza coordenadas fuera de rango', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({
        origen: { latitud: 120, longitud: -58.9867 },
        destino: solicitudValida().destino,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('solicitar viaje rechaza campos adicionales no declarados', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({
        ...solicitudValida(),
        pasajeroId: '99999999-9999-4999-8999-999999999999',
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('actualizar disponibilidad rechaza campos adicionales', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/disponibilidad`, {
      method: 'PUT',
      headers: autorizacion(Rol.CHOFER, choferId),
      body: JSON.stringify({
        disponible: true,
        administrador: true,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    choferes: {
      cambiarDisponibilidad: async () => {
        ejecutado = true;
      },
    },
  });
});

test('registrar ubicación rechaza coordenadas inválidas', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/ubicacion`, {
      method: 'PUT',
      headers: autorizacion(Rol.CHOFER, choferId),
      body: JSON.stringify({
        latitud: -27.4514,
        longitud: 250,
      }),
    });

    assert.equal(respuesta.status, 400);
    assert.equal(ejecutado, false);
  }, {
    choferes: {
      registrarUbicacion: async () => {
        ejecutado = true;
      },
    },
  });
});
