import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { crearContextoPorPedido } from '../../src/infra/http/contexto.js';
import { manejadorDeErrores } from '../../src/infra/http/errores.js';
import { requiereAutenticacion } from '../../src/infra/http/autenticacion.js';
import { crearIdempotencia, huellaDelPedido } from '../../src/infra/http/idempotencia.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { ErrorDeDominio } from '../../src/dominio/errores.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const TTL = 86_400;
const loggerMudo = { info() {}, warn() {}, error() {} };
const tokens = crearServicioJwt({ JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars', JWT_ACCESS_TOKEN_TTL: '15m' });

// App mínima: POST /recursos/:id ejecuta `manejar` detrás del middleware.
function crearAppDePrueba(manejar, repositorio = crearRepositorioIdempotenciaEnMemoria()) {
  const idempotente = crearIdempotencia({ repositorio, ttlSegundos: TTL, logger: loggerMudo });
  const app = express();
  app.use(crearContextoPorPedido());
  app.use(express.json());
  app.post('/recursos/:id', requiereAutenticacion(tokens), idempotente('pruebas.crear'), manejar);
  app.use(manejadorDeErrores(loggerMudo));
  return { app, repositorio };
}

async function conServidor(app, fn) {
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
}

function tokenDe(usuarioId = crypto.randomUUID()) {
  return tokens.crearTokenDeAcceso({ usuarioId, rol: Rol.PASAJERO });
}

function enviar(baseUrl, { token, clave, cuerpo = { a: 1 }, id = 'r1' }) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (clave !== undefined) headers['idempotency-key'] = clave;
  return fetch(`${baseUrl}/recursos/${id}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
}

test('la misma Idempotency-Key con el mismo cuerpo devuelve la respuesta guardada sin ejecutar de nuevo', async () => {
  let ejecuciones = 0;
  const { app } = crearAppDePrueba((_req, res) => {
    ejecuciones += 1;
    res.status(201).json({ creado: crypto.randomUUID() });
  });
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const clave = crypto.randomUUID();
    const primera = await enviar(baseUrl, { token, clave });
    const segunda = await enviar(baseUrl, { token, clave });
    assert.equal(primera.status, 201);
    assert.equal(segunda.status, 201);
    assert.deepEqual(await segunda.json(), await primera.json());
    assert.equal(primera.headers.get('idempotency-replayed'), null);
    assert.equal(segunda.headers.get('idempotency-replayed'), 'true');
    assert.equal(ejecuciones, 1);
  });
});

test('sin Idempotency-Key o con una clave inválida responde 400 y no ejecuta', async () => {
  let ejecuciones = 0;
  const { app } = crearAppDePrueba((_req, res) => {
    ejecuciones += 1;
    res.status(201).json({});
  });
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const sinClave = await enviar(baseUrl, { token });
    assert.equal(sinClave.status, 400);
    assert.equal((await sinClave.json()).error.codigo, 'CLAVE_IDEMPOTENCIA_REQUERIDA');
    for (const clave of ['corta', 'con espacio adentro', 'x'.repeat(256), 'ñandú-ñandú']) {
      const res = await enviar(baseUrl, { token, clave });
      assert.equal(res.status, 400, clave);
      assert.equal((await res.json()).error.codigo, 'CLAVE_IDEMPOTENCIA_INVALIDA');
    }
    assert.equal(ejecuciones, 0);
  });
});

test('la misma clave con otro cuerpo u otro recurso responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
  let ejecuciones = 0;
  const { app } = crearAppDePrueba((_req, res) => {
    ejecuciones += 1;
    res.status(201).json({});
  });
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const clave = crypto.randomUUID();
    assert.equal((await enviar(baseUrl, { token, clave, cuerpo: { a: 1 } })).status, 201);
    const otroCuerpo = await enviar(baseUrl, { token, clave, cuerpo: { a: 2 } });
    assert.equal(otroCuerpo.status, 422);
    assert.equal((await otroCuerpo.json()).error.codigo, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const otroRecurso = await enviar(baseUrl, { token, clave, cuerpo: { a: 1 }, id: 'r2' });
    assert.equal(otroRecurso.status, 422);
    assert.equal(ejecuciones, 1);
  });
});

test('un pedido repetido mientras el primero sigue en curso responde 409 PEDIDO_EN_CURSO', async () => {
  let ejecuciones = 0;
  let liberarPrimero;
  const primeroEnCurso = new Promise((resolver) => { liberarPrimero = resolver; });
  let avisarQueEmpezo;
  const empezo = new Promise((resolver) => { avisarQueEmpezo = resolver; });
  const { app } = crearAppDePrueba(async (_req, res) => {
    ejecuciones += 1;
    avisarQueEmpezo();
    await primeroEnCurso;
    res.status(201).json({ ok: true });
  });
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const clave = crypto.randomUUID();
    const primera = enviar(baseUrl, { token, clave });
    await empezo;
    const segunda = await enviar(baseUrl, { token, clave });
    assert.equal(segunda.status, 409);
    assert.equal((await segunda.json()).error.codigo, 'PEDIDO_EN_CURSO');
    liberarPrimero();
    assert.equal((await primera).status, 201);
    assert.equal(ejecuciones, 1);
  });
});

test('un error 4xx de dominio se guarda y se repite; un 5xx libera la clave para reintentar', async () => {
  let ejecuciones = 0;
  let fallarCon = 'dominio';
  const { app, repositorio } = crearAppDePrueba(() => {
    ejecuciones += 1;
    if (fallarCon === 'dominio') throw new ErrorDeDominio('SALDO_INSUFICIENTE', 'No alcanza.');
    throw new Error('se cayó la base');
  });
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const clave4xx = crypto.randomUUID();
    const a = await enviar(baseUrl, { token, clave: clave4xx });
    const b = await enviar(baseUrl, { token, clave: clave4xx });
    assert.equal(a.status, 409);
    assert.equal(b.status, 409);
    assert.equal(b.headers.get('idempotency-replayed'), 'true');
    assert.deepEqual(await b.json(), await a.json());
    assert.equal(ejecuciones, 1);

    fallarCon = 'interno';
    const clave5xx = crypto.randomUUID();
    assert.equal((await enviar(baseUrl, { token, clave: clave5xx })).status, 500);
    const reintento = await enviar(baseUrl, { token, clave: clave5xx });
    assert.equal(reintento.status, 500);
    assert.equal(reintento.headers.get('idempotency-replayed'), null);
    assert.equal(ejecuciones, 3);
    assert.equal([...repositorio.filas.values()].filter((f) => f.estado === 'procesando').length, 0);
  });
});

test('la clave es por actor: otro usuario con la misma clave ejecuta su propio pedido', async () => {
  let ejecuciones = 0;
  const { app } = crearAppDePrueba((req, res) => {
    ejecuciones += 1;
    res.status(201).json({ de: req.autenticacion.usuarioId });
  });
  await conServidor(app, async (baseUrl) => {
    const clave = crypto.randomUUID();
    const a = await (await enviar(baseUrl, { token: tokenDe(), clave })).json();
    const b = await (await enviar(baseUrl, { token: tokenDe(), clave })).json();
    assert.notEqual(a.de, b.de);
    assert.equal(ejecuciones, 2);
  });
});

test('una clave vencida (TTL) se trata como nueva', async () => {
  let reloj = Date.now();
  let ejecuciones = 0;
  const repositorio = crearRepositorioIdempotenciaEnMemoria({ ahora: () => reloj });
  const { app } = crearAppDePrueba((_req, res) => {
    ejecuciones += 1;
    res.status(201).json({ n: ejecuciones });
  }, repositorio);
  await conServidor(app, async (baseUrl) => {
    const token = tokenDe();
    const clave = crypto.randomUUID();
    await enviar(baseUrl, { token, clave });
    reloj += TTL * 1000;
    const res = await enviar(baseUrl, { token, clave });
    assert.equal(res.headers.get('idempotency-replayed'), null);
    assert.deepEqual(await res.json(), { n: 2 });
  });
});

test('la huella no depende del orden de las claves del cuerpo pero sí de la ruta', () => {
  const pedido = (originalUrl, body) => ({ method: 'POST', originalUrl, body });
  assert.equal(
    huellaDelPedido(pedido('/viajes', { origen: { latitud: 1, longitud: 2 }, destino: 3 })),
    huellaDelPedido(pedido('/viajes?x=1', { destino: 3, origen: { longitud: 2, latitud: 1 } })),
  );
  assert.notEqual(huellaDelPedido(pedido('/viajes/a/finalizar', undefined)), huellaDelPedido(pedido('/viajes/b/finalizar', undefined)));
});

test('crearIdempotencia exige repositorio y un TTL entero positivo', () => {
  assert.throws(() => crearIdempotencia({ ttlSegundos: TTL }), /repositorio/);
  assert.throws(() => crearIdempotencia({ repositorio: crearRepositorioIdempotenciaEnMemoria(), ttlSegundos: 0 }), /TTL/);
});
