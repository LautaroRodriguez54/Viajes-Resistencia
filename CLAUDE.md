# CLAUDE.md

Plataforma de viajes estilo Uber para Resistencia (Chaco): pasajeros piden viajes, choferes los aceptan y el cobro se hace con una billetera. Integrantes: Escobar Lucas, Valussi Agustín, Rodríguez Lautaro. Todo el código, la documentación y los identificadores están en español.

Este archivo cubre lo que es de **todo el repo**: qué pide cada docente, cómo se fusiona para la entrega final, cronograma y Git. El detalle técnico está en:

- `viajes-backend/CLAUDE.md`: stack, arquitectura, convenciones, temas de Fernández en código y pendientes del backend.
- `viajes-web/CLAUDE.md`: interfaz web (diseño acordado, stack, estado y decisiones). Lo que el Word le pide a la interfaz está en `viajes-web/README.md`.

## Las consignas

El mismo producto (un solo repo, un solo backend, una sola web) se presenta a dos docentes que piden cosas distintas. **Para la entrega final hay que cumplir la unión de todo**: ninguna consigna reemplaza a la otra. Antes de trabajar en algo, saber a cuál sirve; si sirve a las dos, mejor.

| | **Puljiz: enunciado del TP** | **Fernández: temas de arquitectura** | **Fernández: TP integrador** |
|---|---|---|---|
| Fuente | `TP FINAL - Requisitos y estructura.docx` (v1.0 del 23/09/2026; fuera del repo) | `TP FINAL - FERNANDEZ.pdf` (tabla de 20 temas) y `exposicion fernadez - lectura escritura.pdf` (fuera del repo) | `CONSIGNA FERNANDEZ.docx` en la raíz (versión preliminar 1.0; **sin commitear**) |
| Qué pide | Backend completo: 8 bloques comunes + plataforma de viajes + variante D (billetera y pagos), ADR, mediciones, ataque cruzado, defensa oral | 3 temas documentados (pregunta guía + demo) + librerías/frameworks usados | Plataforma distribuida de movilidad en 9 módulos (M1–M9); cada grupo implementa uno en profundidad y se integra con otros grupos en 3 entregas (TP1, TP2, TP3) |
| Nuestra parte | Grupo 4, variante D, 3 integrantes (sin reducción ni requisito extra) | **12. Base de datos por servicio**, **13. CQRS**, **Idempotencia y deduplicación** (temas 12 y 13 ya expuestos como "Grupo 6") | Módulo asignado: **a confirmar en el Acta de Alcance**. Por la variante D lo natural es **M7 Tarifas, Pagos y Liquidaciones** |
| Frontend | Opcional, no suma nota; "empezar por el frontend" es un error frecuente | — | **Obligatorio en TP3**: cliente web responsivo para los recorridos críticos |

Los 3 temas de Fernández se implementan **dentro** del backend y se documentan como ADR 008–010, así cuentan para Puljiz y para el TP integrador (el tema 12 es justamente RNF-05 "propiedad de datos").

### Reglas de Puljiz que no se negocian (desaprueban sin compensación)
- La secuencia de clon limpio falla: `cp .env.example .env` → `docker compose up` → `npm run setup` → `npm test` → servidor + colección de requests.
- Secretos reales en el repo o en su historial.
- Un integrante no puede explicar código que figura a su nombre en Git.
- Falta por completo alguno de los 8 bloques comunes (además, un bloque ausente limita la nota a 5).
- No se hizo la fase de ataque cruzado, o se rompieron sus reglas (sin DoS por volumen, sólo el entorno publicado, sin ingeniería social).

### Cronograma de Puljiz (semanas desde el 23/09/2026; fechas oficiales en el aula virtual)
| Control | Semana | Aprox. | Qué se muestra |
|---|---|---|---|
| 3. Problema difícil | 8 | 11–17/11 | Carrera principal resuelta con test concurrente; tarea pesada en sus dos versiones con primera medición |
| 4. Congelamiento | 10 | 25/11–1/12 | Sistema desplegado y congelado; usuarios de prueba y doc de la API para el grupo atacante |
| 5. Ataque cruzado | 11 | 2–8/12 | Bitácora del atacante entregada |
| 6. Entrega final | 12 | 9–15/12 | Correcciones con tests, mediciones completas, todos los ADR, tag `entrega-final` |
| 7. Defensa oral | 13 | 16–22/12 | Individual, 40 % de la nota, requiere 6 por sí sola |

