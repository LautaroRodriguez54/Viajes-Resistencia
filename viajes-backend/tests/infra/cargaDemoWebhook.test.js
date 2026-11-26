import test from 'node:test';
import assert from 'node:assert/strict';
import { armarCargaFirmada, interpretarArgumentos } from '../../src/infra/externos/cargaDemoWebhook.js';
import { crearVerificadorWebhookHmac } from '../../src/infra/externos/verificadorWebhookHmac.js';

const secreto = 'secreto-webhook-de-prueba-suficientemente-largo';
const pasajeroId = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';
const URL_LOCAL = 'http://localhost:3000';

test('la carga de demo lleva una firma que acepta el verificador del webhook', () => {
  const { cuerpo, firma } = armarCargaFirmada({ pasajeroId, importeCentavos: 150000, secreto });
  const verificador = crearVerificadorWebhookHmac(secreto);
  assert.equal(verificador.verificarFirma(Buffer.from(cuerpo), firma), true);
  assert.equal(crearVerificadorWebhookHmac('otro-secreto-distinto-de-al-menos-32-caracteres').verificarFirma(Buffer.from(cuerpo), firma), false);
});

test('el cuerpo de la carga de demo tiene exactamente los campos que valida la ruta', () => {
  const { cuerpo, eventoExternoId } = armarCargaFirmada({ pasajeroId, importeCentavos: 500, secreto });
  assert.deepEqual(JSON.parse(cuerpo), { eventoExternoId, pasajeroId, importeCentavos: 500 });
});

test('cada carga de demo genera un eventoExternoId distinto, así dos cargas acreditan dos veces', () => {
  const ids = new Set(Array.from({ length: 100 }, () => armarCargaFirmada({ pasajeroId, importeCentavos: 1, secreto }).eventoExternoId));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^demo-[0-9a-f-]{36}$/);
});

test('cargar-saldo acepta email o uuid y el importe en centavos enteros', () => {
  assert.deepEqual(interpretarArgumentos(['pasajero@demo.local', '150000'], URL_LOCAL), {
    email: 'pasajero@demo.local', pasajeroId: null, importeCentavos: 150000, url: URL_LOCAL,
  });
  assert.deepEqual(interpretarArgumentos([pasajeroId, '1', '--url', 'https://api.ejemplo.com/'], URL_LOCAL), {
    email: null, pasajeroId, importeCentavos: 1, url: 'https://api.ejemplo.com',
  });
});

test('cargar-saldo rechaza argumentos inválidos antes de llamar al servidor', () => {
  for (const argumentos of [
    [],
    ['pasajero@demo.local'],
    ['no-es-email-ni-uuid', '100'],
    ['pasajero@demo.local', '10.5'],
    ['pasajero@demo.local', '0'],
    ['pasajero@demo.local', '-100'],
    ['pasajero@demo.local', '2000000001'],
    ['pasajero@demo.local', '100', 'sobra'],
    ['pasajero@demo.local', '100', '--url', 'localhost:3000'],
  ]) {
    assert.throws(() => interpretarArgumentos(argumentos, URL_LOCAL), Error, `debería rechazar ${JSON.stringify(argumentos)}`);
  }
});
