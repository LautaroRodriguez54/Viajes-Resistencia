import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = process.env.API_URL || 'http://localhost:3000';
const password = 'ClaveSegura123!';
if (process.env.E2E_ENTORNO_DESCARTABLE !== '1' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
  throw new Error('E2E requiere API local y E2E_ENTORNO_DESCARTABLE=1: crea usuarios y viajes.');
}

async function prepararOferta({ browser, request }) {
  const id = randomUUID().slice(0, 8);
  async function registrar(datos) {
    const res = await request.post(`${api}/auth/register`, { data: datos });
    expect(res.status()).toBe(201);
    return res.json();
  }
  const pasajero = await registrar({ email: `pasajero-oferta-${id}@demo.local`, password, rol: 'pasajero' });
  const chofer = await registrar({ email: `chofer-oferta-${id}@demo.local`, password, rol: 'chofer', vehiculo: { patente: `O${id.slice(0, 6)}`.toUpperCase(), marca: 'Test', modelo: 'E2E' } });
  const adminRes = await request.post(`${api}/auth/login`, { data: { email: 'admin@demo.local', password: 'AdminDemo123!' } });
  expect(adminRes.ok()).toBeTruthy();
  const admin = await adminRes.json();
  const habilitar = await request.patch(`${api}/admin/choferes/${chofer.usuario.id}/habilitacion`, { headers: { Authorization: `Bearer ${admin.accessToken}` }, data: { habilitado: true } });
  expect(habilitar.ok()).toBeTruthy();

  const contextoP = await browser.newContext();
  const contextoC = await browser.newContext();
  await contextoP.addInitScript((sesion) => sessionStorage.setItem('viajes.sesion', JSON.stringify(sesion)), pasajero);
  await contextoC.addInitScript((sesion) => sessionStorage.setItem('viajes.sesion', JSON.stringify(sesion)), chofer);
  const p = await contextoP.newPage();
  const c = await contextoC.newPage();
  await c.goto('/chofer');
  const ubicacion = c.waitForResponse((res) => res.url().endsWith('/choferes/me/ubicacion') && res.request().method() === 'PUT' && res.ok());
  await c.getByTestId('chofer-disponible').click();
  await ubicacion;
  await p.goto('/pasajero/pedir');
  await p.getByTestId('pedir-desde').selectOption('plaza');
  await p.getByTestId('pedir-hasta').selectOption('terminal');
  const respuestaViaje = p.waitForResponse((res) => res.url() === `${api}/viajes` && res.request().method() === 'POST');
  await p.getByTestId('pedir-enviar').click();
  const creado = await respuestaViaje;
  expect(creado.status()).toBe(201);
  const viajeId = (await creado.json()).viaje.id;
  await expect(c.getByTestId('oferta')).toBeVisible({ timeout: 20000 });
  return { p, c, pasajero, chofer, viajeId, contextoP, contextoC };
}

async function verificarSinChoferes(request, escenario) {
  await expect(escenario.p.getByTestId('mi-viaje-sin-choferes-final')).toBeVisible({ timeout: 50000 });
  const res = await request.get(`${api}/viajes/${escenario.viajeId}`, { headers: { Authorization: `Bearer ${escenario.pasajero.accessToken}` } });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).viaje.estado).toBe('sin_choferes_disponibles');
}

for (const caso of ['rechazo', 'vencimiento']) {
  test(`oferta: ${caso} termina sin chofer disponible`, async ({ browser, request }) => {
    const escenario = await prepararOferta({ browser, request });
    try {
      if (caso === 'rechazo') await escenario.c.getByTestId('oferta-rechazar').click();
      // Para vencimiento se espera la decisión real del servidor (TTL de desarrollo: 30 s).
      await expect(escenario.c.getByTestId('oferta')).toBeHidden({ timeout: 50000 });
      await verificarSinChoferes(request, escenario);
    } finally {
      await request.put(`${api}/choferes/me/disponibilidad`, { headers: { Authorization: `Bearer ${escenario.chofer.accessToken}` }, data: { disponible: false } });
      await escenario.contextoP.close();
      await escenario.contextoC.close();
    }
  });
}
