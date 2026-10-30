# ADR 005 - Procesaremos ubicaciones sin bloquear el event loop

- Estado: propuesto
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

El sistema debe sostener 500 choferes actualizando ubicación cada dos segundos mientras asigna viajes.

## Opciones consideradas

1. Worker threads: aísla CPU; suma coordinación y serialización.
2. Cola/procesamiento asíncrono: desacopla recepción y procesamiento; agrega consistencia eventual y operación adicional.
3. Optimizar consultas e índices geográficos: mantiene flujo simple; no resuelve CPU arbitrario por sí solo.

## Decisión

TODO: elegir tras acordar el mecanismo geográfico y medir la versión ingenua.

## Consecuencias

TODO.

## Qué nos haría cambiar

TODO.

