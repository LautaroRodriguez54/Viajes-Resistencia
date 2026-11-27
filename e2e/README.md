# Pruebas E2E con Playwright

El primer caso verifica ingreso de pasajero y chofer, solicitud, oferta, aceptación, viaje y pago pendiente desde Chromium. Crea usuarios y viajes reales en la base utilizada por la API: ejecutar únicamente en un entorno local descartable. El conductor se habilita mediante el administrador de desarrollo; esto es preparación del escenario, no una prueba de la pantalla de administración.

Con Node 22, PostgreSQL aislado, backend en `http://localhost:3000` y web en `http://localhost:5173`, inicializados con el seed de desarrollo:

```powershell
cd e2e
npm ci
npx playwright install chromium
$env:E2E_ENTORNO_DESCARTABLE='1'
npm test
```

`API_URL` y `WEB_URL` permiten cambiar direcciones. En desarrollo, la política CSP admite el origen local indicado por `VITE_API_URL`; la política de producción no cambia. El test sólo acepta API local. No reutilizar datos de producción ni una base con choferes disponibles ajenos a la prueba: podrían recibir la oferta.

Ejemplo de aislamiento: iniciar el backend en el puerto 3101 con `DATABASE_URL`, `BILLETERA_DATABASE_URL` y `LECTURA_DATABASE_URL` dirigidas a bases descartables diferentes de las habituales, y `CORS_ORIGINS=http://localhost:5174`; iniciar Vite con `VITE_API_URL=http://localhost:3101` y `npm run dev -- --port 5174 --strictPort`. En la terminal de pruebas definir `API_URL=http://localhost:3101`, `WEB_URL=http://localhost:5174` y `E2E_ENTORNO_DESCARTABLE=1`. Preparar las bases con `npm run setup` usando esas mismas URLs aisladas.

La CI crea su propio contenedor PostGIS y servidores, y conserva el reporte HTML. Pendientes: pago después de cargar saldo, rechazo, vencimiento y cobertura de recuperación ante errores. Las trazas pueden contener datos de prueba; no utilizar credenciales reales.
