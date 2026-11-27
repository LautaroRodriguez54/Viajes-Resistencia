import { test, expect } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

const api = process.env.API_URL || 'http://localhost:3000';
const password = 'ClaveSegura123!';
if (process.env.E2E_ENTORNO_DESCARTABLE !== '1' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
  throw new Error('E2E requiere API local y E2E_ENTORNO_DESCARTABLE=1: crea usuarios y viajes.');
}

test('viaje con pago pendiente se paga luego de cargar saldo', async ({ browser, request }) => {
  const id = randomUUID().slice(0, 8);
  const pasajero = `pasajero-e2e-${id}@demo.local`;
  const chofer = `chofer-e2e-${id}@demo.local`;
  const registrar = async (data) => {
    const res = await request.post(`${api}/auth/register`, { data });
    expect(res.status()).toBe(201);
    return res.json();
  };
  const sesionPasajero = await registrar({ email: pasajero, password, rol: 'pasajero' });
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
    await p.getByTestId('pedir-desde').selectOption('plaza');
    await p.getByTestId('pedir-hasta').selectOption('terminal');
    const respuestaViaje = p.waitForResponse((res) => res.url() === `${api}/viajes` && res.request().method() === 'POST');
    await p.getByTestId('pedir-enviar').click();
    const creado = await respuestaViaje;
    expect(creado.status()).toBe(201);
    const viajeId = (await creado.json()).viaje.id;
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

    // Simula el proveedor: webhook real firmado con el secreto de desarrollo de la CI.
    const secreto = process.env.E2E_WEBHOOK_SECRET || 'cambiar-por-un-secreto-de-webhook-de-al-menos-32-caracteres';
    const cuerpo = JSON.stringify({ eventoExternoId: `e2e-${randomUUID()}`, pasajeroId: sesionPasajero.usuario.id, importeCentavos: 5000000 });
    const firma = `sha256=${createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
    const carga = await request.post(`${api}/billetera/webhooks/cargas`, { data: cuerpo, headers: { 'content-type': 'application/json', 'x-webhook-signature': firma } });
    expect(carga.status()).toBe(201);
    await p.getByTestId('mi-viaje-ir-billetera').click();
    await expect(p.getByTestId('billetera-pagar')).toBeVisible({ timeout: 20000 });
    await p.getByTestId('billetera-pagar').click();
    await expect(p.getByTestId('billetera-resultado')).toContainText('se cobraron');
    await expect.poll(async () => {
      const res = await request.get(`${api}/viajes/${viajeId}`, { headers: { Authorization: `Bearer ${sesionPasajero.accessToken}` } });
      return res.ok() ? (await res.json()).viaje.estado : null;
    }).toBe('finalizado');
    const movimientos = await request.get(`${api}/billetera/me/movimientos`, { headers: { Authorization: `Bearer ${sesionPasajero.accessToken}` } });
    expect(movimientos.ok()).toBeTruthy();
    expect((await movimientos.json()).movimientos.filter((m) => m.tipo === 'consumo' && m.viajeId === viajeId)).toHaveLength(1);
  } finally {
    await contextoPasajero.close();
    await contextoChofer.close();
  }
});