**Actualización del 27/11/2026:** en `#54` se sumaron la suite E2E ampliada (6 casos en Playwright), la rampa k6 (`carga/estres-viajes.js`) y el envío de logs HTTP a Grafana Cloud vía Alloy (`observabilidad/`). Queda pendiente de definir con Puljiz y el equipo la fase de ataque cruzado (`viajes-backend/docs/ataque.md`). Para Puljiz alcanza con que la app sea funcional y cumpla los requisitos obligatorios; lo que falte se completa antes de su entrega.

Nota de Puljiz: grupal 40 % (problema central 30, seguridad 20, concurrencia 20, arquitectura 15, tests/docs 15) + artefactos 20 % (ADR 30, mediciones 30, ataque 30, Git 10) + defensa 40 %.

Fernández no fija fechas en el Word ("se establecerán en el cronograma"): pedirlas y anotarlas acá.

## TP integrador de Fernández (resumen del Word)

Las 3 entregas son incrementos del **mismo repo**: cada una conserva lo aprobado, incorpora las correcciones pedidas y tiene una release identificable. El alcance de cada una se fija en un **Acta de Alcance Incremental** (requerimientos, endpoints, eventos, reglas, dependencias, pruebas y evidencias) y se congela; los cambios posteriores se registran y justifican. Las mejoras propias se pueden proponer, pero las aprueba la cátedra y no pueden debilitar un requerimiento mínimo.

| Entrega | Objetivo | Evidencias que hay que mostrar |
|---|---|---|
| **TP1** · Contrato ejecutable y núcleo | Módulo propio funcionando en aislamiento; dependencias simuladas | Release TP1, README, backlog inicial; OpenAPI versionado con visualización interactiva local; Dockerfile, config de ejemplo, datos de prueba; reporte de tests unitarios e integración (las respuestas validadas contra OpenAPI); mocks/stubs de dependencias hechos desde sus OpenAPI (éxito, error y demora); **matriz de trazabilidad** requerimiento → operación OpenAPI → regla → prueba |
| **TP2** · Integración con otros grupos | Reemplazar los mocks por ≥3 módulos reales de otros grupos (imágenes versionadas o endpoints remotos) | Release TP2 e imagen con versión explícita en una registry; compose con el módulo y sus 3 integraciones; catálogo de dependencias, endpoints, eventos, colas y versiones; ≥1 integración síncrona y ≥1 asíncrona; tests de contrato consumidor/proveedor con respuestas inválidas, caída y demora; reintentos/idempotencia/vencimiento/concurrencia en ≥1 caso; logs con id de correlación siguiendo un recorrido distribuido; incidentes entre grupos registrados como **issues** |
| **TP3** · Plataforma completa y coloquio | Integrar M1–M9 del consorcio | Release final + manifiesto de versiones; compose completo, guía de operación, datos de prueba y procedimiento de recuperación; diagramas de componentes, despliegue, datos y secuencias de los 2 recorridos críticos; tests End-to-End automatizados sobre contenedores, concurrencia y seguridad; informe de integración; **cliente web responsivo**; presentación conjunta + coloquio individual |

Recorridos críticos de TP3: **viaje inmediato** (identidad → perfiles → disponibilidad → ubicación → solicitud → despacho → aceptación → viaje → tarifa → pago → notificación o comprobante) y **reserva** (creación para fecha futura → confirmación → recordatorio → activación en despacho → viaje → cierre o cancelación). Más una demo de concurrencia sin efectos duplicados (aceptación simultánea, activación duplicada de reserva o doble cobro) y una falla parcial controlada.

Rúbrica (sobre 100, igual estructura en las tres): funcionalidad 15/10/20, arquitectura 15/10/10, contratos 20/20/10, calidad 20/15/15, operación 10/15/10, seguridad y datos 5/10/10, trabajo en equipo 5/10/10, defensa 10/10/15 (TP1/TP2/TP3). Contratos y calidad son lo que más pesa en TP1 y TP2.

