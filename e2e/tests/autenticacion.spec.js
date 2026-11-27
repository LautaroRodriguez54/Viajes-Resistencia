import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = process.env.API_URL || 'http://localhost:3000';
if (process.env.E2E_ENTORNO_DESCARTABLE !== '1' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
  throw new Error('E2E requiere API local y E2E_ENTORNO_DESCARTABLE=1: crea usuarios de prueba.');
}
const password = 'ClaveSegura123!';

test('registro de pasajero y cierre de sesión desde la web', async ({ page }) => {
  const email = `registro-e2e-${randomUUID()}@demo.local`;
  await page.goto('/registro');
  await page.getByTestId('registro-email').fill(email);
  await page.getByTestId('registro-password').fill(password);
  await page.getByTestId('registro-enviar').click();
  await expect(page.getByTestId('usuario-actual')).toContainText(email);
  await expect(page.getByTestId('pedir-enviar')).toBeVisible();
  await page.getByTestId('salir').click();
  await expect(page.getByTestId('form-ingresar')).toBeVisible();
});

test('rechaza contraseña incorrecta y permite iniciar sesión con la correcta', async ({ page, request }) => {
  const email = `login-e2e-${randomUUID()}@demo.local`;
  const registro = await request.post(`${api}/auth/register`, { data: { email, password, rol: 'pasajero' } });
  expect(registro.status()).toBe(201);
  await page.goto('/ingresar');
  await page.getByTestId('ingresar-email').fill(email);
  await page.getByTestId('ingresar-password').fill('ContraseñaIncorrecta123!');
  await page.getByTestId('ingresar-enviar').click();
  await expect(page.getByTestId('ingresar-error')).toBeVisible();
  await expect(page.getByTestId('usuario-actual')).toHaveCount(0);
  await page.getByTestId('ingresar-password').fill(password);
  await page.getByTestId('ingresar-enviar').click();
  await expect(page.getByTestId('usuario-actual')).toContainText(email);
  await expect(page.getByTestId('pedir-enviar')).toBeVisible();
});
