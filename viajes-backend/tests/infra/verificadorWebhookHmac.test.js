import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearVerificadorWebhookHmac } from '../../src/infra/externos/verificadorWebhookHmac.js';

test('acepta únicamente el HMAC del cuerpo exacto recibido', () => {
  const secreto = 'secreto-webhook-de-prueba-suficientemente-largo';
  const cuerpo = Buffer.from('{"eventoExternoId":"evt-1","importeCentavos":500}');
  const firma = crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex');
  const verificador = crearVerificadorWebhookHmac(secreto);
  assert.equal(verificador.verificarFirma(cuerpo, `sha256=${firma}`), true);
  assert.equal(verificador.verificarFirma(Buffer.from('{"importeCentavos":500}'), `sha256=${firma}`), false);
});