Prácticas mínimas comunes del Word: ramas + PR + versiones identificables; formateador y análisis estático; SOLID; API REST con OpenAPI, ejemplos, errores consistentes y esquema de seguridad; persistencia encapsulada por servicio **sin consultas cruzadas entre bases**; config por variables de entorno sin secretos; Dockerfile por servicio; versionado semántico de contratos e imágenes (no depender de `latest`); README con preparación, build, ejecución, pruebas, health checks, dependencias y problemas frecuentes; CI que corra build y tests (RNF-17). Uso de IA permitido, pero cada integrante tiene que poder defender lo incorporado (coincide con la regla de Puljiz).

### Módulos del Word y dónde están en nuestro código

Nosotros, por Puljiz, ya tenemos varios módulos en un mismo backend. Para Fernández sólo uno es "nuestro" y el resto lo aportan otros grupos del consorcio; lo que ya tenemos sirve de mock propio en TP1 y de alternativa si otro grupo no llega.

| Módulo | Qué es | En nuestro backend |
|---|---|---|
| M1 Identidad y Acceso | Credenciales, roles, revocación, OAuth/OIDC | `auth/*` (JWT propio, sin refresh ni revocación) |
| M2 Clientes | Perfil, direcciones, preferencias, historial, calificaciones | Sólo `usuarios` (sin nombre, sin perfil ni calificaciones) |
| M3 Conductores y Vehículos | Habilitación, vehículos auto/moto, documentación | Perfil de chofer + habilitación por admin desde su pantalla (sin tipos de vehículo ni documentos) |
| M4 Ubicación y Disponibilidad | Posición, cercanos, TTL de ubicación, ETA | `choferes/me/ubicacion` sin bloqueo e historial por lotes (ADR 005), PostGIS, TTL con `UBICACION_TTL_SEGUNDOS` (sin ETA) |
| M5 Solicitud y Despacho | Candidatos, ofertas con vencimiento, asignación única | Ofertas a ≤5 km con vencimiento a 30 s, rechazo y re-oferta al siguiente, aceptación única (sin asignación automática) |
| M6 Viajes y Ciclo de Vida | Estados, arribo, inicio con QR, cancelación, auditoría | Estados + `eventos_viaje`, cancelación de pasajero, chofer y operador con motivo (sin QR ni arribo) |
| **M7 Tarifas, Pagos y Liquidaciones** | Estimación, cobro, cargo de cancelación, reintegro, liquidación al conductor, idempotencia | **Billetera (variante D)**: tarifa (administrable), webhook de carga, cobro sin parcial, reintento |
| M8 Notificaciones, Documentos y Soporte | Avisos, QR, comprobante PDF, tickets, consumo desde cola | SSE previsto (no hecho) |
| M9 Reservas | Viajes a futuro, recordatorio, activación idempotente | No existe |

Si nos asignan M7: la separación de la billetera en su propia base (tema 12) es exactamente lo que la convierte en un servicio publicable como imagen propia. Si nos asignan otro, la tabla dice qué ya tenemos para reutilizar.

## Cómo se fusionan las consignas

### Coinciden (se hace una vez y cuenta para todos)
| Tema | Puljiz | Fernández |
|---|---|---|
| Asignación única ante aceptaciones concurrentes | Problema central 6.3, test de 50 aceptaciones | RF-5.6, RNF-08, demo de concurrencia TP3 |
| Cobro sin duplicados | Variante D, carrera de dos cobros | RF-7.6, RNF-08/09 |
| Idempotencia | Bloque 6 (`Idempotency-Key`) | Tema 3, RNF-09, RF-9.10 |
| Propiedad de datos | (bloque 2, hexagonal) | Tema 12, RNF-05, "sin consultas cruzadas" |
| Historial no destructivo | `eventos_viaje` | RF-6.8, RF-5.9, RF-7.7 |
| Vencimiento de ofertas | 6.2 / bloque 6 | RF-5.4, RF-5.8 |
| Cancelación con motivo | Cancelaciones de pasajero, chofer y operador | RF-5.7, RF-6.6, RF-6.7 |
| Health checks, logs JSON con `requestId` | Bloques 3 y 4 | RNF-14 (correlación por solicitud, viaje o reserva) |
| Sin secretos, config por entorno | Regla no negociable | RNF-06 |
| ADR | Artefacto (30 % de artefactos) | "Nota de arquitectura, ADR o equivalente" |
| Medición de rendimiento | Bloque 7: p50/p95/p99, 3 corridas | RNF-16: al menos una meta del recorrido crítico (usar la misma) |
| Git con PR revisados | Artefacto Git | Prácticas mínimas + trabajo en equipo |
| Uso de IA / defender lo propio | Defensa oral | "Uso responsable de IA" |

