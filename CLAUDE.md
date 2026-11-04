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
| M3 Conductores y Vehículos | Habilitación, vehículos auto/moto, documentación | Perfil de chofer + habilitación por admin (sin tipos de vehículo ni documentos) |
| M4 Ubicación y Disponibilidad | Posición, cercanos, TTL de ubicación, ETA | `choferes/me/ubicacion`, PostGIS (sin TTL ni ETA) |
| M5 Solicitud y Despacho | Candidatos, ofertas con vencimiento, asignación única | Ofertas a ≤5 km, aceptación (sin vencimiento ni rechazo) |
| M6 Viajes y Ciclo de Vida | Estados, arribo, inicio con QR, cancelación, auditoría | Estados + `eventos_viaje` (sin QR ni cancelación) |
| **M7 Tarifas, Pagos y Liquidaciones** | Estimación, cobro, cargo de cancelación, reintegro, liquidación al conductor, idempotencia | **Billetera (variante D)**: tarifa, webhook de carga, cobro sin parcial |
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
- La terminal del usuario es Windows PowerShell 5.1: comandos una línea por vez o separados con `;` (no existe `&&`).
