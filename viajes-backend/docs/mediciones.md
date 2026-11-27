# Informe de mediciones

## Hipótesis previa y objetivo de asignación

- **Objetivo de asignación del grupo**: sostener la asignación completa de un viaje (`POST /viajes` → `POST /viajes/:id/ofertas` → `POST /ofertas/:id/aceptar`) con **p95 ≤ 500 ms** y **0% de errores**, manteniendo el lag **p99 del event loop < 50 ms** bajo la carga nominal de **500 choferes** reportando ubicación cada **2 s** (~250 req/s).
- **Hipótesis previa para 500 choferes**:
  1. Con 500 choferes cada 2 s (~250 pings/s), el event loop de Node no debería saturarse por CPU, pero la versión ingenua (transacción `BEGIN`/`COMMIT` + `SELECT ... FOR UPDATE` sobre `perfiles_chofer` + 2 `INSERT` síncronos por cada ping sobre un `pg.Pool` de 10 conexiones) elevará la latencia de cola (`p95`/`p99`) de `POST /viajes` y la asignación por contención en `perfiles_chofer` y saturación del pool.
  2. Al eliminar `FOR UPDATE` en pings de ubicación (1 CTE autocommit) y agrupar `historial_ubicaciones_chofer` en lotes asíncronos (`unnest` cada 1 s / 250 filas), la latencia de cola (`p95`) de solicitudes y asignación bajará sin aumentar el lag del event loop ni la memoria fuera de cota.
- **Carrera principal de concurrencia**: validada aparte en `tests/concurrencia/aceptacionOfertas.test.js` (50 aceptaciones simultáneas sobre un viaje → exactamente 1 gana; ofertas simultáneas con `SKIP LOCKED` + revalidación post-bloqueo) y `tests/concurrencia/cancelacionVsAceptacion.test.js`.

## Entorno y comandos

- **Máquina / SO**: Microsoft Windows 10 Pro `10.0.19045` · Intel Core i5-11400F @ 2.60 GHz (6 cores / 12 threads) · 15.9 GiB RAM.
- **Runtime y base**: Node.js `v22.23.5` · Docker `29.9.3` · PostgreSQL 16 + PostGIS (`postgis/postgis:16-3.4-alpine`, puerto `5433`).
- **Generador de carga**: `scripts/simularCargaUbicaciones.js` (Node 22 nativo, `http.Agent` con `keepAlive: true`, 500 choferes escalonados cada 2 s en 10 lotes de 50 cada 200 ms + 4 hilos de pasajeros ejecutando solicitar → ofrecer → aceptar → cancelar). Telemetría del servidor tomada desde `GET /admin/metricas` (`monitorEventLoopDelay({ resolution: 20 })` + `process.memoryUsage()`).
- **Comandos reproducibles (PowerShell 5.1, en `viajes-backend/`)**:

```powershell
# 1. Levantar servidor con nivel de log homogéneo entre escenarios (sin DATABASE_URL de test en el shell)
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:LOG_LEVEL='warn'; node src/servidor.js

# 2. En otra terminal: 3 corridas de 30 s para Base (sin pings de ubicación)
1..3 | ForEach-Object { npm run carga:ubicaciones -- --escenario=base --duracion-s=30 }

# 3. 3 corridas de 30 s para Ingenua (en commit 967c88b) o Final (en commit dee5609)
1..3 | ForEach-Object { npm run carga:ubicaciones -- --escenario=ubicaciones --duracion-s=30 }
```

## Resultados

Todas las corridas duraron `~30,1 s` y completaron con **0 errores** tanto en pings de ubicación (`7000/7000`, `~232 pings/s`) como en flujo de viajes.