### Sólo los pide Fernández (hay que sumarlos)
- **OpenAPI** completo con Swagger UI o similar, y tests que validen las respuestas contra el contrato. `docs/api.md` pasa a ser un índice que apunta al OpenAPI.
- **Dockerfile** del backend (hoy el compose sólo levanta Postgres), imagen con versión semántica en una registry, compose completo.
- **Tests de contrato y End-to-End**, reporte de tests, **matriz de trazabilidad**.
- **CI** (GitHub Actions) con lint y tests en cada PR.
- **Backlog**, **Acta de alcance** por entrega, **releases** `tp1`, `tp2`, `tp3` (además de `entrega-final` de Puljiz), incidentes como **issues**.
- Dominio extra: tipos de vehículo auto/moto, reservas (M9), QR de inicio, calificaciones, cargo de cancelación, reintegro, liquidación al chofer, comprobante PDF, notificaciones, TTL de ubicación.
- Resiliencia: timeouts y reintentos limitados ante servicios externos (RNF-13), HTTPS publicado (RNF-12).
- **Web obligatoria** en TP3 (ver `viajes-web/CLAUDE.md` y `viajes-web/README.md`).

### Sólo los pide Puljiz (siguen siendo obligatorios)
- 8 bloques comunes, tarea pesada con simulador de 500 choferes y versión ingenua vs final, `docs/mediciones.md`, ataque cruzado con bitácora (`docs/ataque.md`), defensa oral individual, tag `entrega-final`, secuencia de clon limpio exacta.

### Choques entre consignas (decidir y registrar en un ADR)
| Choque | Puljiz / lo ya decidido | Fernández | Propuesta de fusión |
|---|---|---|---|
| Frontend | Opcional, no suma | Obligatorio en TP3 | Se hace, pero **después** de lo de Puljiz del control 3 y 4; la carrera y la billetera primero |
| Forma del sistema | Un backend nuestro con todo | 9 servicios de distintos grupos | Monolito modular con bases separadas (tema 12); nuestro módulo del Word se publica como imagen propia; lo demás queda como mock/alternativa |
| Mensajería | Decidido: sólo Postgres (outbox + polling), RabbitMQ descartado en ADR 009/010 | RNF-10: RabbitMQ **o alternativa aprobada** (TP2) | **A confirmar con Fernández**: pedir aprobación del outbox en Postgres, o mantener el outbox y sumar un publicador a RabbitMQ para hablar con otros grupos (el outbox sigue evitando perder eventos). Si se cambia, se toca sólo el adaptador del bus |
| Caché y TTL | PostGIS para ubicaciones | RNF-11: Redis o alternativa aprobada (TP2), RF-4.3 TTL de ubicación | **A confirmar**: TTL resuelto en Postgres (columna de marca temporal + filtro) o Redis para posición vigente |
| Identidad | JWT propio (ADR 003) | RF-1.4 validación por otros módulos, RF-1.6 OAuth/OIDC | Si M1 lo hace otro grupo, validar sus tokens detrás de un puerto; nuestro JWT queda para el modo aislado |
| Nombres | `pasajero`, `chofer` | "cliente", "conductor" | En el código seguimos con los nuestros; en el OpenAPI y la matriz de trazabilidad se aclara la equivalencia |
| Documentación de la API | `docs/api.md` | OpenAPI versionado | OpenAPI como fuente; `api.md` resume y enlaza |

## Git y repositorio

