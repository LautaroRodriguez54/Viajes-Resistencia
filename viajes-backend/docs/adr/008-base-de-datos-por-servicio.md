# ADR 008 - Base de datos por servicio: la billetera en su propia base

- Estado: aceptado
- Fecha: 2026-11-26
- Participantes: Agustín Valussi (implementación); revisor del PR: Lucas Escobar
- Reemplaza en parte: ADR 004, en lo que dice del cobro en una sola transacción

## Contexto

Pregunta guía (tema 12 de Fernández): **¿por qué un servicio no debería consultar directamente las tablas internas de otro?**

Hasta la rama 6 había una sola base (`viajes`) y un solo usuario de base, que además era superusuario. El cobro bloqueaba `billeteras`, sumaba `movimientos_billetera` e insertaba el consumo en la misma transacción que cambiaba el viaje. El registro de usuario creaba la fila de `billeteras`. Había claves foráneas cruzadas (`billeteras.pasajero_id → usuarios`, `movimientos_billetera.viaje_id → viajes`).

Consecuencias de eso:
- **Acoplamiento.** Cualquier cambio interno de la billetera (renombrar una columna, partir una tabla) podía romper Viajes.
- **Nadie es dueño de los datos.** Cualquier parte del código podía escribir un movimiento.
- **No se puede separar.** La billetera no se podía publicar como servicio propio, que es lo que pide el TP integrador si nos toca M7, sin reescribir Viajes.

## Decisión

### Una base y un rol por módulo, en el mismo contenedor

| Base | Rol | Qué tiene |
|---|---|---|
| `viajes` | `viajes_app` | usuarios, choferes, viajes, ofertas, ubicaciones, tarifas, idempotencia HTTP, `outbox_viajes` |
| `billetera` | `billetera_app` | billeteras, movimientos, webhooks, `eventos_consumidos`, `outbox_billetera` |
| `lectura` | `lectura_app` | proyecciones (ADR 009) |

- `REVOKE CONNECT ... FROM PUBLIC` en cada base y `GRANT CONNECT` sólo al rol del módulo: el rol de Viajes recibe `permission denied for database "billetera"`.
- Los roles de la app sólo tienen DML (`SELECT/INSERT/UPDATE/DELETE`); las tablas, extensiones y triggers los crea `npm run migrate` con el superusuario (`ADMIN_DATABASE_URL`). Un `DROP TABLE` desde la app da `must be owner`.
- Sin claves foráneas entre bases: `pasajero_id` y `viaje_id` en la billetera son referencias por valor.
- La migración `004` borra las tablas de billetera de `viajes`. Como el runner reaplica todas las migraciones y la `001` las crea con `IF NOT EXISTS`, la `004` las vuelve a borrar en cada corrida: el estado final siempre es una base `viajes` sin datos de la billetera.

`src/infra/db/migrate.js` es idempotente: crea roles y bases si faltan, aplica las migraciones de cada base y da los permisos. Nunca modifica un rol que ya existe. `npm run setup:test` prepara `viajes_test`, `billetera_test` y `lectura_test`.

### La billetera se crea por evento

El registro de un pasajero inserta `UsuarioRegistrado` en `outbox_viajes`, en la misma transacción que el usuario. Un despachador dentro del backend (`src/infra/db/despachadorOutbox.js`) lo entrega a `billetera.crearBilleteraPorEvento`.

- **Outbox y no "llamar después del COMMIT".** Si se guarda el usuario y después se llama a la billetera, una caída en el medio deja un pasajero sin billetera. Con el outbox, el evento ya está guardado y se entrega al volver.
- **Entrega al menos una vez.** El despachador toma el evento con `FOR UPDATE SKIP LOCKED`, lo entrega y lo marca. Si la marca no llega, lo vuelve a entregar, y la billetera deduplica por id de evento (`eventos_consumidos`, tema 3).
- **Consistencia eventual.** Entre el registro y la billetera pasan hasta `OUTBOX_INTERVALO_MS` (500 ms por defecto; medido: ~150–250 ms). Un viaje que se finaliza en ese lapso queda en `pago_pendiente` con motivo `BILLETERA_NO_ENCONTRADA` y se cobra con el reintento. Lo vimos en la prueba manual con un script que hace todo en 170 ms.

### El cobro en dos pasos

Ya no puede haber una transacción única "finalizar + cobrar" porque son dos bases. El caso de uso (`src/aplicacion/viajes/finalizarViajeYCobrar.js` y `cobrarViajePendiente.js`) hace:

