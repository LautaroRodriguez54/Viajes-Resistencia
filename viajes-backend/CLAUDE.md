# CLAUDE.md

Backend de la plataforma de viajes (Node + PostgreSQL/PostGIS): TP final de **Programación IV**, grupo 4, **variante D: billetera y pagos**. Todo el código, la documentación y los identificadores están en español.

Qué pide cada docente, cómo se fusionan las consignas, cronograma y las reglas de Git están en el **`CLAUDE.md` de la raíz del repo**; la interfaz web, en `viajes-web/CLAUDE.md`. Acá queda sólo lo del backend. Resumen para ubicarse:

- **Puljiz:** este backend completo (8 bloques comunes + plataforma de viajes + variante D). Es lo que tiene fechas más cercanas (control 3: 11–17/11).
- **Fernández, temas:** 12 (base de datos por servicio), 13 (CQRS) e idempotencia, implementados acá y documentados como ADR 008–010.
- **Fernández, TP integrador (`CONSIGNA FERNANDEZ.docx`):** el mismo backend tiene que exponer un módulo de una plataforma de 9 módulos (probablemente **M7 Tarifas, Pagos y Liquidaciones**, a confirmar en el Acta de Alcance) con OpenAPI, Dockerfile, tests de contrato y releases TP1/TP2/TP3. Lo que eso agrega está en "Lo que falta para el TP integrador de Fernández".

## Stack y comandos

Node 22 (ESM, `"type": "module"`), Express 5, PostgreSQL 16 + PostGIS (Docker, puerto local **5433**), SQL directo con `pg` (sin ORM), Zod, JWT (`jsonwebtoken`), Argon2id, Pino.

```bash
cp .env.example .env
npm install
docker compose up -d
npm run setup     # bases y roles (viajes, billetera, lectura), migraciones y seed (ADR 008)
npm run setup:test  # bases *_test para los tests de integración
npm test          # node --test: sin DATABASE_URL corren sólo los que no usan base; con DATABASE_URL=.../viajes_test, todos
npm run lint      # ESLint con reglas de seguridad
npm run dev       # node --watch src/servidor.js
```

- Accesos de desarrollo (los crea el seed): `pasajero@demo.local` / `PasajeroDemo123!`, `chofer@demo.local` / `ChoferDemo123!` (ya habilitado), `operador@demo.local` / `OperadorDemo123!` y `admin@demo.local` / `AdminDemo123!`.
- `GET /health` (proceso) y `GET /ready` (las tres bases y `schema_migrations`; 503 si falta alguna migración).
- Express 5 propaga errores de handlers `async`; no hace falta `try/catch` ni `next(err)` en las rutas.
- `http://localhost:3000/` responde 404 `RUTA_NO_ENCONTRADA`: es sólo API. Se prueba con `curl`, REST Client o Postman.

## Arquitectura

Hexagonal liviana:

```text
src/
  dominio/      reglas puras: roles, estados de viaje, tarifa (Haversine), dinero, billetera, errores, puertos
  aplicacion/   casos de uso (autenticación, billetera, y en viajes/: solicitar, ofrecer, aceptar, rechazar, vencer, avanzar, cancelar, finalizar y cobrar, reintentar cobro)
  infra/
    http/       Express: rutas*, middleware Bearer, contexto (requestId con AsyncLocalStorage), errores
    db/         pool, migraciones SQL, seed, repositorios Postgres
    autenticacion/  Argon2id y JWT
    externos/   verificador HMAC del webhook
  config/env.js   validación de variables de entorno al arrancar
  composicion.js  único lugar donde se conectan adaptadores, casos de uso y rutas
  servidor.js     arranque y apagado ordenado (SIGTERM/SIGINT)
```

- El dominio no importa Express, `pg` ni librerías de infraestructura.
- El cobro (finalizar y reintentar) y el ciclo de vida completo de viajes y ofertas (ofrecer, aceptar, rechazar, vencer, cancelar y avanzar estado) viven como casos de uso en `src/aplicacion/viajes/` detrás de puertos (`unidadDeTrabajoCobro`, `unidadDeTrabajoViajes`), con adaptadores Postgres (`src/infra/db/`) y en memoria (`src/infra/memoria/` + `candados.js`), cubiertos en `tests/aplicacion/`.
- Tres bases en el mismo contenedor, una por módulo y con su propio rol (ADR 008): `viajes`, `billetera` y `lectura` (proyecciones, ADR 009). Se comunican por outbox (`outbox_viajes`, `outbox_billetera`) y un despachador dentro del backend (`despachadorOutbox.js`).

