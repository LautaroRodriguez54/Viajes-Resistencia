# CLAUDE.md

Plataforma de viajes estilo Uber para Resistencia (Chaco): pasajeros piden viajes, choferes los aceptan y el cobro se hace con una billetera. TP final de **Programación IV, Comisión "plataforma de viajes", grupo 4, variante D: billetera y pagos**. Integrantes: Escobar Lucas, Valussi Agustín, Rodríguez Lautaro (3 integrantes: sin reducción ni requisito extra). Todo el código, la documentación y los identificadores están en español.

## Las dos entregas

El mismo backend se presenta a dos docentes. Antes de trabajar en algo, saber a cuál de las dos sirve.

| | **Puljiz: enunciado del TP** | **Fernández: 3 temas de arquitectura** |
|---|---|---|
| Fuente | `TP FINAL - Requisitos y estructura.docx` (sólo lo de nuestro grupo; v1.0 del 23/09/2026) | `TP FINAL - FERNANDEZ.pdf` (tabla de 20 temas) |
| Qué se entrega | Backend completo: 8 bloques comunes + plataforma de viajes + variante D, ADR, mediciones, ataque cruzado, defensa oral | 3 temas elegidos, documentados (pregunta guía + demo) + librerías/frameworks usados |
| Temas elegidos | — | **12. Base de datos por servicio**, **13. CQRS**, **Idempotencia y deduplicación** |
| Material previo | — | `exposicion fernadez - lectura escritura.pdf` (temas 12 y 13, ya expuestos; ahí figuramos como "Grupo 6") |

Los enunciados y la exposición **no están en el repo**: todo lo que se exige de ellos está resumido en este archivo.

Los 3 temas se implementan **dentro** de este backend y se documentan como ADR 008–010, así cuentan para las dos entregas. Ver "Temas de Fernández".

El enunciado dice que el frontend **es opcional y no suma nota** y que "empezar por el frontend" es un error frecuente. La web (`viajes-web/`) queda al final de este archivo y va después de lo obligatorio.

### Reglas del enunciado que no se negocian (desaprueban sin compensación)
- La secuencia de clon limpio falla: `cp .env.example .env` → `docker compose up` → `npm run setup` → `npm test` → servidor + colección de requests.
- Secretos reales en el repo o en su historial.
- Un integrante no puede explicar código que figura a su nombre en Git.
- Falta por completo alguno de los 8 bloques comunes (además, un bloque ausente limita la nota a 5).
- No se hizo la fase de ataque cruzado, o se rompieron sus reglas (sin DoS por volumen, sólo el entorno publicado, sin ingeniería social).

### Cronograma (semanas desde el 23/09/2026; fechas oficiales en el aula virtual)
| Control | Semana | Aprox. | Qué se muestra |
|---|---|---|---|
| 3. Problema difícil | 8 | 11–17/11 | Carrera principal resuelta con test concurrente; tarea pesada en sus dos versiones con primera medición |
| 4. Congelamiento | 10 | 25/11–1/12 | Sistema desplegado y congelado; usuarios de prueba y doc de la API para el grupo atacante |
| 5. Ataque cruzado | 11 | 2–8/12 | Bitácora del atacante entregada |
| 6. Entrega final | 12 | 9–15/12 | Correcciones con tests, mediciones completas, todos los ADR, tag `entrega-final` |
| 7. Defensa oral | 13 | 16–22/12 | Individual, 40 % de la nota, requiere 6 por sí sola |

Nota: grupal 40 % (problema central 30, seguridad 20, concurrencia 20, arquitectura 15, tests/docs 15) + artefactos 20 % (ADR 30, mediciones 30, ataque 30, Git 10) + defensa 40 %.

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

### Entregables de Fernández
- `docs/adr/008-...` (base de datos por servicio), `009-...` (CQRS con proyecciones), `010-...` (idempotencia HTTP). **Decidido: sólo Postgres** (outbox con polling + base `lectura` en Postgres), para no sumar dos tecnologías al Docker Compose y no perder eventos entre el COMMIT y la publicación. **RabbitMQ** y **MongoDB** (los de la demo de la exposición) son las opciones descartadas de los ADR 009/010; si algún día se cambian, se toca sólo el adaptador del bus y el de lectura.
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

Prioridad: lo que pide el **control 3** (carrera con test concurrente + tarea pesada medida) y los temas de Fernández. La web va al final.

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

## Interfaz web (`viajes-web/`, opcional)

No suma nota para el enunciado. Hacerla sólo con lo obligatorio encaminado.