| Escenario | p50 | p95 | p99 | req/s | asignación (p50 / p95) | lag máx. | lag p99 | memoria (RSS / heapUsed) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Base · corrida 1 (456 viajes) | 12,14 ms | 21,09 ms | 98,15 ms | 60,5 | 40,84 / 127,89 ms | 46,30 ms | 41,65 ms | 95,25 / 17,04 MiB |
| Base · corrida 2 (476 viajes) | 11,61 ms | 18,58 ms | 21,32 ms | 63,1 | 39,12 / 47,04 ms | 47,19 ms | 37,00 ms | 94,79 / 29,14 MiB |
| Base · corrida 3 (460 viajes) | 10,09 ms | 18,39 ms | 24,21 ms | 61,1 | 47,19 / 60,01 ms | 48,89 ms | 37,81 ms | 95,65 / 33,31 MiB |
| **Base (mediana)** | **11,61 ms** | **18,58 ms** | **24,21 ms** | **61,1** | **40,84 / 60,01 ms** | **47,19 ms** | **37,81 ms** | **95,25 / 29,14 MiB** |
| Ingenua · corrida 1 (401 viajes, 7000 pings) | 11,30 ms | 95,85 ms | 132,55 ms | 284,9 | 50,18 / 221,71 ms | 46,66 ms | 37,65 ms | 103,30 / 32,27 MiB |
| Ingenua · corrida 2 (448 viajes, 7000 pings) | 9,76 ms | 46,96 ms | 56,53 ms | 290,9 | 46,93 / 90,36 ms | 48,50 ms | 35,26 ms | 104,72 / 34,39 MiB |
| Ingenua · corrida 3 (421 viajes, 7000 pings) | 10,96 ms | 55,04 ms | 106,50 ms | 288,2 | 49,94 / 139,33 ms | 46,20 ms | 36,41 ms | 104,97 / 32,31 MiB |
| **Ingenua (mediana)** | **10,96 ms** | **55,04 ms** | **106,50 ms** | **288,2** | **49,94 / 139,33 ms** | **46,66 ms** | **36,41 ms** | **104,72 / 32,31 MiB** |
| Final · corrida 1 (418 viajes, 7000 pings) | 10,49 ms | 54,52 ms | 128,16 ms | 287,7 | 49,87 / 165,33 ms | 45,06 ms | 36,47 ms | 105,04 / 30,84 MiB |
| Final · corrida 2 (464 viajes, 7000 pings) | 10,72 ms | 30,05 ms | 40,11 ms | 294,9 | 38,96 / 70,48 ms | 49,77 ms | 35,49 ms | 107,17 / 24,25 MiB |
| Final · corrida 3 (435 viajes, 7000 pings) | 9,05 ms | 38,36 ms | 77,77 ms | 289,9 | 46,79 / 130,07 ms | 45,02 ms | 33,65 ms | 107,91 / 30,95 MiB |
| **Final (mediana)** | **10,49 ms** | **38,36 ms** | **77,77 ms** | **289,9** | **46,79 / 130,07 ms** | **45,06 ms** | **35,49 ms** | **107,17 / 30,84 MiB** |

## Conclusiones

1. **Dónde estaba el cuello real**: bajo 500 choferes cada 2 s, el event loop de Node se mantiene estable (`lag p99` ~35–38 ms con resolución de 20 ms en los tres escenarios). El impacto de la versión Ingenua aparece en la **latencia de cola en Postgres**: `POST /viajes` pasa de `p95 = 18,58 ms` (Base) a `55,04 ms` (×3) y `p99 = 106,50 ms` (×4,4), y la asignación completa sube de `p95 = 60,01 ms` a `139,33 ms` (pico `221,71 ms`), reduciendo la mediana de viajes completados en 30 s de `460` a `421`.
2. **Mejora de la versión Final (ADR 005)**: al quitar `BEGIN` + `SELECT ... FOR UPDATE` sobre `perfiles_chofer` (5 roundtrips → 1 CTE autocommit) y agrupar `historial_ubicaciones_chofer` en lotes de 250 filas / 1 s con `unnest`, la mediana de `POST /viajes` cae a `p95 = 38,36 ms` (−30% vs Ingenua) y `p99 = 77,77 ms` (−27%), la asignación mejora (`46,79 / 130,07 ms`, con corrida pico en `70,48 ms`) y los viajes completados suben de `421` a `435`, con sólo `+2,45 MiB` de RSS y `0` errores.
3. **Cumplimiento del objetivo**: la versión Final cumple el objetivo del grupo (`asignación p95 = 130,07 ms ≤ 500 ms`, `lag p99 = 35,49 ms < 50 ms`, `0` errores).