## Convenciones

- **Errores:** lanzar `ErrorDeDominio(codigo, mensaje)`. `infra/http/errores.js` mapea `codigo` a status HTTP (los códigos sin mapear dan 422) y responde `{ error: { codigo, requestId } }` sin stack trace. Al agregar un código nuevo, sumarlo al mapa.
- **Validación:** Zod `.strict()` con `safeParse` + `ErrorDeDominio('ENTRADA_INVALIDA', ...)`. No usar `.parse()` en rutas: un `ZodError` termina en 500.
- **Autorización:** `requiereAutenticacion(tokens)` deja `req.autenticacion = { usuarioId, rol }`; el rol se verifica en cada ruta (`soloPasajero`, `soloChofer`, etc.). La propiedad del recurso se verifica en la consulta (p. ej. `buscarPorIdDelPasajero`), nunca confiando en el id que manda el cliente.
- **Dinero:** siempre centavos enteros (`INTEGER`), nunca floats.
- **Billetera:** no existe saldo guardado en el modelo de escritura. El saldo es la suma de `movimientos_billetera` (`carga` suma, `consumo` resta). Los movimientos son inmutables (trigger); las correcciones se registran como movimientos nuevos.
- **Transacciones:** `pool.connect()` → `BEGIN` → `SELECT ... FOR UPDATE` → `COMMIT` / `ROLLBACK` en `catch` → `release()` en `finally`. Orden de bloqueo usado: viaje → ofertas del viaje (`ORDER BY id`) → perfil de chofer, y viaje → billetera (la billetera en su propia base, con el viaje bloqueado; ADR 008). Mantenerlo para no generar interbloqueos.
- **Eventos:** cada cambio de estado de un viaje inserta una fila en `eventos_viaje` en la misma transacción (auditoría y base del SSE). Además, un trigger (migración `006`) deja la foto de la fila en `outbox_viajes` (`ViajeCambiado`) en cada `INSERT`/`UPDATE` de `viajes`: no hace falta emitirlo a mano, pero cada `UPDATE` tiene que seguir subiendo `version` (si no, lo sube el trigger).
- **PostGIS:** puntos como `geography(Point, 4326)`; ojo, `ST_MakePoint(longitud, latitud)`.
- **Migraciones:** nuevos archivos en `src/infra/db/migraciones/` con prefijo numérico; se ejecutan en orden alfabético. No editar migraciones ya aplicadas.
- **Librerías:** el enunciado exige poder explicar qué garantiza cada librería y qué pasaría sin ella. No sumar dependencias que nadie del grupo pueda defender.

## Invariantes (defendidas en la base de datos)

1. Un chofer tiene como máximo un viaje activo: índice único parcial `ux_chofer_un_viaje_activo`.
2. Un viaje tiene como máximo un consumo de billetera: `ux_un_consumo_por_viaje`.
3. Un viaje tiene como máximo una oferta aceptada: `ux_una_oferta_aceptada_por_viaje`.
4. Un webhook de carga no acredita dos veces: `proveedor_evento_id` único.
5. Un único juego de parámetros de tarifa activo.
6. El cobro nunca es parcial: si el saldo no alcanza, no se debita y el viaje queda en `pago_pendiente`.

## Temas de Fernández

Hilo conductor: **"La billetera es un servicio dueño de sus datos (12); como ya no hay JOIN entre bases, las pantallas leen de proyecciones (13); y como los servicios se hablan con reintentos y eventos, todo tiene que ser idempotente (3)."** Es la misma historia de la exposición ("uno genera el problema, el otro lo resuelve"), aplicada a nuestro dominio. La analogía de las dos oficinas sirve tal cual: secretaría = módulo Viajes, depósito = módulo Billetera, teléfono = puerto `servicioBilletera`, buzón = outbox, ayudante = proyector, pizarra = base de lectura.

