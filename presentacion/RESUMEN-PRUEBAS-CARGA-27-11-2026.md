# Resumen de pruebas de carga k6 — 27/11/2026

## Entorno y método

Pruebas locales del endpoint de creación de viajes, con k6 2.4.0, backend Node 22.23.5 y PostgreSQL/PostGIS en Docker. El backend, la base, k6 y otras aplicaciones compartieron el equipo. Cada usuario virtual esperó un segundo entre iteraciones; se usó una cuenta de prueba. Los datos de viajes se acumularon entre corridas.

Cada bloque principal duró 30 segundos. Los ensayos de 10 y 30 usuarios se realizaron sin calentamiento separado; los de 50, 75 y 100 incluyeron **10 segundos previos de calentamiento con el mismo número de usuarios**, en una ejecución k6 independiente, conservando activos el backend y la base. Por esa diferencia, las comparaciones entre ambos grupos son orientativas. Los pedidos de calentamiento también crearon viajes y se presentan más abajo.

## Resultados de los bloques principales

| Usuarios virtuales | Pedidos correctos | Errores HTTP | Pedidos/s | Media | P95 | P99 | Máximo |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10, sin calentamiento separado | 300/300 | 0 % | 9,80 | 20,24 ms | 24,57 ms | 90,96 ms | 92,28 ms |
| 30, sin calentamiento separado | 900/900 | 0 % | 29,36 | 17,48 ms | 49,64 ms | 63,70 ms | 65,77 ms |
| 50, con calentamiento | 1500/1500 | 0 % | 48,79 | 19,46 ms | 68,49 ms | 101,87 ms | 105,48 ms |
| 75, con calentamiento | 2250/2250 | 0 % | 72,83 | 22,44 ms | 92,89 ms | 127,44 ms | 133,00 ms |
| 100, con calentamiento | 2989/2989 | 0 % | 96,49 | 25,81 ms | 106,60 ms | 173,54 ms | 179,80 ms |

Los pedidos correctos son comprobaciones de respuesta esperada del escenario. El p95 indica que aproximadamente el 95 % de las respuestas medidas se encontró en ese tiempo o por debajo; el p99 aplica la misma idea al 99 %. Los 100 usuarios completaron 2.989 iteraciones, no 3.000: el número depende del tiempo de respuesta, la pausa y el tiempo disponible.

## Calentamiento: resultados que también cuentan

| Usuarios | Pedidos correctos | Errores HTTP | Media | P95 | P99 | Máximo |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 500/500 | 0 % | 49,74 ms | 226,55 ms | 232,81 ms | 234,86 ms |
| 75 | 750/750 | 0 % | 58,91 ms | 298,61 ms | 315,96 ms | 318,31 ms |
| 100 | 1000/1000 | 0 % | 73,91 ms | 337,05 ms | 354,12 ms | 355,84 ms |

Estos picos iniciales no deben excluirse de la explicación del resultado completo. Son compatibles con efectos de arranque, pero la prueba no identifica su causa.

## Recursos observados en 100 usuarios

Durante 15 muestras que cubren calentamiento y medición, la CPU máxima del equipo fue 56 % y la memoria 68,94 %. Node alcanzó 3,02 % de CPU normalizada a los 12 procesadores lógicos y 98,8 MiB de memoria residente. El contenedor PostgreSQL alcanzó 129,16 % de CPU en escala Docker (100 % equivale a un procesador lógico), 104,2 MiB de memoria y 11 conexiones observadas. No se observaron locks pendientes, esperas por locks ni deadlocks; el contador acumulado de rollbacks se mantuvo en 1. Las muestras periódicas no descartan picos o esperas breves, ni miden la cola del pool. Las escalas de CPU de Node y Docker son distintas.

## Interpretación y evidencia

En los ensayos con calentamiento, al pasar de 50 a 100 usuarios subieron tanto el número de pedidos por segundo como los percentiles, sin errores HTTP. No se identificó saturación sostenida ni capacidad máxima: son ejecuciones individuales, cortas, con un único tipo de operación y una pausa entre pedidos; no equivalen a usuarios reales concurrentes en producción. La evolución no demuestra por sí sola la causa de las demoras.

- [10 usuarios en Grafana](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9099981) y [30 usuarios](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9099984).
- [50 usuarios: medición](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100065) y [calentamiento](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100063).
- [75 usuarios: medición](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100083) y [calentamiento](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100082).
- [100 usuarios: medición](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100098) y [calentamiento](https://dreamychestnut3193.grafana.net/a/k6-app/runs/9100097).
- Los resúmenes JSON, salidas de k6 y muestras de hardware y base están en `resultados-presentacion/20261127-calentamiento-100/` y las carpetas de las pruebas anteriores. Los datos de hardware y base son archivos locales; las ejecuciones de k6 se enviaron a Grafana Cloud.