- Repo oficial: https://github.com/LautaroRodriguez54/Viajes-Resistencia (rama `main`). Clon local en `C:\Users\Agustin\Escritorio\Viajes-Resistencia`. Carpetas: `viajes-backend/` (lo que se entrega a Puljiz) y `viajes-web/` (al lado, no adentro, para no mezclar dependencias).
- Trabajar en ramas e integrar por pull request con revisión de otro integrante (lo exigen las dos consignas). Una rama por tanda de trabajo, apiladas cuando reutilizan código; después de integrar, `git pull` en `main` antes de seguir.
- Commits sólo con el nombre del usuario, sin `Co-Authored-By` de Claude.
- **Un solo repositorio Git, en la raíz.** No hacer `git init` dentro de `viajes-backend/` ni de `viajes-web/`: el 4/11/2026 apareció un `.git` anidado en `viajes-backend/` que tapaba al repo real; se eliminó. `git rev-parse --show-toplevel` tiene que dar `.../Viajes-Resistencia`.
- `.gitignore` en la raíz (`node_modules/`, `dist/`, `coverage/`, `.env`) además de los de cada proyecto. Si en una rama vieja aparecen cientos de archivos de `viajes-web/node_modules`, **no hacerles `git add`**: `git pull` en `main` (o agregarlos a `.git/info/exclude`).
- `core.autocrlf=true`: CRLF en el disco y LF en el repo. No mezclar finales de línea en un mismo archivo.
- Los enunciados no van al repo (`CONSIGNA FERNANDEZ.docx` está sin seguimiento: no hacerle `git add`). Lo que se exige de ellos está resumido acá.
- **`REVISION-EQUIPO.md`** (raíz, ignorado por Git): es el parte para el equipo cuando un integrante avanza solo. Tiene los PR en orden de revisión, los errores encontrados con su dueño, las decisiones tomadas (que se pueden objetar), las abiertas y las tareas de cada uno. Viaja por fuera del repo y se copia en la raíz del clon. Si existe, leerlo antes de revisar o fusionar PR, y anotar las observaciones en su sección 6. Quien avanza lo actualiza en cada PR o hallazgo.
- Para hacer commits, nombrar los archivos uno por uno en `git add`. Nunca usar `git add -A` ni `git add .` desde la raíz: ahí conviven los documentos locales.
- La terminal del usuario es Windows PowerShell 5.1: comandos una línea por vez o separados con `;` (no existe `&&`).

## Estado de integración (actualizar en cada PR)

