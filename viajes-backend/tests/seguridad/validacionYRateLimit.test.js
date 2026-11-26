import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { ErrorDeDominio } from '../../src/dominio/errores.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const JWT_SECRET = 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars';

function crearLoggerEspia() {
  const registros = { info: [], warn: [], error: [] };
  return {
    registros,
    info(datos, mensaje) { registros.info.push({ datos, mensaje }); },
    warn(datos, mensaje) { registros.warn.push({ datos, mensaje }); },
    error(datos, mensaje) { registros.error.push({ datos, mensaje }); },
  };
}

function crearDependenciasPrueba(sobreescribir = {}) {
  const config = {
    CORS_ORIGINS: ['http://localhost:5173'],
    JWT_SECRET,
    JWT_ACCESS_TOKEN_TTL: '15m',
    RATE_LIMIT_LOGIN_VENTANA_MS: 60_000,
    RATE_LIMIT_LOGIN_MAX: 2,
    RATE_LIMIT_WEBHOOK_VENTANA_MS: 60_000,
    RATE_LIMIT_WEBHOOK_MAX: 2,
    RATE_LIMIT_UBICACION_VENTANA_MS: 60_000,
    RATE_LIMIT_UBICACION_MAX: 2,
    ...sobreescribir.config,
  };
  const logger = sobreescribir.logger ?? crearLoggerEspia();
  const tokens = crearServicioJwt(config);

  const autenticacion = {
    registrarUsuario: async () => ({ usuario: { id: 'u-1' }, token: 't' }),
    iniciarSesion: async () => ({ usuario: { id: 'u-1' }, token: 't' }),
    buscarUsuarioPorId: async () => ({ id: 'u-1', email: 'a@b.c', rol: Rol.PASAJERO }),
    tokens,
    ...sobreescribir.autenticacion,
  };

  const billetera = {
    procesarCargaWebhook: async () => ({ duplicado: false, saldoCentavos: 1000 }),
    consultarSaldoPorPasajero: async () => ({ saldoCentavos: 1000 }),
    tokens,
    ...sobreescribir.billetera,
  };

  const viajes = {
    solicitarViaje: async () => ({ id: crypto.randomUUID() }),
    buscarViajePropio: async () => null,
    ofrecerAlChoferCercano: async () => ({ ofertaId: crypto.randomUUID() }),
    reintentarCobro: async () => ({ estado: 'finalizado', importeCentavos: 1000 }),
    tokens,
    ...sobreescribir.viajes,
  };

  const ofertas = {
    aceptarOferta: async () => ({ aceptada: true }),
    tokens,
    ...sobreescribir.ofertas,
  };

  const choferes = {
    cambiarDisponibilidad: async () => ({ disponible: true }),
    registrarUbicacion: async (_choferId, punto) => ({ ok: true, punto }),
    avanzarEstado: async () => ({ estado: 'en_curso' }),
    finalizarYCobrar: async () => ({ estado: 'finalizado' }),
    tokens,
    ...sobreescribir.choferes,
  };

  const administracion = {
    establecerHabilitacion: async () => ({ habilitado: true }),
    tokens,
    ...sobreescribir.administracion,
  };

  const app = crearApp({
    config,
    logger,
    verificarDisponibilidad: async () => true,
    autenticacion,
    billetera,
    viajes,
    ofertas,
    choferes,
    administracion,
  });

  return { app, logger, tokens };
}

async function conServidor(app, fn) {
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  try {
    const { port } = servidor.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolver, rechazar) => {
      servidor.close((error) => (error ? rechazar(error) : resolver()));
    });
  }
}

test('validación de UUID y cuerpo estricto en rutasChoferes devuelve 400 ENTRADA_INVALIDA (nunca 500)', async () => {
  const { app, tokens } = crearDependenciasPrueba();
  const tokenChofer = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.CHOFER });
  const viajeId = crypto.randomUUID();

  await conServidor(app, async (baseUrl) => {
    const casos = [
      {
        url: `${baseUrl}/choferes/viajes/no-es-uuid/estado`,
        body: { estado: 'chofer_en_camino' },
      },
      {
        url: `${baseUrl}/choferes/viajes/${viajeId}/estado`,
        body: { estado: 'chofer_en_camino', extra: true },
      },
      {
        url: `${baseUrl}/choferes/viajes/${viajeId}/estado`,
        body: { estado: 'estado_inexistente' },
      },
      {
        url: `${baseUrl}/choferes/viajes/no-es-uuid/finalizar`,
        body: {},
      },
    ];

    for (const caso of casos) {
      const res = await fetch(caso.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokenChofer}`,
        },
        body: JSON.stringify(caso.body),
      });
      const json = await res.json();
      assert.equal(res.status, 400);
      assert.equal(json.error?.codigo, 'ENTRADA_INVALIDA');
      assert.ok(json.error?.requestId);
    }
  });
});

test('GET /viajes/:viajeId valida UUID y devuelve 400 sin consultar el repositorio', async () => {
  let llamado = false;
  const { app, tokens } = crearDependenciasPrueba({
    viajes: {
      buscarViajePropio: async () => {
        llamado = true;
        return null;
      },
    },
  });
  const tokenPasajero = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.PASAJERO });

  await conServidor(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/viajes/no-es-uuid`, {
      headers: { authorization: `Bearer ${tokenPasajero}` },
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error?.codigo, 'ENTRADA_INVALIDA');
    assert.equal(llamado, false);
  });
});