1. En `viajes`: `en_curso → pago_pendiente` con la tarifa final y el evento `cobro_solicitado`. COMMIT.
2. En `viajes`, otra transacción: bloquea el viaje (`FOR UPDATE`) y, **con el viaje bloqueado**, llama a `billetera.cobrar`, que abre su propia transacción en `billetera` (`FOR UPDATE` de la billetera, suma, consumo, evento al outbox, COMMIT). Si cobró: `pago_pendiente → finalizado` y `cobro_confirmado`; si no: sigue `pago_pendiente` y `cobro_pendiente` con el motivo. COMMIT.

Lo que garantiza:
- **El cobro nunca queda a medias.** Después del paso 1 el viaje ya figura como deuda. Si la billetera cobró y el COMMIT de `viajes` no llegó, el viaje sigue en `pago_pendiente` con un consumo hecho. El próximo intento llama a `cobrar` otra vez, y `cobrar` es **idempotente por `viajeId`**: ve el consumo y devuelve "cobrado" sin debitar. Test: `tests/aplicacion/cobroDeViajes.test.js` ("si falla el registro del viaje después de cobrar…").
- **Orden de bloqueo viaje → billetera, igual que antes.** Dos reintentos del mismo viaje se serializan en el bloqueo del viaje y el segundo ve `finalizado`. La carrera de la variante D (dos viajes, un saldo) se sigue resolviendo dentro de una sola base, con el `FOR UPDATE` de la billetera. Al no haber ciclos, no hay interbloqueo entre bases, que PostgreSQL no podría detectar.
- **El chofer no recibe errores de la billetera.** Si `cobrar` falla (sin billetera, base caída), el finalizar responde 200 con `pago_pendiente` y deja el motivo en `eventos_viaje`. El reintento del pasajero sí devuelve el error.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Otra base con el mismo superusuario | La separación queda sólo por convención: cualquier consulta podría cruzar y no hay "permission denied" que mostrar |
| Un schema `billetera` dentro de `viajes` | Es más débil que "base por servicio, sin consultas cruzadas entre bases" (prácticas mínimas del TP integrador) |
| Un contenedor Postgres por módulo | Separa igual, pero suma servicios al compose y memoria, sin ganar nada para la demo |
| Llamar a `billetera.crear` después del COMMIT del registro | Una caída entre los dos pasos deja un pasajero sin billetera, sin forma de recuperarlo |
| Crear la billetera al primer uso | La billetera no puede comprobar que el pasajero exista: un webhook con un uuid cualquiera crearía una billetera |
| Saga con un estado nuevo `cobrando` | `pago_pendiente` ya significa "terminó y se debe": no hace falta otro estado ni tocar el `CHECK` |
| Soltar el bloqueo del viaje antes de cobrar | Dos reintentos simultáneos llamarían los dos a `cobrar`; la idempotencia evita el doble débito, pero los dos responderían 200 y se registrarían dos `cobro_confirmado` |
| Transacción distribuida (two-phase commit) | PostgreSQL la soporta (`PREPARE TRANSACTION`), pero deja transacciones colgadas si el coordinador se cae y no existe entre servicios HTTP de otros grupos |

## Lo que se pierde

- **La atomicidad de "finalizar + cobrar".** Aparece un estado intermedio visible (`pago_pendiente`) que antes no existía. Normalmente dura milisegundos.
- **Los `JOIN` entre viaje y movimientos.** Las pantallas que combinen datos de las dos bases leen de proyecciones (ADR 009).
- **El bloqueo del viaje dura más.** Se mantiene mientras cobra la billetera. Hoy es una llamada dentro del mismo proceso. Si la billetera pasa a ser un servicio HTTP, hay que ponerle un timeout a esa llamada: el bloqueo dura como mucho eso, y si vence, el viaje queda en `pago_pendiente`.

## Cómo se demuestra

- `npm run demo:propiedad-datos`: cada rol lee su base; Viajes contra `billetera` y Billetera contra `viajes` dan `permission denied`; un `DROP TABLE` desde la app da `must be owner`.
- `tests/integracion/repositorioBilleterasPostgres.test.js`, "propiedad de datos": `viajes_test` no tiene tablas de billetera y `billetera_test` no tiene `usuarios` ni `viajes`.
- `tests/integracion/outbox.test.js`: el registro deja el evento, el despachador crea la billetera; si la entrega falla queda pendiente; si se entrega dos veces hay una sola billetera.
- Los tests de cobro de `tests/integracion/repositorioViajesPostgres.test.js` (incluida la carrera de la variante D) corren con las dos bases.
