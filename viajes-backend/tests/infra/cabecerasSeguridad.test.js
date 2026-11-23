import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { crearCabecerasSeguridad } from '../../src/infra/http/cabecerasSeguridad.js';

test('las cabeceras de seguridad aplican una CSP estricta de API y ocultan x-powered-by', async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(crearCabecerasSeguridad());
  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });

  try {
    const { port } = servidor.address();
    const respuesta = await fetch(`http://127.0.0.1:${port}/health`);
    const csp = respuesta.headers.get('content-security-policy') ?? '';

    assert.equal(respuesta.status, 200);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.equal(respuesta.headers.get('x-powered-by'), null);
    assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await new Promise((resolver, rechazar) => {
      servidor.close((error) => (error ? rechazar(error) : resolver()));
    });
  }
});
