# ADR 004 - Resolveremos asignación y cobro dentro de transacciones PostgreSQL

- Estado: propuesto
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

Hay dos carreras obligatorias: aceptación concurrente de un viaje y dos cobros contra el saldo limitado de un pasajero.

## Opciones consideradas

1. Bloqueo pesimista con `SELECT ... FOR UPDATE` y orden global de bloqueo: protege recursos relacionados; puede esperar y requiere prevenir interbloqueos.
2. Concurrencia optimista con versión: reduce bloqueos; obliga a reintentar conflictos y complica operaciones que afectan varios recursos.

## Decisión

TODO: definir filas, orden de bloqueo, aislamiento y política de reintento después de diseñar las tablas.

## Consecuencias

TODO.

## Qué nos haría cambiar

TODO.

