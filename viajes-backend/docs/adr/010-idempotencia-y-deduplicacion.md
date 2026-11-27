# ADR 010 - Toda operación que crea o cobra exige Idempotency-Key, y cada nivel deduplica con una restricción única

- Estado: aceptado
- Fecha: 2026-11-26
- Participantes: Agustín Valussi (implementación); revisor del PR: Lucas Escobar

## Contexto

Pregunta guía (tema 3 de Fernández): **¿cómo permitir reintentos sin cobrar, registrar o procesar dos veces?**

Un cliente móvil que pierde la respuesta de `POST /viajes` no sabe si el viaje se creó, y lo normal es que reintente. Lo mismo pasa con un proxy que reintenta por timeout o con un doble toque en la pantalla. Sin protección, cada reintento crea otro viaje, otra oferta o un segundo intento de cobro. El enunciado de Puljiz pide `Idempotency-Key` en "todas las operaciones que crean, cobran o disparan un efecto externo" (bloque 6), y el TP integrador lo pide en RNF-09, RF-7.6 y RF-9.10.

La tabla `claves_idempotencia` existía desde `001_inicial.sql`, pero ningún código la usaba.

## Tres niveles

| Nivel | Qué deduplica | Mecanismo | Dónde |
|---|---|---|---|
| HTTP | El mismo pedido de un cliente | Header `Idempotency-Key` + tabla `claves_idempotencia` | `src/infra/http/idempotencia.js`, `src/infra/db/repositorioIdempotenciaPostgres.js` |
| Cobro | Un viaje cobrado dos veces | Clave natural `viaje_id`: índice único `ux_un_consumo_por_viaje` + `FOR UPDATE` del viaje y de la billetera | `repositorioBilleterasPostgres.js` (`crearCobroBilleteraPostgres`), ADR 004 |
| Eventos | Un webhook de carga repetido por el proveedor | `proveedor_evento_id` único + `INSERT ... ON CONFLICT DO NOTHING` en `eventos_webhook_pago` | `repositorioBilleterasPostgres.js` |

Los tres se complementan. El nivel HTTP le devuelve al cliente **la misma respuesta**; los otros dos garantizan que, aunque el pedido llegue igual a la base (otra clave, o sin pasar por HTTP), el efecto no se duplique.

## Nivel HTTP: cómo funciona