- **Objetivo:** web **básica** que sirva para explicar el backend en la defensa: cuanto menos tenga, mejor, pero funcional y prolija. Mapa centrado en Resistencia (aprox. `-27.451, -58.986`). Se descartó un primer diseño muy parecido a Uber (barra negra, paneles, estadísticas).
- **Diseño acordado (3/11/2026):** lienzo con las 7 pantallas y, al lado de cada una, una nota con los endpoints HECHO / FALTA: https://claude.ai/artifact/V4dJiPEoog8HZrJ3F9zJ6W (privado de Agustín; compartir desde Share). **Guía para respetarlo al implementar: `docs/diseno-web/README.md`** (principios, colores y medidas, detalle de cada pantalla) junto con el código de cada pantalla en la misma carpeta.
  - **Estilo:** fondo claro `#F2F0EB`, tarjetas blancas redondeadas, tipografía Outfit, un solo acento azul `#3346D3`. Verde, naranja y rojo sólo para estados (pagado, sin pagar/pago pendiente, cancelar). Una acción principal por pantalla.
  - **Ingresar:** email + contraseña, link a registro (pasajero o chofer).
  - **Pasajero · Pedir:** mapa Google a pantalla completa con la ruta; tarjeta flotante a la izquierda con Desde/Hasta (Places Autocomplete), distancia, tiempo, precio y "Pedir viaje"; saldo debajo.
  - **Pasajero · Mi viaje:** mismo mapa con el auto del chofer en vivo (patente + minutos); tarjeta con estado, vehículo, progreso de 4 pasos (Pedido, Asignado, En camino, En viaje), precio estimado y "Cancelar viaje".
  - **Pasajero · Billetera:** sin mapa. Saldo + "Cargar $ 100", aviso de viaje sin pagar ("no se cobró nada", el cobro nunca es parcial), "Mis viajes" (historial) y "Movimientos".
  - **Chofer:** mapa con la vista previa del viaje ofrecido (su posición, camino punteado al retiro, ruta y destino). Arriba, notificación tipo push con monto, recorrido, distancia al retiro y del viaje, cuenta regresiva de 30 s, Aceptar/Rechazar y el aviso "Otro chofer lo aceptó primero" (la carrera de la aceptación). Interruptor "Disponible" abajo a la izquierda.
  - **Operador:** lista de viajes activos con estado; cancelar con motivo obligatorio.
  - **Admin:** choferes por habilitar + tarifa (base, por km, por minuto, máximo; guardar crea una fila nueva activa).
  - Operador y admin **se quedan en la web** (decisión del grupo), aunque el enunciado no exija interfaz.
