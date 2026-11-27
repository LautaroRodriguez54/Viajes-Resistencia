# Pruebas E2E con Playwright

Los casos verifican en Chromium: registro y cierre de sesión; contraseña incorrecta seguida de ingreso correcto; cancelación confirmada del pasajero; rechazo y vencimiento reales de una oferta; y un viaje con pago pendiente, carga de saldo y cobro posterior. Crean usuarios y viajes reales: ejecutar únicamente en un entorno local descartable, sin otros choferes disponibles que puedan recibir las ofertas. La habilitación del conductor y la carga mediante webhook son preparación del escenario, no pruebas de una interfaz de administración ni de un proveedor externo.

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

La CI crea su propio contenedor PostGIS y servidores, aumenta a 100 el límite de login sólo para el servidor E2E y conserva el reporte HTML. Los tests específicos de rate limiting corren en el trabajo de backend con su propia configuración. El caso de vencimiento espera el TTL real del servidor (30 s por defecto).

El webhook de prueba usa el secreto de desarrollo de `viajes-backend/.env.example`. Si el servidor descartable usa otro secreto, definir `E2E_WEBHOOK_SECRET` en la terminal de Playwright sin versionarlo. Las trazas pueden contener datos de prueba; no utilizar credenciales reales.
