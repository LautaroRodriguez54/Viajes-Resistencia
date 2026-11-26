
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';

const SECRET = 'secreto-de-prueba-con-mas-de-32-caracteres';

const ORIGEN_PERMITIDO = 'http://localhost:3000';
const ORIGEN_NO_PERMITIDO = 'https://sitio-malicioso.example';

const config = {
  JWT_SECRET: SECRET,
  JWT_ACCESS_TOKEN_TTL: '15m',
  CORS_ORIGINS: [ORIGEN_PERMITIDO],
};

const tokens = crearServicioJwt(config);

async function levantarApp() {
  const dependencias = {
    autenticacion: {
      registrarUsuario: async () => ({}),
      iniciarSesion: async () => ({}),
      buscarUsuarioPorId: async () => null,
      tokens,
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
    logger: { error() {} },
    verificarDisponibilidad: async () => true,
  };

  const app = crearApp(dependencias);
  const server = createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));

  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cerrar() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

async function conApp(callback) {
  const instancia = await levantarApp();

  try {
    await callback(instancia.baseUrl);
  } finally {
    await instancia.cerrar();
  }
}

test('no expone el encabezado X-Powered-By', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`);

    assert.equal(respuesta.headers.get('x-powered-by'), null);
  });
});

test('incluye encabezados HTTP básicos de seguridad', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`);

    assert.equal(
      respuesta.headers.get('x-content-type-options'),
      'nosniff'
    );

    assert.equal(
        respuesta.headers.get('x-frame-options'),
        'SAMEORIGIN'
    );

    assert.equal(
      respuesta.headers.get('content-security-policy'),
      "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'"
    );
  });
});

test('autoriza el origen configurado en CORS', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`, {
      headers: {
        Origin: ORIGEN_PERMITIDO,
      },
    });

    assert.equal(
      respuesta.headers.get('access-control-allow-origin'),
      ORIGEN_PERMITIDO
    );
  });
});

test('no autoriza orígenes que no están configurados', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`, {
      headers: {
        Origin: ORIGEN_NO_PERMITIDO,
      },
    });

    assert.equal(
      respuesta.headers.get('access-control-allow-origin'),
      null
    );
  });
});

test('responde correctamente a un preflight CORS permitido', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGEN_PERMITIDO,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });

    assert.equal(respuesta.status, 204);

    assert.equal(
      respuesta.headers.get('access-control-allow-origin'),
      ORIGEN_PERMITIDO
    );

    assert.ok(
      respuesta.headers.get('access-control-allow-methods')
    );

    assert.ok(
      respuesta.headers.get('access-control-allow-headers')
    );
  });
});

test('no habilita CORS cuando la solicitud no incluye Origin', async () => {
  await conApp(async (url) => {
    const respuesta = await fetch(`${url}/health`);

    assert.equal(respuesta.status, 200);

    assert.equal(
      respuesta.headers.get('access-control-allow-origin'),
      null
    );
  });
});
