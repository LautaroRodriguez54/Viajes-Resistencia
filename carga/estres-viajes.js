import http from 'k6/http';
import { check, sleep } from 'k6';

const base = __ENV.BASE_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Sólo se admite un servidor local de pruebas.');
if (__ENV.ENTORNO_DESCARTABLE !== '1') throw new Error('Usá exclusivamente bases descartables y definí ENTORNO_DESCARTABLE=1.');
if (!__ENV.TOKEN_PASAJERO) throw new Error('Definí TOKEN_PASAJERO para una cuenta de prueba.');

// Valores deliberadamente moderados: adaptar al equipo y detener ante fallos persistentes.
export const options = {
  scenarios: {
    viajes: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 2 },
        { duration: '30s', target: 2 },
        { duration: '15s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '15s', target: 30 },
        { duration: '30s', target: 30 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    checks: [{ threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '20s' }],
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '20s' }],
  },
};

export default function () {
  const res = http.post(`${base}/viajes`, JSON.stringify({
    origen: { latitud: -27.4514, longitud: -58.9867 },
    destino: { latitud: -27.44, longitud: -58.98 },
  }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__ENV.TOKEN_PASAJERO}`, 'Idempotency-Key': crypto.randomUUID() },
    tags: { name: 'crear_viaje' },
  });
  check(res, { 'viaje creado': (r) => r.status === 201 });
  sleep(1);
}