test('errores de body-parser (JSON malformado 400, >100kb 413, charset 415) preservan requestId', async () => {
  const { app } = crearDependenciasPrueba();

  await conServidor(app, async (baseUrl) => {
    const resMalJson = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-mal-json-1' },
      body: '{"email": ',
    });
    const bodyMalJson = await resMalJson.json();
    assert.equal(resMalJson.status, 400);
    assert.equal(bodyMalJson.error?.codigo, 'JSON_INVALIDO');
    assert.equal(bodyMalJson.error?.requestId, 'req-mal-json-1');
    assert.equal(resMalJson.headers.get('x-request-id'), 'req-mal-json-1');

    const payloadGrande = JSON.stringify({ rellenar: 'a'.repeat(120 * 1024) });
    const resGrande = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payloadGrande,
    });
    const bodyGrande = await resGrande.json();
    assert.equal(resGrande.status, 413);
    assert.equal(bodyGrande.error?.codigo, 'PAYLOAD_DEMASIADO_GRANDE');
    assert.equal(bodyGrande.error?.requestId, resGrande.headers.get('x-request-id'));

    const resCharset = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=iso-8859-1' },
      body: '{"email":"a@b.com"}',
    });
    const bodyCharset = await resCharset.json();
    assert.equal(resCharset.status, 415);
    assert.equal(bodyCharset.error?.codigo, 'CONTENIDO_NO_SOPORTADO');
    assert.equal(bodyCharset.error?.requestId, resCharset.headers.get('x-request-id'));
  });
});

test('ruta inexistente devuelve 404 con requestId y registra log HTTP estructurado', async () => {
  const { app, logger } = crearDependenciasPrueba();

  await conServidor(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/no-existe?foo=bar`, {
      headers: { 'x-request-id': 'req-404-test' },
    });
    const json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error?.codigo, 'RUTA_NO_ENCONTRADA');
    assert.equal(json.error?.requestId, 'req-404-test');
    assert.equal(res.headers.get('x-request-id'), 'req-404-test');

    const logHttp = logger.registros.warn.find((item) => item.mensaje === 'pedido http');
    assert.ok(logHttp);
    assert.equal(logHttp.datos.metodo, 'GET');
    assert.equal(logHttp.datos.ruta, '/no-existe');
    assert.equal(logHttp.datos.status, 404);
    assert.equal(logHttp.datos.requestId, 'req-404-test');
    assert.equal(typeof logHttp.datos.duracionMs, 'number');
  });
});

test('mapeo de CHOFER_NO_ENCONTRADO (404 warn), TRANSICION_INVALIDA (409 warn) y error interno (500 error sin stack)', async () => {
  const { app, logger, tokens } = crearDependenciasPrueba({
    choferes: {
      cambiarDisponibilidad: async () => {
        throw new ErrorDeDominio('CHOFER_NO_ENCONTRADO', 'El chofer no existe.');
      },
      avanzarEstado: async () => {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Transición inválida.');
      },
      finalizarYCobrar: async () => {
        throw new Error('fallo inesperado de db');
      },
    },
  });
  const tokenChofer = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.CHOFER });
  const viajeId = crypto.randomUUID();

  await conServidor(app, async (baseUrl) => {
    const res404 = await fetch(`${baseUrl}/choferes/me/disponibilidad`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenChofer}` },
      body: JSON.stringify({ disponible: true }),
    });
    assert.equal(res404.status, 404);
    assert.equal((await res404.json()).error?.codigo, 'CHOFER_NO_ENCONTRADO');

    const res409 = await fetch(`${baseUrl}/choferes/viajes/${viajeId}/estado`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenChofer}` },
      body: JSON.stringify({ estado: 'en_curso' }),
    });
    assert.equal(res409.status, 409);
    assert.equal((await res409.json()).error?.codigo, 'TRANSICION_INVALIDA');

    const res500 = await fetch(`${baseUrl}/choferes/viajes/${viajeId}/finalizar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenChofer}` },
    });
    const body500 = await res500.json();
    assert.equal(res500.status, 500);
    assert.equal(body500.error?.codigo, 'ERROR_INTERNO');
    assert.equal(body500.error?.stack, undefined);

    assert.ok(logger.registros.warn.some((r) => r.datos.codigo === 'CHOFER_NO_ENCONTRADO' && r.datos.status === 404));
    assert.ok(logger.registros.warn.some((r) => r.datos.codigo === 'TRANSICION_INVALIDA' && r.datos.status === 409));
    assert.ok(logger.registros.error.some((r) => r.datos.codigo === 'ERROR_INTERNO' && r.datos.status === 500));
  });
});

test('rechaza intentos de prototype pollution con 400 ENTRADA_INVALIDA sin contaminar Object.prototype', async () => {
  const { app } = crearDependenciasPrueba();

  await conServidor(app, async (baseUrl) => {
    const payloads = [
      '{"email":"a@b.com","password":"PasswordSegura123","__proto__":{"contaminado":true}}',
      '{"email":"a@b.com","password":"PasswordSegura123","constructor":{"prototype":{"contaminado":true}}}',
    ];
    for (const raw of payloads) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      });
      const json = await res.json();
      assert.equal(res.status, 400);
      assert.equal(json.error?.codigo, 'ENTRADA_INVALIDA');
      assert.equal(({}).contaminado, undefined);
    }
  });
});

test('rechaza acceso entre roles incompatibles con 403 RECURSO_PROHIBIDO', async () => {
  const { app, tokens } = crearDependenciasPrueba();
  const tokenPasajero = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.PASAJERO });
  const tokenChofer = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.CHOFER });

  await conServidor(app, async (baseUrl) => {
    const resChoferEnViaje = await fetch(`${baseUrl}/viajes/${crypto.randomUUID()}`, {
      headers: { authorization: `Bearer ${tokenChofer}` },
    });
    assert.equal(resChoferEnViaje.status, 403);
    assert.equal((await resChoferEnViaje.json()).error?.codigo, 'RECURSO_PROHIBIDO');

    const resPasajeroEnUbicacion = await fetch(`${baseUrl}/choferes/me/ubicacion`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenPasajero}` },
      body: JSON.stringify({ latitud: -27.45, longitud: -58.98 }),
    });
    assert.equal(resPasajeroEnUbicacion.status, 403);
    assert.equal((await resPasajeroEnUbicacion.json()).error?.codigo, 'RECURSO_PROHIBIDO');
  });
});

