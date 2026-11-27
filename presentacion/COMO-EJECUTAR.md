# Cómo repetir las pruebas para la presentación

Abrir Docker Desktop y comprobar que estén instalados Node 22, k6, las dependencias del backend, la web y E2E, y Chromium de Playwright. Esta guía usa PowerShell desde la raíz del repositorio.

## Una sola orden

```powershell
cd C:\Users\lauta\Desktop\app-taxi-rcia
.\presentacion\ejecutar-pruebas.ps1 -GrafanaCloud
```

Si PowerShell bloquea la ejecución del archivo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\presentacion\ejecutar-pruebas.ps1 -GrafanaCloud
```

El script necesita Node 22 y los puertos 5544, 3101 y 5174 libres. Si no detecta Node o k6, se pueden indicar sus rutas con `-Node` y `-K6`. Crea un contenedor PostgreSQL de prueba propio, prepara bases y seed, ejecuta los tests del backend, levanta API y web locales, ejecuta Playwright y corre k6 con 2 VUs durante 30 s. Guarda archivos por fecha en `resultados-presentacion`; al terminar detiene los procesos que inició y el contenedor. El contenedor detenido y su almacenamiento quedan en Docker; no borra datos existentes. Las pruebas generan datos descartables.

`-GrafanaCloud` envía los resultados de k6 a la cuenta ya autenticada mediante `k6 cloud login`. Ejecuta la carga en la PC y no sube el archivo del script. Para correr sin Grafana Cloud, omitir `-GrafanaCloud`. Si la autenticación falla, revisar `k6.txt`; no compartir tokens ni credenciales.

El script conserva `backend-tap.txt`, `playwright.txt`, `reporte-playwright/index.html`, `k6.txt`, `k6-resumen.json`, logs de servicios y `estado.json`. El informe HTML se puede abrir con:

```powershell
Start-Process '.\resultados-presentacion\FECHA-DE-LA-CORRIDA\reporte-playwright\index.html'
```

Reemplazar `FECHA-DE-LA-CORRIDA` por la carpeta que muestre el script. En `k6.txt` aparece el enlace de Grafana bajo `output: cloud`. Los registros del backend se envían a Grafana solo si el colector Alloy está levantado y configurado según `observabilidad/README.md`; su dashboard incluye todos los pedidos de las distintas fases.

El resumen de k6 incluye p95, p99 y máximo. Para mostrar también p95, p99 y máximo de los registros del backend en Grafana, importar `observabilidad/dashboard-percentiles.json` y elegir la fuente Loki. Esos paneles consideran todos los pedidos del intervalo seleccionado; no representan necesariamente las mismas solicitudes ni el mismo tramo de tiempo medido por k6.

## Preparación inicial de dependencias

Con Node 22 activo, desde la raíz:

```powershell
cd viajes-backend
npm ci
cd ..\viajes-web
npm ci
cd ..\e2e
npm ci
npx playwright install chromium
cd ..
```

Estas instalaciones necesitan acceso a Internet si faltan paquetes o el navegador. La sesión de Docker debe estar iniciada y la imagen `postgis/postgis:16-3.4-alpine` disponible o descargarse la primera vez.

## Consultar pruebas por separado

El script es la opción recomendada porque prepara el aislamiento. Dentro de un entorno ya preparado, las órdenes básicas son:

```powershell
# Backend: DATABASE_URL debe apuntar a viajes_test en un servidor de pruebas.
cd viajes-backend
npm test

# E2E: requiere API, web y bases descartables; consultar e2e/README.md.
cd ..\e2e
$env:E2E_ENTORNO_DESCARTABLE = '1'
npm test
npx playwright show-report

# k6: requiere un pasajero de prueba y la API en localhost.
cd ..
k6 run -e VUS=2 -e DURATION=30s carga/viajes.js
```

No ejecutar el último comando sin configurar `TOKEN_PASAJERO` y comprobar que la API use bases descartables; cada iteración crea un viaje. El token vence y no debe compartirse. Si API y web usan puertos distintos de los predeterminados, definir `API_URL` y `WEB_URL` para Playwright y `BASE_URL` para k6, como se explica en sus respectivos README.

La prueba gradual de hasta 30 VUs está en `carga/estres-viajes.js` y requiere la confirmación de entorno descartable. Para aumentar carga más allá de ella, acordar niveles y observar errores y recursos; no confundir el parámetro `30s` de duración con 30 usuarios.