### Tema 12 · Base de datos por servicio y propiedad de datos
- **Pregunta guía:** ¿por qué un servicio no debería consultar directamente las tablas internas de otro?
- **El problema hoy, en nuestro código:**
  - **Hecho (rama 7, ADR 008):** la billetera está en la base `billetera` con el rol `billetera_app`; Viajes recibe `permission denied` (`npm run demo:propiedad-datos`). La billetera se crea por el evento `UsuarioRegistrado`. La migración `004` borró las tablas de billetera de `viajes`, y con ellas las FKs cruzadas que había antes (`billeteras.pasajero_id → usuarios`, `movimientos_billetera.viaje_id → viajes`).
- **Diseño propuesto:** monolito modular con **dos bases en el mismo contenedor Postgres**: `viajes` (usuarios, choferes, viajes, ofertas, ubicaciones, tarifas) y `billetera` (billeteras, movimientos, webhooks). Cada módulo tiene su propio pool y su propio usuario de base, sin permisos sobre la otra. Viajes cobra sólo a través del puerto `servicioBilletera.cobrar({ viajeId, pasajeroId, importeCentavos })`, con adaptador real y adaptador en memoria (sirve también para el bloque 2). La billetera se crea al primer uso o por el evento `UsuarioRegistrado`, no desde el repositorio de usuarios.
- **Lo que se pierde (está en la diapositiva "Lo que se pierde al separar las bases") y cómo se resuelve:** ya no hay transacción única "finalizar + cobrar". Flujo nuevo: Viajes registra la tarifa final y deja el viaje en `pago_pendiente` → llama a `cobrar` con clave `viajeId` → aprobado: `finalizado`; saldo insuficiente: sigue `pago_pendiente` con motivo; error o timeout: sigue `pago_pendiente` y un reintentador lo vuelve a intentar (seguro gracias al tema 3). El cobro nunca queda a medias. La carrera de la variante D (dos cobros contra un saldo) **sigue resuelta dentro de una sola base** (`billetera`, `FOR UPDATE` sobre la billetera). El ADR 004 queda parcialmente reemplazado.
- **Demo (PDF):** los dos módulos con almacenes separados intercambian datos por API/evento; cambiar el esquema interno de `billetera` (p. ej. renombrar una columna) sin tocar ni romper Viajes. Mostrar que el usuario de base de Viajes recibe "permission denied" si intenta leer `billetera`.

### Tema 13 · CQRS: separar escritura y lectura
- **Pregunta guía:** ¿cuándo ayuda usar modelos distintos para comandos y consultas?
- **Nivel 2 (como en la exposición): bases separadas sincronizadas por eventos.**
  - Escritura: `viajes` (con `eventos_viaje`) y `billetera` (con su propio outbox de movimientos).
  - Lectura: base `lectura` con proyecciones desnormalizadas:
    - `historial_viajes` (**hecho, rama 10**: lo alimenta el trigger de la migración `006` con `ViajeCambiado`, ordenado por `version`; todavía sin nombres, porque `usuarios` no tiene `nombre`): viaje + nombre del pasajero + nombre del chofer + tarifa + estado de cobro. Es el equivalente a "pedidos con el nombre del cliente" de la exposición: combina datos de dos bases que ya no admiten JOIN. Alimenta requisitos obligatorios del enunciado: historial del pasajero, historial del chofer y panel del operador.
    - `saldos`: saldo y últimos movimientos para mostrar en `GET /billetera/me`.
  - Proyector: proceso dentro del backend que lee los outbox, aplica cada evento a `lectura` y registra lo procesado.
- **Regla para la defensa:** la proyección de saldos es sólo para mostrar. **El cobro decide siempre sobre el modelo de escritura** (suma de movimientos con `FOR UPDATE`). La consistencia eventual en la pantalla se acepta; en el dinero, no.
- **Limitaciones de la diapositiva que hay que resolver en código:** eventos duplicados (dedupe por id de evento, tema 3), fuera de orden (versión/secuencia por agregado), desincronización (la proyección se puede reconstruir desde cero reproduciendo los outbox: comando `npm run proyecciones:reconstruir`).
- **Outbox y no "publicar después del COMMIT":** si se guarda y después se publica, una caída en el medio pierde el evento (doble escritura). El evento se inserta en la misma transacción que el cambio. Ojo: con `GENERATED ... IDENTITY` dos transacciones pueden confirmar fuera de orden de id, así que el proyector no debe usar sólo "último id leído"; marcar cada fila procesada o deduplicar por id.
- **Demo (PDF):** registrar viajes/movimientos en el modelo de escritura y mostrar la vista actualizada; mostrar la consulta de historial sin JOINs.

