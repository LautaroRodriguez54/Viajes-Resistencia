# ADR 009 - CQRS: proyección de saldos en una base de lectura

- Estado: aceptado
- Fecha: 2026-11-26
- Participantes: Agustín Valussi (implementación); revisor del PR: Lucas Escobar

## Contexto

Pregunta guía (tema 13 de Fernández): **¿cuándo ayuda usar modelos distintos para comandos y consultas?**

Con la billetera en su propia base (ADR 008) ya no hay `JOIN` posible con `viajes`. Las pantallas que mezclan datos de los dos módulos, como el historial del pasajero o el panel del operador, necesitan otro lugar de donde leer.

Además, el saldo es derivado: no está guardado, se calcula sumando todos los movimientos. Calcularlo en cada `GET /billetera/me` tiene un costo que crece con el historial.

## Decisión

Nivel 2, como en la exposición: bases separadas sincronizadas por eventos.

- **Escritura**: la base `billetera`. Cada movimiento deja `MovimientoRegistrado` en `outbox_billetera` en la misma transacción, y cada billetera nueva deja `BilleteraCreada`.
- **Lectura**: la base `lectura`, con la tabla `saldos` (`pasajero_id`, `saldo_centavos`).
- **Proyector**: `src/infra/db/proyectorSaldosPostgres.js`. Un despachador dentro del backend (el mismo de ADR 008) le entrega los eventos del outbox. `GET /billetera/me` lee de `saldos`.

### Regla para la defensa

**La proyección es sólo para mostrar. El cobro decide siempre sobre el modelo de escritura**: suma los movimientos con la billetera bloqueada (`FOR UPDATE`). En la pantalla aceptamos consistencia eventual; en el dinero, no.

### Las tres limitaciones de la diapositiva y cómo se resuelven

| Limitación | Solución | Dónde |
|---|---|---|
| Eventos duplicados | `eventos_aplicados` (id de evento único): un evento repetido no suma dos veces | `proyectorSaldosPostgres.aplicar`; test "un evento entregado dos veces…" |
| Eventos fuera de orden | La proyección sólo suma y resta importes, y una suma da lo mismo en cualquier orden. Por eso no hace falta una versión por billetera. Si una proyección futura necesitara orden (por ejemplo, "último estado del viaje"), ahí sí habría que agregar una secuencia por agregado | test "con cargas y cobros simultáneos y dos despachadores…" |
| Desincronización | `npm run proyecciones:reconstruir` borra `saldos` y reproduce todo el outbox, que no se borra nunca | `scripts/reconstruirProyecciones.js`; test "la proyección se reconstruye…" |

El despachador no usa "último id leído": toma cada evento pendiente con `FOR UPDATE SKIP LOCKED` y lo marca como procesado. Así no pierde eventos que se confirman fuera de orden, y dos instancias del backend no se pisan entre sí.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Tabla `saldos` en la base `billetera`, actualizada en la misma transacción que el movimiento (nivel 1) | Siempre coincide y es menos código, pero no es lo que se expuso y no resuelve la lectura que cruza módulos (el historial) |
| RabbitMQ entre el outbox y el proyector | Suma un servicio al compose. El outbox ya garantiza que no se pierdan eventos. El TP integrador lo admite "o alternativa aprobada" (a confirmar con Fernández) |
| MongoDB para la lectura | Lo usó la demo de la exposición, pero sería otra tecnología que defender sin ninguna ventaja para una tabla de saldos |
| Publicar el evento después del COMMIT, sin outbox | Una caída entre el COMMIT y la publicación pierde el evento (doble escritura) |

## Costos

- **Consistencia eventual.** Después de una carga, la pantalla tarda hasta `OUTBOX_INTERVALO_MS` en mostrar el saldo nuevo. Medido: unos 100 ms. Un cliente que necesite el valor exacto, como un E2E, tiene que reintentar la lectura hasta verlo.
- **El outbox crece para siempre**, porque se usa para reconstruir. Más adelante: compactarlo con una foto periódica de los saldos.
- **Un proceso más que operar.** Si el despachador se detiene, la pantalla se atrasa, pero el dinero no se ve afectado.

## Próximo paso

`historial_viajes` (viaje + nombres + tarifa + estado de cobro) sale de la misma base de lectura, con eventos de `outbox_viajes` y de `outbox_billetera`. Es lo que alimenta el historial del pasajero, el del chofer y el panel del operador.
