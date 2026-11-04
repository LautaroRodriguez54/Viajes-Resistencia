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
npm run setup     # migrate + seed (tarifa de desarrollo y admin)
npm test          # node --test (hoy sólo unitarios, no requieren DB)
npm run dev       # node --watch src/servidor.js
```

- Admin de desarrollo: `admin@demo.local` / `AdminDemo123!`.
- `GET /health` (proceso) y `GET /ready` (hoy sólo hace `SELECT 1`).
- Express 5 propaga errores de handlers `async`; no hace falta `try/catch` ni `next(err)` en las rutas.
- `http://localhost:3000/` responde 404 `RUTA_NO_ENCONTRADA`: es sólo API. Se prueba con `curl`, REST Client o Postman.

## Arquitectura

Hexagonal liviana:

```text
src/
  dominio/      reglas puras: roles, estados de viaje, tarifa (Haversine), dinero, billetera, errores, puertos
  aplicacion/   casos de uso (registrarUsuario, iniciarSesion, procesarCargaWebhook, solicitarViaje)
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
- Varias operaciones (ofertas, aceptación, cambios de estado, cobro) van directo de la ruta al repositorio sin caso de uso ni puerto intermedio. Esto **no cumple** el bloque 2 (ver "Lo que falta").
- Hay una sola base (`viajes`) compartida por todos los módulos. Los temas 12 y 13 la van a separar (ver abajo).

## Convenciones

- **Errores:** lanzar `ErrorDeDominio(codigo, mensaje)`. `infra/http/errores.js` mapea `codigo` a status HTTP (los códigos sin mapear dan 422) y responde `{ error: { codigo, requestId } }` sin stack trace. Al agregar un código nuevo, sumarlo al mapa.
- **Validación:** Zod `.strict()` con `safeParse` + `ErrorDeDominio('ENTRADA_INVALIDA', ...)`. No usar `.parse()` en rutas: un `ZodError` termina en 500.
- **Autorización:** `requiereAutenticacion(tokens)` deja `req.autenticacion = { usuarioId, rol }`; el rol se verifica en cada ruta (`soloPasajero`, `soloChofer`, etc.). La propiedad del recurso se verifica en la consulta (p. ej. `buscarPorIdDelPasajero`), nunca confiando en el id que manda el cliente.
- **Dinero:** siempre centavos enteros (`INTEGER`), nunca floats.
- **Billetera:** no existe saldo guardado en el modelo de escritura. El saldo es la suma de `movimientos_billetera` (`carga` suma, `consumo` resta). Los movimientos son inmutables (trigger); las correcciones se registran como movimientos nuevos.
- **Transacciones:** `pool.connect()` → `BEGIN` → `SELECT ... FOR UPDATE` → `COMMIT` / `ROLLBACK` en `catch` → `release()` en `finally`. Orden de bloqueo usado: oferta → viaje → perfil de chofer; viaje → billetera. Mantenerlo para no generar interbloqueos.
- **Eventos:** cada cambio de estado de un viaje inserta una fila en `eventos_viaje` en la misma transacción. Es la base del SSE y será el outbox del proyector CQRS.
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
  - `repositorioViajesPostgres.js` (`finalizarYCobrar`) bloquea `billeteras`, suma `movimientos_billetera` e inserta el consumo: Viajes escribe en tablas de Billetera.
  - `repositorioUsuariosPostgres.js` crea la fila de `billeteras` dentro del registro de usuario.
  - FKs cruzadas: `billeteras.pasajero_id → usuarios`, `movimientos_billetera.viaje_id → viajes`.
- **Diseño propuesto:** monolito modular con **dos bases en el mismo contenedor Postgres**: `viajes` (usuarios, choferes, viajes, ofertas, ubicaciones, tarifas) y `billetera` (billeteras, movimientos, webhooks). Cada módulo tiene su propio pool y su propio usuario de base, sin permisos sobre la otra. Viajes cobra sólo a través del puerto `servicioBilletera.cobrar({ viajeId, pasajeroId, importeCentavos })`, con adaptador real y adaptador en memoria (sirve también para el bloque 2). La billetera se crea al primer uso o por el evento `UsuarioRegistrado`, no desde el repositorio de usuarios.
- **Lo que se pierde (está en la diapositiva "Lo que se pierde al separar las bases") y cómo se resuelve:** ya no hay transacción única "finalizar + cobrar". Flujo nuevo: Viajes registra la tarifa final y deja el viaje en `pago_pendiente` → llama a `cobrar` con clave `viajeId` → aprobado: `finalizado`; saldo insuficiente: sigue `pago_pendiente` con motivo; error o timeout: sigue `pago_pendiente` y un reintentador lo vuelve a intentar (seguro gracias al tema 3). El cobro nunca queda a medias. La carrera de la variante D (dos cobros contra un saldo) **sigue resuelta dentro de una sola base** (`billetera`, `FOR UPDATE` sobre la billetera). El ADR 004 queda parcialmente reemplazado.
- **Demo (PDF):** los dos módulos con almacenes separados intercambian datos por API/evento; cambiar el esquema interno de `billetera` (p. ej. renombrar una columna) sin tocar ni romper Viajes. Mostrar que el usuario de base de Viajes recibe "permission denied" si intenta leer `billetera`.

### Tema 13 · CQRS: separar escritura y lectura
- **Pregunta guía:** ¿cuándo ayuda usar modelos distintos para comandos y consultas?
- **Nivel 2 (como en la exposición): bases separadas sincronizadas por eventos.**
  - Escritura: `viajes` (con `eventos_viaje`) y `billetera` (con su propio outbox de movimientos).
  - Lectura: base `lectura` con proyecciones desnormalizadas:
    - `historial_viajes`: viaje + nombre del pasajero + nombre del chofer + tarifa + estado de cobro. Es el equivalente a "pedidos con el nombre del cliente" de la exposición: combina datos de dos bases que ya no admiten JOIN. Alimenta requisitos obligatorios del enunciado: historial del pasajero, historial del chofer y panel del operador.
    - `saldos`: saldo y últimos movimientos para mostrar en `GET /billetera/me`.
  - Proyector: proceso dentro del backend que lee los outbox, aplica cada evento a `lectura` y registra lo procesado.
- **Regla para la defensa:** la proyección de saldos es sólo para mostrar. **El cobro decide siempre sobre el modelo de escritura** (suma de movimientos con `FOR UPDATE`). La consistencia eventual en la pantalla se acepta; en el dinero, no.
- **Limitaciones de la diapositiva que hay que resolver en código:** eventos duplicados (dedupe por id de evento, tema 3), fuera de orden (versión/secuencia por agregado), desincronización (la proyección se puede reconstruir desde cero reproduciendo los outbox: comando `npm run proyecciones:reconstruir`).
- **Outbox y no "publicar después del COMMIT":** si se guarda y después se publica, una caída en el medio pierde el evento (doble escritura). El evento se inserta en la misma transacción que el cambio. Ojo: con `GENERATED ... IDENTITY` dos transacciones pueden confirmar fuera de orden de id, así que el proyector no debe usar sólo "último id leído"; marcar cada fila procesada o deduplicar por id.
- **Demo (PDF):** registrar viajes/movimientos en el modelo de escritura y mostrar la vista actualizada; mostrar la consulta de historial sin JOINs.

### Tema 3 · Idempotencia y deduplicación
- **Pregunta guía:** ¿cómo permitir reintentos sin cobrar, registrar o procesar dos veces?
- **Tres niveles en el sistema:**
  1. **HTTP:** middleware `Idempotency-Key` sobre `claves_idempotencia` (ya existe, sin usar): `(actor_id, ambito, clave)` único + `request_sha256`. Primera vez: `INSERT ... ON CONFLICT DO NOTHING` con estado `procesando`, ejecutar y guardar status y cuerpo. Repetida y completada: devolver la respuesta guardada sin ejecutar nada. Repetida en curso: 409. Misma clave con otro cuerpo: 422. Aplicar en `POST /viajes`, aceptar oferta, finalizar/cobrar y carga demo. El enunciado lo exige en "todas las operaciones que crean, cobran o disparan un efecto externo".
  2. **Entre servicios:** `cobrar` usa `viajeId` como clave natural (`ux_un_consumo_por_viaje`); un reintento devuelve el resultado del primer cobro.
  3. **Eventos:** webhook deduplicado por `proveedor_evento_id` (hecho); proyector deduplicado por id de evento.
- **Demo (PDF):** repetir una solicitud con la misma `Idempotency-Key` y demostrar una única operación persistida. Es también el test obligatorio del bloque 6.

### Entregables de los temas de Fernández
- `docs/adr/008-...` (base de datos por servicio), `009-...` (CQRS con proyecciones), `010-...` (idempotencia HTTP). **Decidido: sólo Postgres** (outbox con polling + base `lectura` en Postgres), para no sumar dos tecnologías al Docker Compose y no perder eventos entre el COMMIT y la publicación. **RabbitMQ** y **MongoDB** (los de la demo de la exposición) son las opciones descartadas de los ADR 009/010; si algún día se cambian, se toca sólo el adaptador del bus y el de lectura. **A revisar:** el TP integrador pide RabbitMQ y Redis "o alternativa aprobada" (RNF-10/11); ver "Choques entre consignas" en el `CLAUDE.md` de la raíz.
- `docs/fernandez/` con un documento por tema (pregunta guía, cómo se aplica en el proyecto, demo con comandos) y `librerias.md`.
- **Librerías y frameworks a documentar:** Express 5 (HTTP, errores async), `pg` (SQL parametrizado, transacciones, `FOR UPDATE`), PostgreSQL 16 + PostGIS (relacional + búsqueda geográfica), Zod (validación `.strict()`), `jsonwebtoken` (JWT), `argon2` (hash Argon2id), Pino (logs JSON), helmet, cors, dotenv, `node:test`, Docker Compose. A sumar: limitador de tasa, autocannon o k6, ESLint y algo para tests HTTP de integración (p. ej. supertest).

## Estado actual

Funciona el flujo mínimo de punta a punta:

| Área | Endpoints | Estado |
|---|---|---|
| Salud | `GET /health`, `GET /ready` | Hecho (`/ready` no verifica migraciones) |
| Autenticación | `POST /auth/register` (pasajero/chofer), `POST /auth/login`, `GET /auth/me` | Hecho (sin refresh ni revocación) |
| Billetera | `POST /billetera/webhooks/cargas` (HMAC + dedupe), `GET /billetera/me` | Hecho |
| Viajes | `POST /viajes`, `GET /viajes/:viajeId` (sólo pasajero dueño) | Hecho |
| Ofertas | `POST /viajes/:viajeId/ofertas` (chofer más cercano a ≤5 km, oferta de 30 s), `POST /ofertas/:ofertaId/aceptar` | Hecho (sin vencimiento automático) |
| Chofer | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion`, `POST /choferes/viajes/:viajeId/estado`, `POST /choferes/viajes/:viajeId/finalizar` | Hecho |
| Admin | `PATCH /admin/choferes/:choferId/habilitacion` | Hecho |