### Tema 3 · Idempotencia y deduplicación
- **Pregunta guía:** ¿cómo permitir reintentos sin cobrar, registrar o procesar dos veces?
- **Tres niveles en el sistema:**
  1. **HTTP (hecho, ADR 010):** middleware `Idempotency-Key` sobre `claves_idempotencia`: `(actor_id, ambito, clave)` único + `request_sha256`. Primera vez: `INSERT ... ON CONFLICT DO NOTHING` con estado `procesando`, ejecutar y guardar status y cuerpo. Repetida y completada: devolver la respuesta guardada sin ejecutar nada. Repetida en curso: 409. Misma clave con otro cuerpo: 422. Aplicar en `POST /viajes`, aceptar oferta, finalizar/cobrar y carga demo. El enunciado lo exige en "todas las operaciones que crean, cobran o disparan un efecto externo".
  2. **Entre servicios:** `cobrar` usa `viajeId` como clave natural (`ux_un_consumo_por_viaje`); un reintento devuelve el resultado del primer cobro.
  3. **Eventos:** webhook deduplicado por `proveedor_evento_id` (hecho); proyector deduplicado por id de evento.
- **Demo (PDF):** repetir una solicitud con la misma `Idempotency-Key` y demostrar una única operación persistida. Es también el test obligatorio del bloque 6.

### Entregables de los temas de Fernández
- `docs/adr/008-...` (base de datos por servicio), `009-...` (CQRS con proyecciones), `010-...` (idempotencia HTTP). **Decidido: sólo Postgres** (outbox con polling + base `lectura` en Postgres), para no sumar dos tecnologías al Docker Compose y no perder eventos entre el COMMIT y la publicación. **RabbitMQ** y **MongoDB** (los de la demo de la exposición) son las opciones descartadas de los ADR 009/010; si algún día se cambian, se toca sólo el adaptador del bus y el de lectura. **A revisar:** el TP integrador pide RabbitMQ y Redis "o alternativa aprobada" (RNF-10/11); ver "Choques entre consignas" en el `CLAUDE.md` de la raíz.
- `docs/fernandez/` con un documento por tema (pregunta guía, cómo se aplica en el proyecto, demo con comandos) y `librerias.md`.
- **Librerías y frameworks a documentar:** Express 5 (HTTP, errores async), `pg` (SQL parametrizado, transacciones, `FOR UPDATE`), PostgreSQL 16 + PostGIS (relacional + búsqueda geográfica), Zod (validación `.strict()`), `jsonwebtoken` (JWT), `argon2` (hash Argon2id), Pino (logs JSON), helmet, cors, dotenv, `node:test`, Docker Compose. A sumar: limitador de tasa, autocannon o k6, ESLint y algo para tests HTTP de integración (p. ej. supertest).

## Estado actual

Al 27/11/2026. El contrato completo está en `docs/openapi.yaml` (0.12.0). La próxima migración de `viajes` es la `008` (la `007` agrega los nombres de los lugares).