Al 26/11/2026 (noche, después del #32): **la pila #14 → #19 está en `main`** (entró por el #20, `3feece7`, CI en verde). Trae la idempotencia, el OpenAPI con Swagger UI, la web conectada, el cobro como caso de uso y la billetera en su propia base con la proyección de saldos. El #16 se cerró por obsoleto. Detalle y tareas de cada uno: `REVISION-EQUIPO.md`, sección "Estado hoy".
- **Cada clon tiene que actualizar el `.env`** desde `.env.example` (nuevas `BILLETERA_DATABASE_URL`, `LECTURA_DATABASE_URL` y `ADMIN_DATABASE_URL`, y `DATABASE_URL` con `viajes_app`) y correr `npm run setup` y `npm run setup:test`.
- **#21** (Lucas, fusionado): revalida al chofer después del bloqueo y arregla el test intermitente de SKIP LOCKED.
- **#22** (Lucas, fusionado, `8e48189`): rechazo de oferta, vencimiento automático, `UBICACION_TTL_SEGUNDOS` y el status de los errores de tarifa (503/422). OpenAPI 0.5.0, 214/214. Ojo: al borrar la rama base de un PR apilado, GitHub **cierra** el PR de arriba en lugar de pasarlo a `main`. Antes de borrarla, cambiar la base del PR de arriba a `main`.
- **#23** `docs/entrega-final` (Agustín, fusionado por Lautaro con aprobación, `96c3430`): ADR 011 (web mínima, consulta periódica y choques entre consignas), participantes en los ADR 001–003, 006 y 007, guía de implementación y los `CLAUDE.md` al día.
- **#24 → #26** (Lucas, fusionados por Lautaro con aprobación, `579a1cc`, CI en verde): migración `005` y reglas de cancelación (ADR 004), cancelación de pasajero y chofer con prueba de carrera, y operador (activos, cancelar con motivo, reintento de cobro). **Cada clon tiene que correr `npm run setup` y `npm run setup:test`** por la `005`. 222/222.
- **#27** `feat/web-rechazo-vencimiento` (Agustín, aprobado y fusionado por Lucas, `678654d`): sólo web. "Rechazar" real (`POST /ofertas/:id/rechazar`), "Buscar chofer de nuevo" sólo cuando el primer pedido no encontró chofer, y `sin_choferes_disponibles` con "Pedir otro viaje". 16/16 contra el backend real y mirado en Chrome. Con `main` mergeado (el #23 le generó un conflicto en `viajes-web/CLAUDE.md`), CI en verde.
- **#28** `feat/historial-y-movimientos` (Agustín, rama 10, aprobado y fusionado por Lucas, `200f0fe`): historial del pasajero (`GET /viajes`) desde la proyección `historial_viajes` en `lectura` y `GET /billetera/me/movimientos` desde la base `billetera`, con "Mis viajes" y "Movimientos" en la web. **Usa la migración `006` de `viajes`** (trigger que deja `ViajeCambiado` en `outbox_viajes`); **la próxima de Lucas es la `007`**. OpenAPI 0.7.0, 229/229. Al fusionar: `npm run setup` y `npm run setup:test`.
- **#29 → #32** (Lucas, aprobados y fusionados por Agustín, `73ed5c0`, CI en verde en cada paso): `requiereRol` antes de `idempotente` (un rol equivocado da 403 sin reservar clave) y el **bloque 2 completo**. `avanzarEstado`, `cancelarViaje`, `aceptarOferta`, `ofrecerAlChoferCercano`, `rechazarOferta` y `procesarOfertasVencidas` pasan a ser casos de uso sobre `unidadDeTrabajoViajes`, con un adaptador en Postgres y otro en memoria. Sin migración: la próxima sigue siendo la `007`. 241/241. Dos observaciones del adaptador en memoria quedan para un PR aparte de Lucas (`REVISION-EQUIPO.md`, sección 6).
- **#35** `feat/web-responsiva` (Agustín, rama 11, aprobado y fusionado por Lucas, `69862b2`): web usable en el celular sólo con CSS. En las pantallas con mapa, la tarjeta pasa a ser una hoja inferior; el encabezado queda compacto, con controles de al menos 44 px e inputs de 16 px. Probado con Chrome headless a 390 × 844, 360 × 640 y 1280 × 800 (en escritorio no cambia nada). Sin cambios en el backend (241/241).
- **#33 y #34** (Lucas, aprobados y fusionados por Agustín, `7f7f769`): `schema_migrations`, `/ready` con migraciones, timeouts del pool y apagado ordenado; `tieneOfertaVigente` en `GET /viajes/:viajeId` y `UBICACION_TTL_SEGUNDOS=60` activo. 248/248. **Cada clon: `npm run setup` y `npm run setup:test`** (crean `schema_migrations`) y sumar `UBICACION_TTL_SEGUNDOS=60` al `.env`.
- **#36** `feat/web-operador-y-cancelacion` (Agustín, aprobado y fusionado por Lucas, `fc02e7f`): operador conectado (activos, cancelar con motivo, reintentar cobro), "Cancelar viaje" del pasajero y "Buscar chofer de nuevo" según `tieneOfertaVigente`. 21/21 contra el backend real.
- **#37** `feat/web-mapa-osm` (Agustín, revisa Lucas; base `main` desde que entró el #35, CI en verde): mapa real con **OpenStreetMap** (Leaflet + Photon + OSRM, sin claves: Google pide tarjeta; ADR 011, Decisión 4), con el dibujo como respaldo y Pedir arrancando vacía con "Conectado".
- **#37** fusionado (`bc23caf`). **#38** y **#39** (Lautaro, fusionados sin revisión registrada): Playwright con 1 test E2E obligatorio en la CI, `carga/viajes.js` (k6 de base) y `rateLimiting.test.js` (4 tests `skip`).
- **#40** (Lucas, aprobado y fusionado por Agustín, `aa990e7`): `pool.on('error')` en los 3 pools (cierra el hallazgo 2.5), timeouts del pool en `env.js` y la paridad del adaptador en memoria. **#41** (Lucas, aprobado y fusionado por Agustín, `97bb5d7`): `GET /admin/metricas` (lag del event loop y memoria) y `npm run carga:ubicaciones` (500 choferes). 253 tests.
- **#42** y **#43** (Lucas, aprobados y fusionados por Agustín a pedido del grupo, `ea93a06` y `b500e5a`): ubicaciones sin `FOR UPDATE` e historial por lotes, mediciones reales (3 corridas de 30 s por escenario), ADR 005 aceptado y retención del historial. **El bloque 7 está completo.** La carrera del recolector (`REVISION-EQUIPO.md` 2.6) la arregla el **#45** (Agustín, test que falla sin el arreglo, CI en verde; **falta fusionarlo**).
- **#44** (Agustín, fusionado sin revisión por decisión de Agustín, `8a035cd`): el seed crea `pasajero@demo.local` y `chofer@demo.local` (ya habilitado) y los README listan los accesos de los 4 roles. Cada clon: `npm run setup`.
- **`feat/web-chofer-cancelar-y-admin`** (Agustín, 27/11): el chofer cancela desde la web; el admin queda conectado con `GET /admin/choferes`, `GET` y `POST /admin/tarifa` (fila nueva activa con `LOCK TABLE ... IN EXCLUSIVE MODE`; test de 5 administradores a la vez). Ninguna pantalla usa datos de ejemplo. OpenAPI 0.10.0, 261 tests. Trae además la actualización de toda la documentación y borra el `package-lock.json` vacío de la raíz.
- **#45** y **#46** fusionados (`d340958`, `bb287e8`). El filtro de la billetera ("Mis viajes" sólo con los completos) quedó afuera del #46 y entra con la rama siguiente.
- **`feat/web-visual`** (Agustín, 27/11, fusionado sin revisión por decisión de Agustín; Lucas y Lautaro lo revisan después): **migración `007`** de `viajes` y `003` de `lectura` (nombres de los lugares; **la próxima de Lucas es la `008`**), `GET /viajes/:id` con vehículo y posición del chofer sólo mientras el viaje está activo (6.4, con test), `negocio` en `/admin/metricas`, y en la web el auto en movimiento, comprobantes, panel del admin, aviso de oferta y placeholders. OpenAPI 0.11.0, 266 tests. **Cada clon: `npm run setup` y `npm run setup:test`.**
- **`feat/tarifa-realista`** (Agustín, 27/11): la tarifa estima por calles (línea recta × 1,3), cobra los km con decimales y redondea a pesos. El seed pone la tarifa 2026 (base $ 1.500, $ 900/km, $ 180/min, 25 km/h), calibrada con el promedio de UberX desde el aeropuerto ($ 13.379); reemplaza la vieja de desarrollo si sigue activa. Sin migración. **Cada clon: `npm run setup`.**
- **`feat/estimacion-previa`** (Agustín, 27/11): `POST /viajes/estimacion` (sin Idempotency-Key, no escribe) y en Pedir el precio aproximado con km, minutos y aviso si el saldo no alcanza. OpenAPI 0.12.0, 273 tests.
- **`feat/demo-y-pulido`** (Agustín, 27/11): `npm run demo:reiniciar -- --confirmar` (base de desarrollo como nueva), el auto del chofer entra en el encuadre del mapa, la línea del comprobante más visible y CSS de celular para el panel, el comprobante y el precio aproximado.
- **#51** (Agustín, 27/11): en la demo el auto hace cada tramo en unos 20 s y la ruta se recorta detrás del auto.
- **#54** (Lautaro, `cb123ba`): amplió Playwright a 6 casos (`autenticacion`, `cancelacion`, `ofertas`, `viaje` con carga HMAC + reintento), sumó rampa k6 (`carga/estres-viajes.js` + `carga/RESULTADOS_PRUEBAS.md`) y envío de logs HTTP a Grafana Cloud vía Alloy (`observabilidad/`).
- **TP1 Fernández + limpieza (`#55` y apilados)**: limpieza de 4 `test.skip` en `rateLimiting.test.js`, `Dockerfile` + servicio `api` (`--profile api`), validación de respuestas contra OpenAPI 3.1 (`tests/infra/contratoOpenApi.test.js`) y [`viajes-backend/docs/trazabilidad.md`](viajes-backend/docs/trazabilidad.md).
- **Revisor**: desde el 26/11, Lucas revisa todos los PR de Agustín. Pendiente dejar revisiones registradas en los PRs fusionados sin review y completar la fase de ataque cruzado (`viajes-backend/docs/ataque.md`).