Tests: 7 unitarios (billetera, roles, tarifa, JWT, HMAC), todos pasan. **No hay tests de integración, seguridad ni concurrencia.** ADR 001–007 existen; 004 y 005 siguen "propuesto" y todos tienen "Participantes: TODO".

## Lo que falta (por bloque del enunciado)

Prioridad: lo que pide el **control 3** de Puljiz (carrera con test concurrente + tarea pesada medida) y los temas de Fernández; después lo del TP1 de Fernández (OpenAPI, Dockerfile, trazabilidad). La web va al final.

### Bloque 1 — Proyecto y arranque
- [ ] `npm run lint` real (ESLint); hoy sólo hace `node --check` de dos archivos.
- [ ] README: sacar "Estado inicial / flujos pendientes", agregar tabla de roles con permisos, usuarios de prueba con credenciales (operador incluido) e índice de `docs/`.
- [ ] Probar la secuencia de clon limpio en otra máquina.

### Bloque 2 — Arquitectura hexagonal
- [ ] Puertos para viajes, choferes/ofertas y billetera, cada uno con **adaptador real y adaptador en memoria** (`src/infra/memoria/`). Hoy no existe ninguno en memoria.
- [ ] Sacar la lógica de cobro, aceptación y cambios de estado de los repositorios y pasarla a casos de uso que dependan de puertos.

