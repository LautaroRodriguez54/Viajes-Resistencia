
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = {
  JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
  JWT_ACCESS_TOKEN_TTL: '15m',
  CORS_ORIGINS: ['http://localhost:3000'],
};

const tokens = crearServicioJwt(config);

const pasajeroId = '11111111-1111-4111-8111-111111111111';
const otroPasajeroId = '22222222-2222-4222-8222-222222222222';
const choferId = '33333333-3333-4333-8333-333333333333';
const viajeId = '44444444-4444-4444-8444-444444444444';
const ofertaId = '55555555-5555-4555-8555-555555555555';

function crearToken(rol, usuarioId) {
  return tokens.crearTokenDeAcceso({ rol, usuarioId });
}

async function levantarApp(overrides = {}) {
  const dependencias = {
    config,
    logger: { error() {}, warn() {}, info() {} },
    verificarDisponibilidad: async () => true,

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

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

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

function autorizacion(rol, usuarioId) {
  return {
    Authorization: `Bearer ${crearToken(rol, usuarioId)}`,
    'Content-Type': 'application/json',
  };
}

test('un pasajero no puede modificar la disponibilidad de un chofer', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/disponibilidad`, {
      method: 'PUT',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({ disponible: true }),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    choferes: {
      cambiarDisponibilidad: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un pasajero no puede registrar ubicación como chofer', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/choferes/me/ubicacion`, {
      method: 'PUT',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
      body: JSON.stringify({
        latitud: -27.4514,
        longitud: -58.9867,
      }),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    choferes: {
      registrarUbicacion: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un pasajero no puede aceptar una oferta', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/ofertas/${ofertaId}/aceptar`, {
      method: 'POST',
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    ofertas: {
      aceptarOferta: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un chofer no puede habilitar a otro chofer', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(
      `${url}/admin/choferes/${choferId}/habilitacion`,
      {
        method: 'PATCH',
        headers: autorizacion(Rol.CHOFER, choferId),
        body: JSON.stringify({ habilitado: true }),
      }
    );

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    administracion: {
      establecerHabilitacion: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un chofer no puede consultar la billetera de pasajero', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/billetera/me`, {
      headers: autorizacion(Rol.CHOFER, choferId),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    billetera: {
      consultarSaldoPorPasajero: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un chofer no puede solicitar un viaje como pasajero', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes`, {
      method: 'POST',
      headers: autorizacion(Rol.CHOFER, choferId),
      body: JSON.stringify({
        origen: { latitud: -27.4514, longitud: -58.9867 },
        destino: { latitud: -27.46, longitud: -58.99 },
      }),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    viajes: {
      solicitarViaje: async () => {
        ejecutado = true;
      },
    },
  });
});

test('un pasajero no puede consultar el viaje de otro pasajero', async () => {
  let usuarioConsultado;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes/${viajeId}`, {
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
    });

    assert.equal(respuesta.status, 404);
    assert.equal(usuarioConsultado, pasajeroId);
  }, {
    viajes: {
      buscarViajePropio: async (_id, idDelPasajero) => {
        usuarioConsultado = idDelPasajero;
        return null;
      },
    },
  });
});

test('un pasajero puede consultar su propio viaje', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/viajes/${viajeId}`, {
      headers: autorizacion(Rol.PASAJERO, pasajeroId),
    });

    assert.equal(respuesta.status, 200);

    const datos = await respuesta.json();
    assert.equal(datos.viaje.id, viajeId);
  }, {
    viajes: {
      buscarViajePropio: async (id, idDelPasajero) => {
        if (id !== viajeId || idDelPasajero !== pasajeroId) return null;
        return { id: viajeId, pasajeroId };
      },
    },
  });
});

test('un pasajero no puede consultar una billetera ajena mediante otro rol', async () => {
  let ejecutado = false;

  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/billetera/me`, {
      headers: autorizacion(Rol.ADMINISTRADOR, otroPasajeroId),
    });

    assert.equal(respuesta.status, 403);
    assert.equal(ejecutado, false);
  }, {
    billetera: {
      consultarSaldoPorPasajero: async () => {
        ejecutado = true;
      },
    },
  });
});
