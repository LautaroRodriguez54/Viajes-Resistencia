# Guía de implementación del proyecto (anexo)

Mapa del backend archivo por archivo, para estudiar la defensa con el código abierto al lado. Este documento cuenta **qué hace cada archivo**. El **porqué** de cada decisión está en otros lados:

- `modelo.md`: reglas del dominio (estados, tarifa, billetera, idempotencia).
- `adr/`: decisiones y alternativas descartadas (001 a 011).
- `openapi.yaml`: el contrato de cada endpoint.

Estado: `main` al 26/11/2026 (`8e48189`, con el #21 y el #22 ya fusionados).

## 1. Qué funciona hoy

```text
pasajero se registra            → el evento UsuarioRegistrado (outbox) le crea la billetera en su base
recibe una carga firmada (HMAC) → la billetera acredita una sola vez por eventoExternoId
chofer se registra              → el administrador lo habilita
chofer se declara disponible y reporta ubicación
pasajero solicita viaje         → se ofrece al chofer más cercano a ≤5 km (oferta de 30 s)
chofer acepta o rechaza       → si nadie responde, el servidor vence la oferta y busca otro
chofer marca "en camino" y "en curso"
finaliza                        → pago_pendiente → la billetera cobra → finalizado, o queda pago_pendiente
pasajero sin saldo              → carga y "reintentar cobro"
```

Los 11 endpoints que crean, cobran o cambian la tarifa exigen `Idempotency-Key` (ADR 010).

## 2. Arquitectura y recorrido de una petición

```text
HTTP / Express
  → contexto (requestId), seguridad, límite de tasa
  → autenticación Bearer → idempotencia (si el endpoint la usa)
  → ruta: rol + validación Zod .strict()
  → caso de uso (aplicacion/) o repositorio (ofertas, aceptación y estados todavía van directo)
  → puerto → adaptador Postgres o en memoria
  → respuesta / manejador de errores ({ error: { codigo, requestId } })
```

- El dominio no importa Express, `pg` ni librerías de infraestructura.
- `src/composicion.js` es el único lugar que conecta adaptadores, casos de uso, rutas y procesos de fondo.

### Tres bases, una por módulo (ADR 008 y 009)

| Base | Rol | Tablas | La usa |
|---|---|---|---|
| `viajes` | `viajes_app` | `usuarios`, `perfiles_chofer`, `viajes`, `ofertas_viaje`, `eventos_viaje`, `ubicaciones_actuales_chofer`, `historial_ubicaciones_chofer`, `parametros_tarifa`, `claves_idempotencia`, `outbox_viajes` (con `ViajeCambiado` del trigger de la `006`) | Viajes, usuarios, choferes, idempotencia |
| `billetera` | `billetera_app` | `billeteras`, `movimientos_billetera`, `eventos_webhook_pago`, `eventos_consumidos`, `outbox_billetera` | Billetera |
| `lectura` | `lectura_app` | `saldos`, `eventos_aplicados`, `historial_viajes` | Proyectores de saldos e historial; `GET /billetera/me` y `GET /viajes` |

Ninguna base consulta a otra. Se comunican por:
- el puerto `billetera.cobrar` (síncrono, dentro del proceso);
- los outbox, que entrega `despachadorOutbox.js`.

## 3. Arranque y archivos raíz

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Node 22, dependencias y comandos: `dev`, `start`, `test`, `lint`, `migrate`, `seed`, `setup`, `setup:test`, `cargar-saldo`, `demo:propiedad-datos`, `proyecciones:reconstruir`. |
| `.env.example` | Toda la configuración sin secretos reales: una URL por base, `ADMIN_DATABASE_URL` para las migraciones, TTL de idempotencia, de ofertas y de ubicación, y límites de tasa. |
| `docker-compose.yml` | PostgreSQL 16 + PostGIS (puerto local 5433). Swagger UI aparte con `--profile docs` (puerto 8080). |
| `src/servidor.js` | Arranca Express y los procesos de fondo; apagado ordenado ante `SIGTERM`/`SIGINT` (detiene los procesos antes de cerrar los pools). |
| `src/composicion.js` | Un pool por base, repositorios, casos de uso, rutas, despachadores del outbox y vencimiento de ofertas. |
| `src/config/env.js` | Valida las variables con Zod: el proceso no arranca con configuración incompleta. |

## 4. Dominio

| Archivo | Qué representa |
|---|---|
| `src/dominio/errores.js` | `ErrorDeDominio`: un código estable que la capa HTTP traduce a status. |
| `src/dominio/usuarios/roles.js` | Los cuatro roles: pasajero, chofer, operador y administrador. |
| `src/dominio/billetera/dinero.js` | `validarCentavos`: sólo enteros seguros y ≥ 0. Nunca punto flotante. |
| `src/dominio/billetera/billetera.js` | `calcularSaldo` (suma de movimientos, no hay saldo guardado) y `decidirCobro` (nunca parcial; importe 0 sin movimiento). |
| `src/dominio/viajes/estadosViaje.js` | Estados del viaje, incluidos `pago_pendiente` y `sin_choferes_disponibles`. |
| `src/dominio/viajes/tarifa.js` | Distancia Haversine y estimación desde los parámetros de tarifa. |
| `src/dominio/puertos/*.js` | Contratos: `repositorioBilletera` (cargar, saldo, cobrar), `unidadDeTrabajoCobro`, `repositorioUsuarios`, `verificadorWebhook`. |

## 5. Autenticación y usuarios

1. `POST /auth/register` recibe email, contraseña, rol y, si es chofer, el vehículo.
2. La contraseña se hashea con Argon2id.
3. En una transacción se inserta el usuario y, según el rol:
   - un chofer recibe su perfil, sin habilitar;
   - un pasajero genera el evento `UsuarioRegistrado` en `outbox_viajes`, y la billetera se crea al consumirlo (ADR 008).
4. `POST /auth/login` verifica el hash y emite un JWT HS256.
5. El middleware Bearer valida el JWT en las rutas protegidas.

| Archivo | Responsabilidad |
|---|---|
| `src/infra/autenticacion/contrasenasArgon2.js` | Hashear y verificar con Argon2id, con costos configurables. |
| `src/infra/autenticacion/tokensJwt.js` | Emite y valida el JWT (`sub` = id de usuario, rol). |
| `src/aplicacion/autenticacion/registrarUsuario.js` | Limita el registro público a pasajero o chofer y devuelve el token inicial. |
| `src/aplicacion/autenticacion/iniciarSesion.js` | Login; nunca expone el hash. |
| `src/infra/db/repositorioUsuariosPostgres.js` | SQL de usuarios; perfil del chofer y evento `UsuarioRegistrado` en la misma transacción. |
| `src/infra/http/autenticacion.js` | `requiereAutenticacion`: deja `req.autenticacion = { usuarioId, rol }`. |
| `src/infra/http/rutasAutenticacion.js` | `/auth/register`, `/auth/login` y `/auth/me`. |

## 6. Billetera (base propia)

Garantías:
- El webhook trae el cuerpo firmado con HMAC-SHA256. Si la firma no coincide, se rechaza antes de tocar nada.
- `eventoExternoId` es único: un webhook repetido acredita una sola vez.
- Los movimientos son inmutables (trigger). El saldo es la suma de los movimientos.
- `cobrar` bloquea la billetera (`FOR UPDATE`), decide con `decidirCobro` y es idempotente por `viajeId` (`ux_un_consumo_por_viaje`).
- Cada carga y cada cobro dejan un evento en `outbox_billetera` para la proyección.

| Archivo | Responsabilidad |
|---|---|
| `src/infra/externos/verificadorWebhookHmac.js` | Calcula el HMAC y compara con `timingSafeEqual`. |
| `src/infra/externos/cargaDemoWebhook.js` | La contraparte: firma una carga para el script de demo. |
| `src/aplicacion/billetera/procesarCargaWebhook.js` | Verifica la firma y delega la carga. |
| `src/infra/db/repositorioBilleterasPostgres.js` | Carga con dedupe, `cobrar`, creación por evento (con dedupe en `eventos_consumidos`) y `listarMovimientosPorPasajero`. Usa su propio pool. |
| `src/infra/db/proyectorSaldosPostgres.js` | Aplica los eventos a `saldos` en `lectura`, con dedupe en `eventos_aplicados`. |
| `src/infra/db/proyectorHistorialPostgres.js` | Aplica los `ViajeCambiado` a `historial_viajes` sólo si traen una versión más nueva; `listarPorPasajero` para `GET /viajes`. |
| `src/infra/db/migraciones/006-outbox-viaje-cambiado.sql` | Triggers sobre `viajes`: la versión sube siempre y cada cambio deja la foto de la fila en `outbox_viajes`. |
| `src/infra/http/rutasBilletera.js` | `POST /billetera/webhooks/cargas`, `GET /billetera/me` (lee la proyección) y `GET /billetera/me/movimientos` (lee la base `billetera`). |
| `scripts/cargarSaldo.js` | `npm run cargar-saldo`: carga de demo por el webhook real. |
| `scripts/reconstruirProyecciones.js` | `npm run proyecciones:reconstruir`: vacía `saldos` e `historial_viajes` y los rearma desde los dos outbox. |
| `scripts/demoPropiedadDatos.js` | `npm run demo:propiedad-datos`: Viajes recibe `permission denied` sobre `billetera`. |

El body parser de `src/infra/http/app.js` guarda `req.cuerpoCrudo`: volver a serializar el JSON puede cambiar los bytes y romper una firma válida.

## 7. Viajes, ubicación y ofertas

**Solicitud.** `POST /viajes` exige un pasajero, valida las coordenadas, toma los parámetros de tarifa activos y crea el viaje en `solicitado` con su estimación.

**Chofer y PostGIS.** Con `PUT /choferes/me/disponibilidad` y `PUT /choferes/me/ubicacion`, la posición actual va a `ubicaciones_actuales_chofer` (índice GiST) con una sola sentencia sin `FOR UPDATE`, y el historial lo junta `recolectorHistorialUbicaciones.js` y lo inserta por lotes con `unnest` (ADR 005, bloque 7). Con `UBICACION_TTL_SEGUNDOS`, un chofer que no reporta hace rato deja de ser candidato.

**Oferta.** `POST /viajes/:viajeId/ofertas` busca con `ST_DWithin` el chofer habilitado, disponible y sin viaje activo más cercano a ≤5 km, con `FOR UPDATE OF p SKIP LOCKED`. Después de bloquearlo **revalida** que siga elegible con una sentencia nueva: en READ COMMITTED, la primera vio una foto anterior al bloqueo. Por último crea una oferta de 30 s (configurable con `OFERTA_TTL_SEGUNDOS`).

**Aceptación.** `POST /ofertas/:ofertaId/aceptar` bloquea el viaje, sus ofertas (por id) y el perfil del chofer, en ese orden. Asigna el viaje y deja al chofer no disponible. Los índices `ux_una_oferta_aceptada_por_viaje` y `ux_chofer_un_viaje_activo` frenan cualquier doble asignación.

**Rechazo y vencimiento.**
- `POST /ofertas/:ofertaId/rechazar` marca la oferta `rechazada` y ofrece el viaje al siguiente candidato.
- `despachadorVencimientoOfertas.js` corre cada `OFERTA_VERIFICACION_MS` y marca `vencida` cada oferta que pasó su `vence_at`, también con el orden viaje → ofertas → chofer.
- Si no queda ningún candidato, el viaje pasa a `sin_choferes_disponibles`.

**Lecturas del chofer.** `GET /choferes/me/ofertas` y `GET /choferes/me/viaje-actual`, para la web, que consulta cada 2 s (ADR 011).

**Cancelación.** `cancelarViaje.js` con las reglas por rol de `decidirCancelacion`: pasajero, chofer (en `asignado` o `chofer_en_camino`) y operador (con motivo obligatorio). Bloquea viaje → ofertas → chofer, como la aceptación.

**Administración.** `GET /admin/choferes` lista los pendientes de habilitar. `POST /admin/tarifa` crea una tarifa nueva activa con `LOCK TABLE ... IN EXCLUSIVE MODE` (dos administradores a la vez quedan en fila). `GET /admin/metricas` expone el lag del event loop y la memoria.

| Archivo | Responsabilidad |
|---|---|
| `src/aplicacion/viajes/solicitarViaje.js` | Caso de uso de la solicitud: tarifa y viaje. |
| `src/infra/db/repositorioViajesPostgres.js` | SQL de viajes, búsqueda geográfica, ofertas, aceptación, rechazo y vencimiento, estados, lecturas del chofer, y la parte de cobro de viajes (`crearCobroViajesPostgres`). |
| `src/infra/db/repositorioChoferesPostgres.js` | Disponibilidad, habilitación, ubicación (CTE sin bloqueo) y listado para el administrador. |
| `src/infra/db/recolectorHistorialUbicaciones.js` | Historial de ubicaciones por lotes (`unnest`), con los volcados en fila y drenado al apagar. |
| `src/infra/db/repositorioTarifasPostgres.js` | Tarifa activa y su reemplazo por una fila nueva. |
| `src/infra/db/resumenOperativoPostgres.js` | Conteos del panel del admin (viajes activos, choferes disponibles, pagos pendientes). |
| `src/infra/observabilidad/metricasProceso.js` | `monitorEventLoopDelay` y memoria para `GET /admin/metricas`. |
| `src/infra/http/rutasViajes.js` | Solicitar, consultar el viaje propio, ofrecer y reintentar el cobro. |
| `src/infra/http/rutasOfertas.js` | Aceptar y rechazar. |
| `src/infra/http/rutasChoferes.js` | Disponibilidad, ubicación, lecturas, estado y finalización. |
| `src/infra/http/rutasAdministracion.js` | Choferes por habilitar, habilitación, tarifa y métricas. |
| `src/infra/http/rutasOperador.js` | Viajes activos, cancelar con motivo y reintentar un cobro. |

## 8. Finalización y cobro (dos pasos, ADR 008)

```text
asignado → chofer_en_camino → en_curso → pago_pendiente → finalizado
                                              ↑ (sin saldo, sin billetera o falla: se queda acá)
```

1. `finalizarViajeYCobrar` pasa el viaje de `en_curso` a `pago_pendiente` y registra `cobro_solicitado`. Desde ese momento la deuda queda asentada.
2. `cobrarViajePendiente`:
   - bloquea el viaje en la base `viajes`;
   - con el viaje bloqueado, llama a `billetera.cobrar` en la otra base;
   - si se cobró, registra `cobro_confirmado` y deja el viaje `finalizado`; si no, registra `cobro_pendiente` con el motivo.
3. `reintentarCobro` (`POST /viajes/:viajeId/reintentar-cobro`, sólo el pasajero dueño) repite el paso 2 en modo estricto: si el saldo no alcanza, responde `SALDO_INSUFICIENTE`.

| Archivo | Responsabilidad |
|---|---|
| `src/aplicacion/viajes/finalizarViajeYCobrar.js` | Paso 1 + paso 2. |
| `src/aplicacion/viajes/cobrarViajePendiente.js` | Paso 2, compartido. |
| `src/aplicacion/viajes/reintentarCobro.js` | Reintento del pasajero. |
| `src/infra/db/unidadDeTrabajoCobroPostgres.js` | `BEGIN` / `COMMIT` / `ROLLBACK` sobre la base `viajes`. |
| `src/infra/memoria/*.js` | Gemelos en memoria: candados (hacen de `FOR UPDATE`), billetera, viajes, unidad de trabajo e idempotencia. |

La carrera de la variante D, dos viajes contra un saldo que alcanza para uno, se resuelve en la base `billetera` con el `FOR UPDATE` de la billetera. La prueban un test con Postgres y otro en memoria.

## 9. Persistencia, migraciones y procesos de fondo

| Archivo | Responsabilidad |
|---|---|
| `src/infra/db/postgres.js` | Crea los pools y verifica la conexión (`/ready` chequea las tres bases). |
| `src/infra/db/migrate.js` | Crea los roles y las bases si faltan, aplica las migraciones de cada base con el superusuario y le da al rol de cada módulo sólo permisos de lectura y escritura de filas (DML). `--pruebas` prepara las bases `_test`. |
| `src/infra/db/seed.js` | Tarifa de desarrollo y los 4 usuarios de demo (pasajero, chofer habilitado, operador y administrador). |
| `migraciones/001_inicial.sql` | Esquema inicial, índices únicos parciales, `claves_idempotencia`. |
| `migraciones/002-parametros-tarifa-y-viajes.sql` | Velocidad promedio en la tarifa. |
| `migraciones/003-ofertas-unicidad-pendiente.sql` | `ux_oferta_pendiente_viaje_chofer`: una sola oferta pendiente por chofer y viaje. |
| `migraciones/004-billetera-fuera-de-viajes.sql` | Borra las tablas de billetera de `viajes` y crea `outbox_viajes`. |
| `migraciones/005-viajes-cancelacion.sql` | Estado `cancelado_operador` y columnas de la cancelación. |
| `migraciones/006-outbox-viaje-cambiado.sql` | Trigger que deja `ViajeCambiado` en `outbox_viajes` en cada cambio de `viajes` (ADR 009). |
| `migraciones/007-viajes-nombres-de-lugares.sql` | `origen_nombre` y `destino_nombre` (opcionales) y la foto del viaje con el nombre. |
| `migraciones-billetera/001-billetera.sql` | Base `billetera`. |
| `migraciones-lectura/001-lectura.sql` | Base `lectura`. |
| `migraciones-lectura/003-historial-nombres-de-lugares.sql` | Los nombres en `historial_viajes`. |
| `src/infra/db/despachadorOutbox.js` | Toma eventos con `FOR UPDATE SKIP LOCKED`, los entrega y los marca. |
| `src/infra/db/despachadorVencimientoOfertas.js` | Vence ofertas y vuelve a ofrecer. |
| `src/infra/db/repositorioIdempotenciaPostgres.js` | `reservar`, `completar` y `liberar` sobre `claves_idempotencia`. |

## 10. HTTP transversal

| Archivo | Responsabilidad |
|---|---|
| `src/infra/http/app.js` | Express, JSON (con el cuerpo crudo), contexto, seguridad, `/health` y `/ready`, y las rutas. |
| `src/infra/http/contexto.js` | `AsyncLocalStorage` con el `requestId`; loguea cada pedido. |
| `src/infra/http/cabecerasSeguridad.js` | Helmet con CSP estricta. |
| `src/infra/http/limitadorTasa.js` | 429 con `RateLimit-*` en login, webhook y ubicación. |
| `src/infra/http/idempotencia.js` | Middleware `Idempotency-Key` (ADR 010). |
| `src/infra/http/errores.js` | `STATUS_POR_CODIGO`: código → status. Sin stack traces; 4xx con `warn`, 5xx con `error`. |

## 11. Tests

`npm test` corre todo. Con `DATABASE_URL` apuntando a `viajes_test` corren también los que usan base (antes, `npm run setup:test`). Son 266.

| Carpeta | Qué prueba |
|---|---|
| `tests/dominio` | Saldo derivado, por qué no float, `decidirCobro`, roles, tarifa. |
| `tests/aplicacion` | Cobro sin Postgres: orden de bloqueo, caída entre bases, carrera de la variante D, dobles simultáneos. |
| `tests/infra` | JWT, HMAC, carga de demo, idempotencia (middleware), cabeceras, SQL de ofertas con un pool simulado. |
| `tests/integracion` | Con Postgres real: repositorios, idempotencia HTTP (10 pedidos simultáneos → 1 viaje), outbox, proyección, propiedad de datos, vencimiento y rechazo, ubicaciones por lotes, administración (5 cambios de tarifa a la vez → 1 activa). |
| `tests/concurrencia` | 50 aceptaciones simultáneas (gana una), SKIP LOCKED en ráfaga, carreras de vencimiento y rechazo, cancelación contra aceptación. |
| `tests/seguridad` | Autenticación, autorización por rol y recurso, validación, prototype pollution, inyección SQL, CORS, rate limiting. |

## 12. Pendiente

Está en `viajes-backend/CLAUDE.md`, sección "Lo que falta", que se mantiene al día. Lo más grande:
- Dockerfile, trazabilidad y validación contra el OpenAPI (TP1 de Fernández);
- SSE (hoy la web consulta cada 2 s, ADR 011);
- tarifa final con el recorrido real y estimación sin crear el viaje;
- historial del chofer.

## 13. Orden recomendado para estudiar

1. `src/composicion.js` y `src/infra/http/app.js`: cómo se arma todo.
2. Autenticación: ruta → caso de uso → repositorio → outbox `UsuarioRegistrado`.
3. Webhook de la billetera y `cobrar` (`repositorioBilleterasPostgres.js`).
4. El cobro en `aplicacion/viajes/` y su test en memoria (`tests/aplicacion/cobroDeViajes.test.js`).
5. Despacho y aceptación: `aplicacion/viajes/ofrecerAlChoferCercano.js` y `aceptarOferta.js`, con su SQL en `repositorioViajesPostgres.js` (`unidadDeTrabajoViajes`).
6. `idempotencia.js` y el ADR 010.
7. Las migraciones y los índices únicos parciales.
8. Los ADR 004, 005, 007, 008, 009 y 011 antes de explicar concurrencia, ubicaciones y carga, geolocalización, bases separadas y la web.
