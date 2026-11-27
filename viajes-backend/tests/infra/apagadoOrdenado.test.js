import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { crearManejadorApagado } from '../../src/infra/http/apagadoOrdenado.js';

function crearLoggerEspia() {
  const registros = { info: [], error: [] };
  return {
    registros,
    info(datos, mensaje) { registros.info.push({ datos, mensaje }); },
    error(datos, mensaje) { registros.error.push({ datos, mensaje }); },
  };
}

test('apagado ordenado: un pedido lento en vuelo termina con 200 antes de cerrar y salir con 0', async () => {
  const logger = crearLoggerEspia();
  let cerrado = false;
  let codigoSalida = null;
  let salioPromesa;
  const alSalir = new Promise((resolver) => { salioPromesa = resolver; });

  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 60);
  });

  await new Promise((resolver) => server.listen(0, '127.0.0.1', resolver));
  const puerto = server.address().port;

  const apagar = crearManejadorApagado({
    server,
    cerrar: async () => { cerrado = true; },
    logger,
    timeoutMs: 2_000,
    salir: (codigo) => {
      codigoSalida = codigo;
      salioPromesa();
    },
  });

  const respuestaPromesa = fetch(`http://127.0.0.1:${puerto}/lento`, {
    headers: { connection: 'close' },
  });
  // Da tiempo a que el pedido entre al handler antes de disparar SIGTERM.
  await new Promise((resolver) => setTimeout(resolver, 15));
  apagar('SIGTERM');

  const respuesta = await respuestaPromesa;
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { ok: true });

  await alSalir;
  assert.equal(cerrado, true);
  assert.equal(codigoSalida, 0);
  assert.ok(logger.registros.info.some((r) => r.mensaje === 'inicio de apagado ordenado'));
  assert.ok(logger.registros.info.some((r) => r.mensaje === 'apagado completo'));
  assert.equal(logger.registros.error.length, 0);
});

test('apagado ordenado: si vence SHUTDOWN_TIMEOUT_MS loguea error antes de salir con 1', async () => {
  const logger = crearLoggerEspia();
  const eventos = [];

  const server = {
    close() {
      // Simula una conexión colgada que nunca termina.
    },
  };

  let salioPromesa;
  const alSalir = new Promise((resolver) => { salioPromesa = resolver; });

  const apagar = crearManejadorApagado({
    server,
    cerrar: async () => {},
    logger: {
      info(datos, mensaje) { logger.info(datos, mensaje); },
      error(datos, mensaje) {
        eventos.push('error');
        logger.error(datos, mensaje);
      },
    },
    timeoutMs: 25,
    salir: (codigo) => {
      eventos.push(`salir:${codigo}`);
      salioPromesa();
    },
  });

  const mantener = setTimeout(() => {}, 500);
  try {
    apagar('SIGTERM');
    await alSalir;
  } finally {
    clearTimeout(mantener);
  }

  assert.deepEqual(eventos, ['error', 'salir:1']);
  assert.equal(logger.registros.error[0].datos.signal, 'SIGTERM');
  assert.equal(logger.registros.error[0].datos.timeoutMs, 25);
});

test('apagado ordenado: si cerrar() falla loguea error y sale con 1', async () => {
  const logger = crearLoggerEspia();
  let codigoSalida = null;
  let salioPromesa;
  const alSalir = new Promise((resolver) => { salioPromesa = resolver; });

  const server = {
    close(cb) { cb(); },
  };

  const apagar = crearManejadorApagado({
    server,
    cerrar: async () => { throw new Error('fallo al cerrar pool'); },
    logger,
    timeoutMs: 1_000,
    salir: (codigo) => {
      codigoSalida = codigo;
      salioPromesa();
    },
  });

  apagar('SIGINT');
  await alSalir;

  assert.equal(codigoSalida, 1);
  assert.equal(logger.registros.error.length, 1);
  assert.equal(logger.registros.error[0].datos.signal, 'SIGINT');
});