| Área | Endpoints | Estado |
|---|---|---|
| Salud | `GET /health`, `GET /ready` (verifica las tres bases y `schema_migrations`) | Hecho |
| Autenticación | `POST /auth/register` (pasajero/chofer), `POST /auth/login`, `GET /auth/me` | Hecho (sin refresh ni revocación) |
| Billetera | `POST /billetera/webhooks/cargas` (HMAC + dedupe), `GET /billetera/me` (lee la proyección de `lectura`), `GET /billetera/me/movimientos` (lee la base `billetera`) | Hecho, en su propia base (ADR 008 y 009) |
| Viajes | `POST /viajes`, `GET /viajes` (historial desde la proyección `historial_viajes`), `GET /viajes/:viajeId` (sólo el pasajero dueño; con nombres de lugares y, mientras está activo, vehículo y posición del chofer), `POST /viajes/:viajeId/reintentar-cobro`, `POST /viajes/:viajeId/cancelar` | Hecho |
| Ofertas | `POST /viajes/:viajeId/ofertas` (chofer más cercano a ≤5 km), `POST /ofertas/:ofertaId/aceptar`, `POST /ofertas/:ofertaId/rechazar` | Hecho, con vencimiento automático en el servidor (#22) |
| Chofer | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion` (sin `FOR UPDATE` e historial por lotes, ADR 005), `GET /choferes/me/ofertas`, `GET /choferes/me/viaje-actual`, `POST /choferes/viajes/:viajeId/estado`, `POST /choferes/viajes/:viajeId/finalizar`, `POST /choferes/viajes/:viajeId/cancelar` | Hecho |
| Operador | `GET /operador/viajes?estado=activos`, `POST /operador/viajes/:viajeId/cancelar` (motivo obligatorio), `POST /operador/viajes/:viajeId/reintentar-cobro` | Hecho (#24–#26) |
| Admin | `GET /admin/choferes`, `PATCH /admin/choferes/:choferId/habilitacion`, `GET /admin/tarifa`, `POST /admin/tarifa` (fila nueva activa, `LOCK TABLE`), `GET /admin/metricas` | Hecho |

- Los 11 endpoints que crean, cobran o cambian la tarifa exigen `Idempotency-Key` (ADR 010). El rol se verifica antes que la clave.
- **Tests**: 273, en `tests/dominio`, `aplicacion`, `infra`, `integracion`, `seguridad` y `concurrencia`. Un solo comando: `npm test` con `DATABASE_URL` apuntando a `viajes_test`.
- **Lint**: ESLint con `eslint-plugin-security`, 0 errores. **CI** en GitHub Actions, obligatoria en cada PR: lint, tests con PostGIS, auditoría, Semgrep y Playwright (`e2e/`, 1 recorrido hasta `pago_pendiente`).
- **ADR**: 001 a 011. El 004 y el 005 ya están "aceptado" (el 008 reemplaza en parte al 004).

## Lo que falta (por bloque del enunciado)

Prioridad (27/11): lo de la rúbrica de Puljiz que no llegó (ataque cruzado, Grafana, k6, más E2E) **quedó sin efecto** por decisión del grupo; lo que importa es que la app sea funcional y cumpla los demás requisitos obligatorios. Lo siguiente es el TP1 de Fernández (Dockerfile, trazabilidad, validación contra el OpenAPI).

### Bloque 1 — Proyecto y arranque
- [x] `npm run lint` real (ESLint con reglas de seguridad).
- [x] README: qué hace, tabla de roles con permisos, accesos de prueba de los 4 roles e índice de `docs/`.
- [ ] Probar la secuencia de clon limpio en otra máquina.

### Bloque 2 — Arquitectura hexagonal
- [x] Puertos para viajes, choferes/ofertas y billetera, cada uno con **adaptador real y adaptador en memoria** (`src/infra/memoria/`). Hecho: billetera, cobro, idempotencia, y ciclo de vida de viajes y ofertas (`unidadDeTrabajoViajes`, `candados.js`).
- [x] Sacar la lógica de cobro, aceptación y cambios de estado de los repositorios y pasarla a casos de uso que dependan de puertos (`finalizarViajeYCobrar`, `reintentarCobro`, `avanzarEstadoViaje`, `cancelarViaje`, `aceptarOferta`, `ofrecerAlChoferCercano`, `rechazarOferta`, `procesarOfertasVencidas`).

### Bloque 3 — Configuración y ciclo de vida
- [x] `/ready` tiene que verificar también que las migraciones estén aplicadas (`schema_migrations` en las 3 bases → `503 SERVICIO_NO_DISPONIBLE`).
- [x] Si el apagado supera `SHUTDOWN_TIMEOUT_MS`, loguear antes de `process.exit(1)` (`apagadoOrdenado.js` / `servidor.js`).
- [x] Demo/test: `SIGTERM` durante un pedido lento y el pedido termina antes de salir (`tests/infra/apagadoOrdenado.test.js`).

### Bloque 4 — Errores y observabilidad
- [x] Loguear los 4xx esperados con nivel menor que `error` en `errores.js` (`warn`, PR #10).

### Bloque 5 — Seguridad
- [x] Reemplazar `z...parse()` por `safeParse` en `rutasChoferes.js` (PR #10).
- [x] Rate limiting con 429 y encabezados `RateLimit-*` (login, webhook, ubicación), con test (PR #10).
- [x] Tests: recurso ajeno → 403/404, prototype pollution, inyección SQL, CORS y headers (`tests/seguridad`, PR #13).
- [~] `npm audit` lo corre la CI; falta justificar en el README lo que quede.

### Bloque 6 y problema central (6.3) — Concurrencia e idempotencia
- [x] Idempotencia HTTP (tema 3) con test (ADR 010, `tests/integracion/idempotenciaHttp.test.js`).
- [x] Test: 50 aceptaciones simultáneas sobre el mismo viaje, exactamente una gana (`tests/concurrencia/aceptacionOfertas.test.js`).
- [x] Cancelaciones (pasajero, chofer, operador con motivo) y test de cancelación simultánea a la aceptación, con los dos resultados posibles documentados (#24–#26).
- [x] Test: un chofer con viaje activo no puede aceptar otro.
- [x] Vencimiento de ofertas en el servidor, siguiente candidato y `sin_choferes_disponibles` al agotar la lista (PR #22).
- [x] Ofertas duplicadas y choferes con oferta pendiente con `FOR UPDATE SKIP LOCKED` + revalidación después del bloqueo (PR #21, que arregla el test intermitente).
- [x] Rechazo explícito de oferta por el chofer (PR #22).
- [x] ADR 004 completo: qué se bloquea, en qué orden, por qué no hay doble asignación ni interbloqueo.

### Variante D — Billetera
- [x] Separación en base propia (tema 12, ADR 008) y proyección de saldos (tema 13, ADR 009).
- [x] Test de la carrera: dos viajes del mismo pasajero cobran a la vez contra un saldo que alcanza para uno (con Postgres y en memoria).
- [x] Test que muestre por qué no se usa float para dinero (`tests/dominio/billetera.test.js`).
- [x] Salida de `pago_pendiente`: `POST /viajes/:viajeId/reintentar-cobro`, del pasajero dueño.
- [x] Viaje con estimación 0: finaliza sin movimiento.
- [x] Carga de saldo para la demo sin exponer el secreto HMAC: `npm run cargar-saldo`.

### 6.2, 6.4 y 6.5 — Alcance funcional
- [~] Estimación previa sin crear el viaje: **hecha** (`POST /viajes/estimacion`, misma función y tarifa que la solicitud; la web la muestra en Pedir). Falta la tarifa final desde el recorrido y la duración reales. (Los tests de tarifa con distancia cero y con máximo permitido ya están en `tests/dominio/tarifa.test.js`.)
- [ ] Asignación automática al crear el viaje (hoy el pasajero llama a mano a `/ofertas`).
- [ ] Tiempo real por SSE con `Last-Event-ID` (estado del viaje + posición del chofer). `EventSource` no permite el header `Authorization`: ticket corto de un solo uso, nunca el JWT en la URL.
- [x] Test: la ubicación del chofer sólo la ve su pasajero y sólo mientras el viaje está activo (`tests/integracion/nombresYUbicacionChofer.test.js`). La del pasajero no se expone en ningún endpoint.
- [~] Historiales (pasajero y chofer) y panel del operador: salen de las proyecciones del tema 13. Hecho: el del pasajero (`GET /viajes`, rama 10) y los movimientos de la billetera. Falta el del chofer y que el panel del operador lea la proyección.
- [x] Administración de tarifas: `GET` y `POST /admin/tarifa` (la tarifa nunca se edita, se crea una nueva activa) y listado de choferes por habilitar. Zonas y radio siguen fijos.
- [ ] Campo `nombre` en `usuarios` (migración nueva) y pedirlo en `POST /auth/register`. Hoy sólo hay email, y la proyección `historial_viajes` (tema 13) y las pantallas muestran nombre de pasajero y chofer.
- [x] Usuario operador en el seed (`operador@demo.local`) y endpoints del operador: `GET /operador/viajes?estado=activos`, cancelar con motivo, reintentar cobro de un `pago_pendiente` (#24–#26).
- [ ] La oferta le llega al chofer por SSE con origen, destino, polilínea de la ruta, distancia/tiempo hasta el retiro y tarifa estimada (la web la previsualiza en el mapa).
- [ ] Decidir si el radio de búsqueda (hoy fijo en 5 km) pasa a parámetros administrables o queda como constante.
- [x] Política de retención/agregación de `historial_ubicaciones_chofer` (con 500 choferes son ~21 M filas/día) — definida en `docs/modelo.md`.

### Bloque 7 y 6.6 — Tarea pesada
- [x] Simulador de 500 choferes enviando ubicación cada 2 s durante varios minutos, mientras se asignan viajes (`npm run carga:ubicaciones`).
- [x] Versión ingenua y versión final (ADR 005: sin `FOR UPDATE` en pings + batching asíncrono con `unnest` drenado en apagado). Medido p50/p95/p99 de solicitud de viaje, tiempo hasta asignación, req/s, lag del event loop con `monitorEventLoopDelay` (`GET /admin/metricas`), memoria; 3 corridas de ≥30 s cada una.
- [x] Declarar el tiempo de asignación objetivo del grupo (p95 ≤ 500 ms, lag p99 < 50 ms en `docs/mediciones.md`).

### Bloque 8 — Tests
- [x] Tres niveles con un solo comando: `tests/dominio`, `tests/aplicacion`, `tests/integracion` (Postgres real en Docker, estado conocido por test), `tests/seguridad` y `tests/concurrencia`.

### Documentación y proceso
- [x] ADR: participantes y fecha completos en 001–011 (004 y 005 cerrados por Lucas).
- [x] `docs/mediciones.md`: hipótesis con número antes de medir, entorno, comando exacto, tabla ingenua vs final, conclusión.
- [—] **Sin efecto (27/11)** · `docs/ataque.md`: bitácora (número, hipótesis, petición exacta, esperado, obtenido, veredicto, severidad, impacto) y respuesta del defensor (causa raíz, commit, test que falla antes y pasa después).
- [x] `docs/api.md` como índice del OpenAPI (rama `docs/api-openapi`). Quedan prefijo/versión de API y eventos SSE.
- [x] `docs/modelo.md`: diagrama de estados del viaje, transiciones de `pago_pendiente`, reglas de tarifa (y su cambio por el admin) y radio, retención de ubicaciones, separación de bases.
- [ ] Git: commits de los tres a lo largo del cuatrimestre, PR con revisión real de otro integrante, tag `entrega-final`.

## Lo que falta para el TP integrador de Fernández

Además de lo de Puljiz. Códigos RF/RNF del Word. El alcance exacto de cada entrega lo fija el Acta de Alcance: esto es el máximo posible, no todo es obligatorio para TP1.

### TP1 · Contrato ejecutable
- [~] **OpenAPI** versionado (hecho: `docs/openapi.yaml` 0.12.0, + Swagger UI en el compose con `--profile docs`; falta validar las respuestas en los tests) (`docs/openapi.yaml`) con parámetros, esquemas, validaciones, ejemplos, respuestas de éxito y error (`{ error: { codigo, requestId } }`) y esquema de seguridad Bearer; visualización local (p. ej. Swagger UI en `GET /docs`, deshabilitada en producción). Los esquemas Zod y el contrato no pueden divergir.
- [ ] Tests de integración que validen las respuestas contra el OpenAPI.
- [ ] Mocks/stubs de las dependencias de otros módulos hechos desde **sus** OpenAPI, con casos de éxito, error y demora. Encajan como adaptadores en memoria de los puertos (también cumplen el bloque 2 de Puljiz).
- [ ] **Dockerfile** del backend (multi-stage, usuario no root, `HEALTHCHECK` contra `/health`) y servicio `api` en `docker-compose.yml`. La secuencia de clon limpio de Puljiz tiene que seguir funcionando igual.
- [ ] Matriz de trazabilidad `docs/trazabilidad.md`: RF → operación OpenAPI → regla/archivo → test.
- [~] ESLint y CI en GitHub Actions con lint + tests en cada PR hacia `main` (hechos, RNF-17). Falta el formateador (Prettier).
- [ ] Versión semántica en `package.json` y tag/release `tp1`.

### TP2 · Integración con otros grupos
- [ ] Imagen publicada en una registry (p. ej. GHCR) con tag de versión, nunca sólo `latest`.
- [ ] URLs, credenciales, colas y **timeouts** de otros módulos por variables de entorno validadas en `config/env.js`; reintentos limitados y respuesta controlada cuando un servicio no responde o tarda (RNF-13), nunca bloqueo indefinido.
- [ ] ≥1 integración síncrona (HTTP) y ≥1 asíncrona (eventos del outbox; RabbitMQ o alternativa aprobada).
- [ ] Catálogo de eventos (`docs/eventos.md`): nombre, versión, productor, consumidores, carga útil, clave de idempotencia.
- [ ] Propagar el id de correlación entre servicios (header `X-Request-Id` de entrada y salida) y loguearlo junto con `viajeId`/`reservaId` (RNF-14).
- [ ] Tests de contrato consumidor/proveedor con respuestas inválidas, caída y demora.
- [ ] Si M1 lo hace otro grupo, validar sus tokens detrás de un puerto (RF-1.4); nuestro JWT queda para el modo aislado.

### Dominio que suma el Word (según el módulo asignado)
- **M7 (el más probable):** estimación por tipo de vehículo (RF-7.1); medio de pago, con la billetera como medio (RF-7.2); autorización y captura simulada (RF-7.3); **cargo de cancelación** (RF-7.4) y **reintegro** total o parcial (RF-7.5), los dos como movimientos nuevos, nunca editando; historial financiero con rechazos (RF-7.7); **liquidación al conductor** con su estado (RF-7.8). La idempotencia de cobro y reintegro (RF-7.6) la cubre el tema 3.
- **Del resto de la plataforma:** tipos de vehículo auto/moto en choferes, ofertas y tarifa (RF-3.2, 4.2, 5.1); TTL configurable de ubicación para excluir choferes fantasma (RF-4.3); arribo del chofer e **inicio con QR o código de un solo uso** (RF-6.3, 6.4); calificaciones sin duplicados (RF-2.5, 3.7); habilitación con aprobar/observar/suspender/rechazar y motivo (RF-3.4); comprobante (RF-8.4); reservas con activación idempotente (M9, RF-9.10). Si no son nuestro módulo, alcanza con consumirlos de otro grupo o con un mock.
- Sin datos sensibles en logs, QR ni URLs (RNF-19); HTTPS en el entorno publicado (RNF-12).

## Cambios de backend que la web necesita

Casi todos ya están en "Lo que falta". El diseño de la web está en `viajes-web/CLAUDE.md`.

- `http://localhost:5173` en `CORS_ORIGINS`; `POST /viajes/estimacion`; `mapearViaje` devolviendo `origen`/`destino` (`ST_Y`/`ST_X`) y vehículo, patente y minutos hasta el retiro; asignación automática; `GET /choferes/me/ofertas` + rechazar; SSE con ticket; evento `ubicacion_chofer` sólo por SSE (no en `eventos_viaje`); `GET /viajes`, `GET /choferes/me/viaje-actual`, `GET /billetera/me/movimientos`, `GET /operador/viajes?estado=activos`, `GET /admin/choferes`; carga demo; token de 15 min sin refresh (alargar `JWT_ACCESS_TOKEN_TTL` para la demo o implementar refresh).
- **Mapas:** la web usa OpenStreetMap (Leaflet, Photon y OSRM) sin claves (ADR 011, Decisión 4): Google pide tarjeta. **La tarifa se calcula siempre en el servidor**: el cliente manda sólo coordenadas y la ruta de OSRM es sólo visual. Si algún día la tarifa usa la distancia por calles, va OSRM (servidor propio o el público) detrás de un puerto `calculadorRutas` con caída a Haversine y timeout (RNF-13). La posición del chofer viene del navegador y puede falsificarse: validar rango, frecuencia y saltos imposibles (material para el ataque cruzado).

## Documentación de referencia

- `docs/guia-implementacion.md`: recorrido archivo por archivo del estado actual.
- `docs/modelo.md`, `docs/api.md`, `docs/adr/`, `docs/mediciones.md`, `docs/ataque.md`.
- `docs/diseno-web/`: diseño de la interfaz (lo usa `viajes-web/`).
- Enunciados: resumidos en el `CLAUDE.md` de la raíz.

## Notas

- Para levantar el backend en Windows primero hay que abrir Docker Desktop (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`); si no, `docker compose` falla con "failed to connect to the docker API".
- Las bases `billetera` y `lectura` y los roles los crea `npm run setup` (`migrate.js` con `ADMIN_DATABASE_URL`), no un script de `docker-entrypoint-initdb.d`: no hace falta `docker compose down -v`. Para los tests de integración: `npm run setup:test`.
- Git, ramas, finales de línea y PowerShell: ver el `CLAUDE.md` de la raíz.
