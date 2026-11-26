import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = process.env.API_URL || 'http://localhost:3000';
const password = 'ClaveSegura123!';
if (process.env.E2E_ENTORNO_DESCARTABLE !== '1' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
  throw new Error('E2E requiere API local y E2E_ENTORNO_DESCARTABLE=1: crea usuarios y viajes.');
}

test('pasajero y chofer completan viaje con pago pendiente', async ({ browser, request }) => {
  const id = randomUUID().slice(0, 8);
  const pasajero = `pasajero-e2e-${id}@demo.local`;
  const chofer = `chofer-e2e-${id}@demo.local`;
  const registrar = async (data) => {
    const res = await request.post(`${api}/auth/register`, { data });
    expect(res.status()).toBe(201);
    return res.json();
  };
  await registrar({ email: pasajero, password, rol: 'pasajero' });
  const conductor = await registrar({ email: chofer, password, rol: 'chofer', vehiculo: { patente: `E${id.slice(0, 6)}`.toUpperCase(), marca: 'Test', modelo: 'E2E' } });
  const loginAdmin = await request.post(`${api}/auth/login`, { data: { email: 'admin@demo.local', password: 'AdminDemo123!' } });
  expect(loginAdmin.ok()).toBeTruthy();
  const admin = await loginAdmin.json();
  const habilitar = await request.patch(`${api}/admin/choferes/${conductor.usuario.id}/habilitacion`, { headers: { Authorization: `Bearer ${admin.accessToken}` }, data: { habilitado: true } });
  expect(habilitar.ok()).toBeTruthy();
  const contextoPasajero = await browser.newContext();
  const contextoChofer = await browser.newContext();
  try {
    const p = await contextoPasajero.newPage();
    const c = await contextoChofer.newPage();
    for (const [page, email] of [[p, pasajero], [c, chofer]]) {
      await page.goto('/ingresar');
      await page.getByTestId('ingresar-email').fill(email);
      await page.getByTestId('ingresar-password').fill(password);
      await page.getByTestId('ingresar-enviar').click();
    }
    await expect(c.getByTestId('chofer-disponible')).toBeVisible();
    await c.getByTestId('chofer-disponible').click();
    await expect(c.getByTestId('chofer-disponible')).toHaveAttribute('aria-checked', 'true');
    await expect(p.getByTestId('pedir-enviar')).toBeVisible();
    await p.getByTestId('pedir-enviar').click();
    await expect(c.getByTestId('oferta-aceptar')).toBeVisible({ timeout: 20000 });
    await c.getByTestId('oferta-aceptar').click();
    await expect(c.getByTestId('chofer-viaje')).toHaveAttribute('data-estado', 'asignado');
    await c.getByTestId('chofer-avanzar').click();
    await expect(c.getByTestId('chofer-viaje')).toHaveAttribute('data-estado', 'chofer_en_camino');
    await c.getByTestId('chofer-avanzar').click();
    await expect(c.getByTestId('chofer-viaje')).toHaveAttribute('data-estado', 'en_curso');
    await c.getByTestId('chofer-avanzar').click();
    await expect(c.getByTestId('chofer-cobro')).toHaveAttribute('data-estado', 'pago_pendiente');
    await expect(p.getByTestId('mi-viaje-pago-pendiente')).toBeVisible({ timeout: 15000 });
  } finally {
    await contextoPasajero.close();
    await contextoChofer.close();
  }
});
