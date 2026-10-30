# ADR 002 - Usamos PostgreSQL con SQL parametrizado mediante pg

- Estado: aceptado
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

Necesitamos transacciones y bloqueos explícitos, y debemos poder explicar el SQL ejecutado.

## Opciones consideradas

1. SQL directo con `pg`: control explícito de transacciones y bloqueos; más SQL manual.
2. ORM: acelera CRUD y migraciones; puede ocultar consultas y semántica de bloqueo.

## Decisión

Usaremos PostgreSQL y consultas SQL parametrizadas a través de `pg`.

## Consecuencias

Las migraciones y repositorios deberán mantener SQL legible y testeable.

## Qué nos haría cambiar

Un requerimiento que demande productividad de modelado que SQL directo no pueda sostener sin comprometer las pruebas.

