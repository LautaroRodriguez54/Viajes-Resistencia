# ADR 009 - CQRS: proyecciones de saldos e historial en una base de lectura

- Estado: aceptado
- Fecha: 2026-11-26 (historial y movimientos: 2026-11-26, rama 10)
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

## Historial de viajes (rama 10)

`GET /viajes` devuelve el historial del pasajero desde la tabla `historial_viajes` de la base `lectura`: una fila por viaje con su último estado conocido.

### Cómo llegan los eventos: un trigger en `viajes`

La migración `006` de `viajes` crea dos triggers sobre la tabla `viajes`:

1. `BEFORE UPDATE`: si un `UPDATE` no subió `version`, la sube. Así la versión crece en todos los cambios.
2. `AFTER INSERT OR UPDATE`: inserta en `outbox_viajes` un evento `ViajeCambiado` con la **foto completa de la fila** (estado, chofer, importes, fechas, motivo de cancelación, coordenadas y `version`). Va en la misma transacción que el cambio: si el cambio se deshace, el evento también.

La migración también carga una vez los viajes que existían antes del trigger.

El despachador de `outbox_viajes` (el mismo que entrega `UsuarioRegistrado` a la billetera) reparte por tipo, y los `ViajeCambiado` van a `proyectorHistorialPostgres.aplicar`.

### Las tres limitaciones, para el historial

| Limitación | Solución | Dónde |
|---|---|---|
| Eventos duplicados | El upsert sólo pisa la fila si el evento trae una `version` **más nueva**. Un evento repetido trae la misma, y no hace nada. No hace falta `eventos_aplicados` | `proyectorHistorialPostgres.aplicar`; test "la proyección queda con el último estado aunque los eventos lleguen repetidos…" |
| Eventos fuera de orden | Acá el orden sí importa, porque es "último estado", no una suma. Es la "secuencia por agregado" que anticipaba la tabla de saldos: la `version` del viaje. Las versiones de un viaje se generan en orden porque cada cambio bloquea su fila. Si con dos despachadores llega primero la versión 3, la 2 se descarta | el mismo test, con los eventos desordenados y aplicados en paralelo |
| Desincronización | `npm run proyecciones:reconstruir` también borra `historial_viajes` y reproduce los `ViajeCambiado` del outbox | `scripts/reconstruirProyecciones.js`; test "el cobro real … y reconstruir desde el outbox da lo mismo" |

### El estado del cobro sale del viaje

Este ADR decía que el historial iba a combinar eventos de `outbox_viajes` y de `outbox_billetera`. Al implementarlo no hizo falta: desde el cobro en dos pasos (ADR 008), el estado del viaje ya dice si se cobró (`finalizado`) o si se debe (`pago_pendiente`), y `tarifaFinalCentavos` dice cuánto. Consumir los dos outbox sólo repetiría ese dato, y además habría que ordenar eventos de dos bases distintas.

### Los movimientos no van por una proyección

`GET /billetera/me/movimientos` lee `movimientos_billetera` directo de la base `billetera`. Los movimientos son la fuente de verdad del dinero: leerlos ahí no tiene atraso ni duplica datos, y CQRS ya se muestra con el saldo y con el historial. No cruza bases, porque la billetera lee sus propias tablas.

### Alternativas descartadas (historial)

| Alternativa | Por qué no |
|---|---|
| Llamar a `emitirViajeCambiado(client, viajeId)` en cada uno de los 8 puntos de escritura de `repositorioViajesPostgres.js` | Es más visible en el código, pero si alguien suma un `UPDATE viajes` y no la llama, el historial queda desactualizado sin que falle nada. Con el trigger, un cambio nuevo queda cubierto solo. Además no hace falta tocar el código de otro integrante |
| Usar `eventos_viaje` como outbox | Ya existe y es append-only, pero sus filas tienen sólo el tipo del cambio, no el estado completo del viaje. El proyector tendría que volver a consultar `viajes` (otra base) o reconstruir el estado evento por evento. Tampoco tiene la marca `procesado_at` que usa el despachador |
| Una proyección de movimientos en `lectura` | Más CQRS, pero con atraso y otra tabla que mantener para un dato que ya se lee bien de su base |

### Costos (historial)

- **Lógica en la base.** El trigger no se ve leyendo el repositorio. Por eso está en una migración con nombre propio y comentada, y el test "el trigger deja un ViajeCambiado por cada INSERT y UPDATE…" lo documenta.
- **Atraso medido**: unos 400 ms entre el cambio y `GET /viajes`, por el intervalo del despachador (500 ms) y porque entrega de a un evento. Para seguir un viaje en curso, la web usa `GET /viajes/{viajeId}`, que lee el modelo de escritura.
- **Cada cambio de un viaje escribe una fila más** en `outbox_viajes`. Con la tarea pesada de 500 choferes hay que medirlo. La ubicación del chofer no está en `viajes`, así que no dispara el trigger.

## Próximo paso

- Historial del chofer y panel del operador desde la misma proyección (falta un índice por `chofer_id`).
- Nombres de pasajero y chofer en el historial, cuando exista el campo `nombre` en `usuarios`. Hoy la proyección no los tiene.