test('rate limiter en POST /auth/login emite headers draft-6 y devuelve 429 con Retry-After', async () => {
  const { app } = crearDependenciasPrueba();

  await conServidor(app, async (baseUrl) => {
    const enviar = () => fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pasajero@demo.local', password: 'PasswordSegura123' }),
    });

    const r1 = await enviar();
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('ratelimit-limit'), '2');
    assert.equal(r1.headers.get('ratelimit-remaining'), '1');
    assert.ok(r1.headers.get('ratelimit-reset'));
    assert.ok(r1.headers.get('ratelimit-policy'));
    assert.equal(r1.headers.get('x-ratelimit-limit'), null);

    const r2 = await enviar();
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('ratelimit-remaining'), '0');

    const r3 = await enviar();
    const json3 = await r3.json();
    assert.equal(r3.status, 429);
    assert.equal(json3.error?.codigo, 'LIMITE_DE_PETICIONES_EXCEDIDO');
    assert.ok(json3.error?.requestId);
    assert.ok(Number(r3.headers.get('retry-after')) >= 1);
  });
});

test('rate limiter en POST /billetera/webhooks/cargas devuelve 429 al superar el máximo', async () => {
  const { app } = crearDependenciasPrueba();

  await conServidor(app, async (baseUrl) => {
    const enviar = () => fetch(`${baseUrl}/billetera/webhooks/cargas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventoExternoId: crypto.randomUUID(),
        pasajeroId: crypto.randomUUID(),
        importeCentavos: 5000,
      }),
    });

    assert.equal((await enviar()).status, 201);
    assert.equal((await enviar()).status, 201);

    const r3 = await enviar();
    const json3 = await r3.json();
    assert.equal(r3.status, 429);
    assert.equal(json3.error?.codigo, 'LIMITE_DE_PETICIONES_EXCEDIDO');
    assert.ok(r3.headers.get('ratelimit-limit'));
    assert.ok(Number(r3.headers.get('retry-after')) >= 1);
    assert.ok(json3.error?.requestId);
  });
});

test('rate limiter en PUT /choferes/me/ubicacion aísla por chofer (usuarioId) y no bloquea a otro chofer en la misma IP', async () => {
  const { app, tokens } = crearDependenciasPrueba();
  const tokenChoferA = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.CHOFER });
  const tokenChoferB = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.CHOFER });

  await conServidor(app, async (baseUrl) => {
    const enviarUbicacion = (token) => fetch(`${baseUrl}/choferes/me/ubicacion`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ latitud: -27.451, longitud: -58.986 }),
    });

    assert.equal((await enviarUbicacion(tokenChoferA)).status, 200);
    assert.equal((await enviarUbicacion(tokenChoferA)).status, 200);

    const bloqueadoA = await enviarUbicacion(tokenChoferA);
    assert.equal(bloqueadoA.status, 429);
    assert.equal((await bloqueadoA.json()).error?.codigo, 'LIMITE_DE_PETICIONES_EXCEDIDO');

    const okB = await enviarUbicacion(tokenChoferB);
    assert.equal(okB.status, 200);
  });
});
