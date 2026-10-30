# Informe de mediciones

## Hipótesis previa

TODO: antes de medir, declarar una hipótesis numérica para la carga de 500 choferes y otra para la carrera principal.

## Escenarios requeridos

1. Línea de base sin tarea pesada.
2. Versión ingenua: recepción/búsqueda que bloquea o degrada el event loop.
3. Versión final: estrategia elegida en el ADR 005.

Para cada escenario se harán al menos tres corridas y se registrarán p50, p95, p99, solicitudes por segundo, tiempo de asignación, lag máximo y p99 del event loop, y memoria.

## Entorno y comandos

TODO: completar máquina, SO, Node, PostgreSQL, Docker, versión del generador de carga y comandos exactos reproducibles.

## Resultados

| Escenario | p50 | p95 | p99 | req/s | asignación | lag máx. | lag p99 | memoria |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TODO | | | | | | | | |

