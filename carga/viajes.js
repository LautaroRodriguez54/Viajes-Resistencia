import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomUUID } from 'k6/crypto';

const base = __ENV.BASE_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Sólo se admite un servidor local de pruebas.');
if (!__ENV.TOKEN_PASAJERO) throw new Error('Definí TOKEN_PASAJERO para una cuenta de prueba.');

export const options = {
  scenarios: { viajes: { executor: 'constant-vus', vus: Number(__ENV.VUS || 2), duration: __ENV.DURATION || '30s' } },
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.01'] },
};

export default function () {
  const res = http.post(`${base}/viajes`, JSON.stringify({ origen: { latitud: -27.4514, longitud: -58.9867 }, destino: { latitud: -27.44, longitud: -58.98 } }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__ENV.TOKEN_PASAJERO}`, 'Idempotency-Key': randomUUID() },
    tags: { name: 'crear_viaje' },
  });
  check(res, { 'viaje creado': (r) => r.status === 201 });
  sleep(Number(__ENV.PAUSA || 1));
}