Se aplica después de `requiereAutenticacion` y del rol (#29: un rol equivocado da 403 sin reservar la clave), a las 11 operaciones que crean, cobran o cambian la tarifa:

| Endpoint | `ambito` |
|---|---|
| `POST /viajes` | `viajes.solicitar` |
| `POST /viajes/:viajeId/ofertas` | `viajes.ofrecer` |
| `POST /viajes/:viajeId/reintentar-cobro` | `viajes.reintentar_cobro` |
| `POST /ofertas/:ofertaId/aceptar` | `ofertas.aceptar` |
| `POST /choferes/viajes/:viajeId/finalizar` | `choferes.finalizar` |
| `POST /ofertas/:ofertaId/rechazar` | `ofertas.rechazar` |
| `POST /viajes/:viajeId/cancelar` | `viajes.cancelar_pasajero` |
| `POST /choferes/viajes/:viajeId/cancelar` | `choferes.cancelar_viaje` |
| `POST /operador/viajes/:viajeId/cancelar` | `operador.cancelar_viaje` |
| `POST /operador/viajes/:viajeId/reintentar-cobro` | `operador.reintentar_cobro` |
| `POST /admin/tarifa` | `admin.reemplazar_tarifa` |

Las primeras 5 son las de la decisión original (26/11); las otras 6 se sumaron con el rechazo (#22), las cancelaciones y el operador (#24–#26) y la tarifa del administrador, siguiendo la misma regla.

El webhook de carga no lo usa: ya tiene su propia clave (`eventoExternoId`), y quien llama es el proveedor, no un usuario con JWT.

1. **Header obligatorio.** Sin `Idempotency-Key` responde `400 CLAVE_IDEMPOTENCIA_REQUERIDA`. Si la clave no tiene entre 8 y 255 caracteres ASCII visibles, responde `400 CLAVE_IDEMPOTENCIA_INVALIDA`. Lo recomendado es un UUID por intención.
2. **Huella del pedido** (`request_sha256`): SHA-256 de método + ruta con sus parámetros + cuerpo con las claves ordenadas. La ruta entra en la huella porque la misma clave contra otro `viajeId` es otro pedido.
3. **Reserva atómica**: `INSERT ... (estado 'procesando') ON CONFLICT (actor_id, ambito, clave) DO NOTHING`. La restricción `UNIQUE (actor_id, ambito, clave)` hace que, entre N pedidos simultáneos, exactamente uno inserte; los otros ven la fila existente.
4. **Si la fila ya existía:**
   - Con otra huella: `422 CLAVE_IDEMPOTENCIA_REUTILIZADA` (el cliente usó mal la clave).
   - Todavía `procesando`: `409 PEDIDO_EN_CURSO` (hay que esperar y reintentar).
   - `completada`: se devuelve el status y el cuerpo guardados, con el header `Idempotency-Replayed: true`, **sin ejecutar la ruta**.
5. **Si la reserva es nueva**, se ejecuta la ruta y se intercepta `res.json`, que también usa el manejador de errores. Antes de responder:
   - 2xx y 4xx: se guarda la respuesta (`completada`). Un 4xx de dominio es el resultado de esa intención; por ejemplo, `SALDO_INSUFICIENTE` en un reintento de cobro. Para volver a intentar después de cargar saldo, el cliente usa una clave nueva.
   - 5xx: se borra la reserva. Un error interno no es un resultado, así que se puede reintentar con la misma clave.
6. **Vencimiento**: una clave dura `IDEMPOTENCIA_TTL_SEGUNDOS` (24 h por defecto) contados desde `created_at`. Al reservar se borra la fila vencida de esa misma clave y se trata como nueva. No hizo falta ninguna migración ni una columna `expira_at`, porque `created_at` ya alcanza.

La clave es **por actor** (`actor_id` sale del JWT, nunca del cuerpo). Dos usuarios con la misma clave no se pisan, y uno no puede leer la respuesta guardada de otro.

## Opciones consideradas

1. **Tabla en Postgres con reserva por restricción única (elegida).** La tabla ya existía, la base es la misma que usa la operación y la unicidad la garantiza la base, no el código.
2. **Redis con `SET NX` y TTL.** Es lo habitual y vence solo, pero suma un servicio al compose y deja la clave y la operación en dos almacenes distintos. Descartado por la misma razón que en los ADR 008 y 009: sólo Postgres. Si el TP integrador termina exigiendo Redis (RNF-11), se cambia sólo el adaptador del repositorio, porque el middleware depende de `reservar`, `completar` y `liberar`.
3. **Guardar la clave en la misma transacción que la operación.** Es más fuerte: la clave y el efecto se confirman juntos. Pero obliga a pasar la conexión de la transacción por todos los repositorios y casos de uso. Se descartó por ahora (ver "Consecuencias").
4. **Header opcional.** No rompe a ningún cliente, pero un reintento sin header duplica, y eso es justo lo que se quiere evitar. Además sería un hallazgo fácil en el ataque cruzado.
5. **Deduplicar sólo en el dominio** (índices únicos, estados). Ya existe para el cobro y la aceptación. Pero `POST /viajes` no tiene una clave natural: dos viajes iguales del mismo pasajero pueden ser legítimos, y sólo el cliente sabe si es "el mismo pedido".

## Consecuencias

- Una repetición devuelve exactamente la misma respuesta y no vuelve a ejecutar. Lo prueban:
  - `tests/integracion/idempotenciaHttp.test.js`: un solo viaje persistido, también con 10 pedidos simultáneos; `finalizar` repetido devuelve el mismo cobro con un solo consumo.
  - `tests/infra/idempotenciaHttp.test.js`: 400, 409, 422, 4xx guardado, 5xx liberado, clave por actor y vencimiento.
- **Clientes**: la web y los E2E tienen que mandar `Idempotency-Key` en esos 11 endpoints. Se genera un UUID por intención (por ejemplo, al tocar "Pedir viaje") y se reutiliza en sus reintentos.
- **Ventana sin atomicidad**: la clave se guarda en una sentencia aparte, después de la operación. Si el proceso se cae entre el COMMIT de la operación y el guardado de la respuesta, la clave queda `procesando`. Los reintentos reciben 409 hasta que venza el TTL, y después la operación se puede ejecutar de nuevo. En el cobro y la aceptación, el segundo nivel lo frena igual: el viaje ya no está `en_curso`, o ya tiene una oferta aceptada. En `POST /viajes` podría crear un segundo viaje, pero sólo después de 24 h. Pasa lo mismo si falla el `UPDATE` que guarda la respuesta: se responde igual al cliente y se loguea el error, en lugar de liberar la clave y arriesgar una segunda ejecución.
- JSONB no conserva el orden de las propiedades: la respuesta repetida tiene el mismo contenido, pero puede traer los campos en otro orden.
- La tabla crece una fila por operación. Las filas vencidas sólo se borran cuando se reusa su clave, así que falta una limpieza periódica (`DELETE ... WHERE created_at < now() - TTL`). Se deja para cuando exista el proceso de fondo del tema 13.

## Qué nos haría cambiar

- Si la ventana sin atomicidad se vuelve un problema real, o si la billetera pasa a su propia base (tema 12), la clave se guardaría en la misma transacción de la operación, dentro de cada servicio.
- Si la cátedra exige Redis para el TP2, se cambia el adaptador del repositorio y el middleware queda igual.