### Bloque 3 — Configuración y ciclo de vida
- [ ] `/ready` tiene que verificar también que las migraciones estén aplicadas.
- [ ] Si el apagado supera `SHUTDOWN_TIMEOUT_MS`, loguear antes de `process.exit(1)` (`servidor.js`).
- [ ] Demo: SIGTERM durante un pedido lento y el pedido termina antes de salir.

### Bloque 4 — Errores y observabilidad
- [ ] Loguear los 4xx esperados con nivel menor que `error` en `errores.js`.

### Bloque 5 — Seguridad
- [ ] Reemplazar `z...parse()` por `safeParse` en `rutasChoferes.js` (hoy da 500 ante entrada inválida).
- [ ] Rate limiting con 429 y encabezados informativos (login, webhook, ubicación, endpoints costosos), con test.
- [ ] Tests: recurso ajeno → 403/404, prototype pollution (`__proto__` y `constructor.prototype` en distintas posiciones, sin lista negra), inyección SQL.
- [ ] `npm audit` sin altas ni críticas, o justificadas en el README.

### Bloque 6 y problema central (6.3) — Concurrencia e idempotencia
- [ ] Idempotencia HTTP (tema 3) con test.
- [ ] Test: 50 aceptaciones simultáneas sobre el mismo viaje, exactamente una gana y las demás reciben un rechazo claro.
- [ ] Cancelaciones (pasajero, chofer, operador con motivo) y test de cancelación simultánea a la aceptación, con los dos resultados posibles documentados.
- [ ] Test: un chofer con viaje activo no puede aceptar otro.
- [ ] Vencimiento de ofertas en el servidor (aunque el chofer cierre la app), pasar al siguiente candidato, `sin_choferes_disponibles` al agotar la lista.
- [ ] Evitar ofertas duplicadas para el mismo viaje y excluir choferes con oferta pendiente; evaluar `FOR UPDATE SKIP LOCKED`.
- [ ] Rechazo explícito de oferta por el chofer.
- [ ] ADR 004 completo: qué se bloquea, en qué orden, por qué no hay doble asignación ni interbloqueo.

