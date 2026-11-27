# ADR 005 - Procesaremos ubicaciones sin contención de bloqueo y con batching asíncrono de historial

- Estado: aceptado
- Fecha: 2026-11-26
- Participantes: Lucas Escobar, Agustín Valussi, Lautaro Rodríguez

## Contexto

El sistema debe sostener 500 choferes actualizando ubicación cada 2 segundos (~250 req/s) mientras los pasajeros solicitan y se asignan viajes concurrentemente. En la implementación inicial (`repositorioChoferesPostgres.registrarUbicacion`), cada ping abría una transacción explícita (`BEGIN` → `SELECT ... FOR UPDATE` sobre `perfiles_chofer` → upsert en `ubicaciones_actuales_chofer` → `INSERT` síncrono en `historial_ubicaciones_chofer` → `COMMIT`), generando 5 roundtrips al pool (`max: 10`) y compitiendo por el bloqueo de `perfiles_chofer` con `ofrecerAlChoferCercano` (`FOR UPDATE OF p SKIP LOCKED`).

## Opciones consideradas

1. **Worker threads**: aísla CPU; suma coordinación y serialización, pero la medición demostró que el cuello es contención/I/O en Postgres (`lag p99` estable ~36 ms) y no CPU en Node.
2. **Cola externa (Redis / RabbitMQ)**: desacopla recepción e historial entre procesos; agrega infraestructura nueva al `docker-compose.yml` y complejidad operativa innecesaria para el volumen actual.
3. **CTE autocommit sin `FOR UPDATE` + buffer acotado en memoria con batching `unnest`**: mantiene la actualización de `ubicaciones_actuales_chofer` síncrona en 1 solo roundtrip (sin bloquear `perfiles_chofer`) y agrupa los inserts de `historial_ubicaciones_chofer` por lotes cada 1 s / 250 filas, drenando al apagar (`apagadoOrdenado.js`).

## Decisión

Se adopta la **opción 3**:

1. `registrarUbicacion` ejecuta un único CTE autocommit (`pool.query`) que valida `habilitado` y `disponible` (o viaje activo) y actualiza `ubicaciones_actuales_chofer` sin `BEGIN` ni `FOR UPDATE` sobre `perfiles_chofer`.
2. El historial (`historial_ubicaciones_chofer`) se encola en `crearRecolectorHistorialUbicaciones` (`HISTORIAL_UBICACIONES_FLUSH_MS=1000`, `HISTORIAL_UBICACIONES_LOTE_MAX=250`, `HISTORIAL_UBICACIONES_BUFFER_MAX=10000`) y se inserta por lotes mediante `INSERT ... SELECT ... FROM unnest(...)`.
3. Ante errores de FK (`23503`, chofer eliminado antes del flush), el lote inválido se descarta sin bloquear el resto de la cola; ante fallos transitorios de conexión, se retiene en el buffer acotado para reintentar.
4. `composicion.cerrar()` (invocado por `apagadoOrdenado.js` ante `SIGTERM`/`SIGINT`) llama a `recolectorHistorial.detener()` para drenar los registros pendientes antes de cerrar los pools.

## Consecuencias

- En 3 corridas de 30 s con 500 choferes (~232 pings/s + viajes concurrentes, ver [mediciones.md](../mediciones.md)), la mediana de `POST /viajes` bajó de `p95 = 55,04 ms` / `p99 = 106,50 ms` (Ingenua) a `p95 = 38,36 ms` / `p99 = 77,77 ms` (Final), y la asignación quedó en `p95 = 130,07 ms` (objetivo ≤ 500 ms) con `lag p99 = 35,49 ms` y `+2,45 MiB` de RSS.
- **Tradeoff asumido**: si el proceso cae abruptamente por `SIGKILL` o corte de energía, se pierde como máximo la última ventana en buffer (≤ 1 s o ≤ 250 pings de historial; `ubicaciones_actuales_chofer` ya quedó persistida). Ante saturación prolongada de Postgres, el buffer descarta los registros más antiguos al superar `HISTORIAL_UBICACIONES_BUFFER_MAX` para proteger la memoria del proceso.

## Qué nos haría cambiar

- Escalar por encima de ~2.000 pings/s o desplegar múltiples réplicas que requieran durabilidad estricta del historial antes de responder `200`, caso en el que convendría mover la cola de historial a Redis Streams / RabbitMQ con workers dedicados y particionado por fecha en PostgreSQL.