- **Stack:** React + Vite en JavaScript (puerto `5173`), `react-router`, cliente HTTP propio (`src/api/cliente.js`) que agrega el token y traduce `error.codigo` a mensajes. Mapa con **Google Maps** (decidido): `@vis.gl/react-google-maps`, Places Autocomplete en el navegador y Routes API desde el backend.
- **Pantallas en código:** Login/Registro; Pasajero (pedir viaje, mi viaje, billetera con historial); Chofer (disponible + ubicación cada 2 s con `watchPosition`, oferta con vista previa, viaje asignado); Operador; Admin.
- **Estado de `viajes-web/` (en `main` desde el 4/11/2026, PR #2 pasajero y PR #3 chofer/operador/admin): las 7 pantallas del diseño, sólo visuales, sin conexión al backend.** No tienen endpoints ni llamadas HTTP (decisión del grupo: primero lo visual, para entender y explicar). La carpeta está en la raíz del repo, al lado de `viajes-backend/` (no adentro), para no mezclar dependencias con lo que se entrega. Se corre con `cd ..\viajes-web` → `npm install` → `npm run dev` (en PowerShell 5.1 no existe `&&`; usar `;` o una línea por comando). "Entrar" acepta cualquier email y contraseña.
  - Hechas: `/ingresar` (1), `/registro` (campos según `POST /auth/register` + "Nombre", que falta en el backend), `/pasajero/pedir` (2), `/pasajero/viaje` (3), `/pasajero/billetera` (4), `/chofer` (5), `/operador` (6) y `/admin` (7). Para entrar a cada rol, el email tiene que empezar con `chofer`, `operador` o `admin` (cualquier otro entra como pasajero).
  - Chofer: la cuenta regresiva de 30 s corre en el navegador; "Aceptar" muestra el aviso de la carrera ("Otro chofer lo aceptó primero") y apagar y prender "Disponible" vuelve a traer la oferta. Operador: al tocar un viaje se despliega el motivo obligatorio y "Cancelar viaje". Admin: "Habilitar" saca al chofer de la lista y "Guardar tarifa nueva" no hace nada.
  - Siguiente paso: conectar al backend (cliente HTTP, reemplazar `src/datos/ejemplo.js` por las llamadas) y cambiar `MapaSimulado` por Google Maps; ver "Cambios de backend que la web necesita".
  - Datos fijos en `src/datos/ejemplo.js`, con la forma de la respuesta de cada endpoint (anotado arriba de cada uno); al conectar, se reemplaza cada constante por la llamada. Cada página dice en un comentario qué endpoints usa.
  - Tokens del diseño como variables CSS en `src/estilos.css`. Dinero en centavos, formateado sólo al mostrar (`src/formato.js`).
  - El mapa es el dibujo del diseño (`componentes/MapaSimulado.jsx`, con modo `chofer` para Mi viaje); se reemplaza por Google Maps al conectar.
  - Mi viaje deriva el chip, el título y el paso del progreso de `estado` (`solicitado`, `asignado`, `chofer_en_camino`, `en_curso`). Para eso `GET /viajes/:viajeId` tiene que devolver además vehículo, patente y minutos hasta el retiro.
- **Cambios de backend que la web necesita** (casi todos ya están en "Lo que falta"): `http://localhost:5173` en `CORS_ORIGINS`; `POST /viajes/estimacion`; `mapearViaje` devolviendo `origen`/`destino` (`ST_Y`/`ST_X`); asignación automática; `GET /choferes/me/ofertas` + rechazar; SSE con ticket; evento `ubicacion_chofer` sólo por SSE (no en `eventos_viaje`); `GET /viajes`, `GET /choferes/me/viaje-actual`, `GET /billetera/me/movimientos`, `GET /operador/viajes?estado=activos`, `GET /admin/choferes`; carga demo; token de 15 min sin refresh (alargar `JWT_ACCESS_TOKEN_TTL` para la demo o implementar refresh).
- **Mapas y seguridad:** dos claves de Google (navegador restringida por referrer a Maps JS y Places; servidor `GOOGLE_MAPS_SERVER_KEY` restringida a Routes, validada en `config/env.js`, nunca al cliente), ninguna commiteada. **La tarifa se calcula siempre en el servidor**: el cliente manda sólo coordenadas; Routes API detrás de un puerto `calculadorRutas` con caída a Haversine. La posición del chofer viene del navegador y puede falsificarse: validar rango, frecuencia y saltos imposibles (material para el ataque cruzado).

## Documentación de referencia

- `docs/guia-implementacion.md`: recorrido archivo por archivo del estado actual.
- `docs/modelo.md`, `docs/api.md`, `docs/adr/`, `docs/mediciones.md`, `docs/ataque.md`.
- Enunciados (fuera del repo): `TP FINAL - Requisitos y estructura.docx` (Puljiz), `TP FINAL - FERNANDEZ.pdf` y `exposicion fernadez - lectura escritura.pdf` (Fernández).

## Notas

- Para levantar el backend en Windows primero hay que abrir Docker Desktop (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`); si no, `docker compose` falla con "failed to connect to the docker API".
- Repo oficial: https://github.com/LautaroRodriguez54/Viajes-Resistencia (rama `main`; el backend está en `viajes-backend/`). Clon local en `C:\Users\Agustin\Escritorio\Viajes-Resistencia`. Trabajar en ramas e integrar por pull request con revisión de otro integrante (lo exige el enunciado).
- `core.autocrlf=true`: los archivos quedan con CRLF en el disco y LF en el repo. No mezclar finales de línea en un mismo archivo.
- Los scripts de `docker-entrypoint-initdb.d` (necesarios para crear las bases `billetera` y `lectura`) sólo corren con el volumen vacío: después de agregarlos hace falta `docker compose down -v` una vez.
- Commits sólo con el nombre del usuario, sin `Co-Authored-By` de Claude.
- **Un solo repositorio Git, en la raíz `Viajes-Resistencia/`.** No hacer `git init` dentro de `viajes-backend/` ni de `viajes-web/`: el 4/11/2026 apareció un `.git` anidado en `viajes-backend/` que tapaba al repo real (commits sin `viajes-web/` y `git push` con "No configured push destination"); se eliminó. Si vuelve a pasar, `git rev-parse --show-toplevel` tiene que dar `.../Viajes-Resistencia`.
- `.gitignore` en la raíz (`node_modules/`, `dist/`, `coverage/`, `.env`) además de los de cada proyecto, para que `node_modules` quede ignorado en cualquier rama. Si una rama vieja no lo tiene y aparecen cientos de archivos de `viajes-web/node_modules` sin seguimiento, **no hacerles `git add`**: alcanza con `git pull` en `main` (o `viajes-web/node_modules/` en `.git/info/exclude`, que es local).
- Flujo de ramas usado para la web: una rama por tanda de pantallas (`docs/diseno-web` → `feat/diseno-interfaz-pasajero` → `feat/diseno-interfaz-chofer-operador-admin`), cada una apilada sobre la anterior cuando reutiliza su código, y PR a `main`. Después de integrar los PR, `git pull` en `main` antes de seguir.
- La terminal del usuario es Windows PowerShell 5.1: dar los comandos una línea por vez o separados con `;` (no existe `&&`).