### Variante D — Billetera
- [ ] Separación en base propia (tema 12) y proyección de saldos (tema 13).
- [ ] Test de la carrera: dos viajes del mismo pasajero cobran a la vez contra un saldo que alcanza para uno.
- [ ] Test que muestre por qué no se usa float para dinero.
- [ ] Salida de `pago_pendiente`: reintento de cobro o saldo de deuda tras una carga.
- [ ] Viaje con estimación 0: el `INSERT` del consumo viola `importe_centavos > 0`.
- [ ] Carga de saldo para la demo sin exponer el secreto HMAC (`POST /billetera/demo/cargas` deshabilitado en producción, o `npm run cargar-saldo`).

### 6.2, 6.4 y 6.5 — Alcance funcional
- [ ] Estimación previa sin crear el viaje (`POST /viajes/estimacion`) y tarifa final desde recorrido y duración reales con la misma función. Tests de tarifa con distancia cero y con máximo permitido.
- [ ] Asignación automática al crear el viaje (hoy el pasajero llama a mano a `/ofertas`).
- [ ] Tiempo real por SSE con `Last-Event-ID` (estado del viaje + posición del chofer). `EventSource` no permite el header `Authorization`: ticket corto de un solo uso, nunca el JWT en la URL.
- [ ] Test: la ubicación del chofer no se expone a quien no es su pasajero actual (ni la del pasajero a quien no es su chofer).
- [ ] Historiales (pasajero y chofer) y panel del operador: salen de las proyecciones del tema 13.
- [ ] Administración de tarifas, zonas y parámetros.
- [ ] Campo `nombre` en `usuarios` (migración nueva) y pedirlo en `POST /auth/register`. Hoy sólo hay email, y la proyección `historial_viajes` (tema 13) y las pantallas muestran nombre de pasajero y chofer.
- [ ] Usuario operador en el seed (el rol existe en el `CHECK` pero no hay ningún usuario) y endpoints del operador: `GET /operador/viajes?estado=activos`, cancelar con motivo, reintentar cobro de un `pago_pendiente`.
- [ ] La oferta le llega al chofer por SSE con origen, destino, polilínea de la ruta, distancia/tiempo hasta el retiro y tarifa estimada (la web la previsualiza en el mapa).
- [ ] Decidir si el radio de búsqueda (hoy fijo en 5 km) pasa a parámetros administrables o queda como constante.
- [ ] Política de retención/agregación de `historial_ubicaciones_chofer` (con 500 choferes son ~21 M filas/día).

### Bloque 7 y 6.6 — Tarea pesada
- [ ] Simulador de 500 choferes enviando ubicación cada 2 s durante varios minutos, mientras se asignan viajes.
- [ ] Versión ingenua y versión final (ADR 005: worker threads, cola u optimización de consultas). Medir p50/p95/p99 de solicitud de viaje, tiempo hasta asignación, req/s, lag del event loop con `monitorEventLoopDelay` (expuesto por el propio servidor), memoria; 3 corridas de ≥30 s cada una.
- [ ] Declarar el tiempo de asignación objetivo del grupo.

