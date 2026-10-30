# ADR 007 - Usamos PostGIS para ubicaciones y búsqueda de choferes cercanos

- Estado: aceptado
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

Los choferes envían ubicaciones periódicamente y el sistema debe buscar candidatos cercanos sin cargar todos los choferes en JavaScript. La carga obligatoria incluye 500 choferes cada dos segundos.

## Opciones consideradas

1. PostGIS con `geography(Point, 4326)` e índice GiST: las consultas espaciales se resuelven en PostgreSQL y se pueden medir; exige una imagen de base con la extensión y aprender funciones espaciales.
2. Geohash guardado como texto: es simple de transportar; requiere decidir precisión, vecinos y filtrado final por distancia.
3. Estructura en memoria: puede ser rápida para una instancia; complica reinicios, varias instancias y persistencia histórica.

## Decisión

Usaremos PostGIS. Las posiciones actuales viven en una tabla indexada para búsqueda y el historial se guarda por separado para aplicar una política de retención posterior.

## Consecuencias

Docker Compose usa la imagen `postgis/postgis`. La aplicación seguirá recibiendo ubicaciones por HTTP; PostGIS no reemplaza SSE ni necesita GeoServer/MapServer para este caso.

## Qué nos haría cambiar

Una restricción operativa que impida usar extensiones PostgreSQL, o una medición que demuestre que el volumen del TP no justifica su costo de operación.
