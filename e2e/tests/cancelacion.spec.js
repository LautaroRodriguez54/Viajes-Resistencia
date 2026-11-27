import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = process.env.API_URL || 'http://localhost:3000';
if (process.env.E2E_ENTORNO_DESCARTABLE !== '1' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
  throw new Error('E2E requiere API local y E2E_ENTORNO_DESCARTABLE=1: crea viajes de prueba.');
}

test('pasajero cancela un viaje y ve el estado actualizado', async ({ page, request }) => {
  const email = `cancelar-e2e-${randomUUID()}@demo.local`;
  const password = 'ClaveSegura123!';
  const registro = await request.post(`${api}/auth/register`, { data: { email, password, rol: 'pasajero' } });
  expect(registro.status()).toBe(201);
  await page.goto('/ingresar');
  await page.getByTestId('ingresar-email').fill(email);
  await page.getByTestId('ingresar-password').fill(password);
  await page.getByTestId('ingresar-enviar').click();
  await page.getByTestId('pedir-desde').selectOption('plaza');
  await page.getByTestId('pedir-hasta').selectOption('terminal');
  await page.getByTestId('pedir-enviar').click();
  await expect(page.getByTestId('mi-viaje-cancelar')).toBeVisible();
  await page.getByTestId('mi-viaje-cancelar').click();
  await expect(page.getByRole('group', { name: 'Confirmar cancelación' })).toBeVisible();
  await page.getByTestId('mi-viaje-cancelar-confirmar').click();
  await expect(page.getByTestId('mi-viaje')).toHaveAttribute('data-estado', 'cancelado_pasajero');
  await expect(page.getByTestId('mi-viaje-chip')).toHaveText('Cancelado');
});