### Bloque 8 — Tests
- [ ] Tres niveles con un solo comando: `tests/dominio`, `tests/integracion` (Postgres real en Docker, estado conocido por test), `tests/seguridad` y `tests/concurrencia`.

### Documentación y proceso
- [ ] ADR: completar "Participantes" y fecha en todos, cerrar 004 y 005, escribir 008–010.
- [ ] `docs/mediciones.md`: hipótesis con número antes de medir, entorno, comando exacto, tabla ingenua vs final, conclusión.
- [ ] `docs/ataque.md`: bitácora (número, hipótesis, petición exacta, esperado, obtenido, veredicto, severidad, impacto) y respuesta del defensor (causa raíz, commit, test que falla antes y pasa después).
- [ ] `docs/api.md`: actualizar la tabla (la aceptación de oferta figura como TODO pero ya está), prefijo/versión de API y eventos SSE.
- [ ] `docs/modelo.md`: diagrama, transiciones de `pago_pendiente`, reglas de tarifa y radio, retención de ubicaciones, separación de bases.
- [ ] Git: commits de los tres a lo largo del cuatrimestre, PR con revisión real de otro integrante, tag `entrega-final`.

## Lo que falta para el TP integrador de Fernández

Además de lo de Puljiz. Códigos RF/RNF del Word. El alcance exacto de cada entrega lo fija el Acta de Alcance: esto es el máximo posible, no todo es obligatorio para TP1.

### TP1 · Contrato ejecutable
- [ ] **OpenAPI** versionado (`docs/openapi.yaml`) con parámetros, esquemas, validaciones, ejemplos, respuestas de éxito y error (`{ error: { codigo, requestId } }`) y esquema de seguridad Bearer; visualización local (p. ej. Swagger UI en `GET /docs`, deshabilitada en producción). Los esquemas Zod y el contrato no pueden divergir.
- [ ] Tests de integración que validen las respuestas contra el OpenAPI.
- [ ] Mocks/stubs de las dependencias de otros módulos hechos desde **sus** OpenAPI, con casos de éxito, error y demora. Encajan como adaptadores en memoria de los puertos (también cumplen el bloque 2 de Puljiz).
- [ ] **Dockerfile** del backend (multi-stage, usuario no root, `HEALTHCHECK` contra `/health`) y servicio `api` en `docker-compose.yml`. La secuencia de clon limpio de Puljiz tiene que seguir funcionando igual.
- [ ] Matriz de trazabilidad `docs/trazabilidad.md`: RF → operación OpenAPI → regla/archivo → test.
- [ ] Formateador (Prettier) y ESLint reales; CI en GitHub Actions con lint + tests en cada PR (RNF-17).
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
- **Mapas:** clave de servidor `GOOGLE_MAPS_SERVER_KEY` restringida a Routes, validada en `config/env.js`, nunca al cliente ni commiteada. **La tarifa se calcula siempre en el servidor**: el cliente manda sólo coordenadas; Routes API detrás de un puerto `calculadorRutas` con caída a Haversine (sirve también como servicio externo con timeout, RNF-13). La posición del chofer viene del navegador y puede falsificarse: validar rango, frecuencia y saltos imposibles (material para el ataque cruzado).

## Documentación de referencia

- `docs/guia-implementacion.md`: recorrido archivo por archivo del estado actual.
- `docs/modelo.md`, `docs/api.md`, `docs/adr/`, `docs/mediciones.md`, `docs/ataque.md`.
- `docs/diseno-web/`: diseño de la interfaz (lo usa `viajes-web/`).
- Enunciados: resumidos en el `CLAUDE.md` de la raíz.

## Notas

- Para levantar el backend en Windows primero hay que abrir Docker Desktop (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`); si no, `docker compose` falla con "failed to connect to the docker API".
- Los scripts de `docker-entrypoint-initdb.d` (necesarios para crear las bases `billetera` y `lectura`) sólo corren con el volumen vacío: después de agregarlos hace falta `docker compose down -v` una vez.
- Git, ramas, finales de línea y PowerShell: ver el `CLAUDE.md` de la raíz.
