# Matriz de trazabilidad (TP1 Fernández y Bloques Puljiz)

Documento de trazabilidad entre los requerimientos de las consignas (TP integrador de Fernández y enunciado de Puljiz), el contrato HTTP ([`openapi.yaml`](openapi.yaml)), las decisiones de arquitectura ([`adr/`](adr/)) y la evidencia ejecutable verificada en el repositorio.

## Equivalencias de vocabulario (TP integrador)

| En esta API / código | En la consigna (Fernández) |
|---|---|
| `pasajero` | Cliente |
| `chofer` | Conductor |
| `billetera`, `consumo`, `carga` | Medio de pago, cobro, acreditación (M7) |
| `oferta` | Oferta de despacho (M5) |
| `eventos_viaje` | Auditoría del ciclo de vida (M6) |

---

## Matriz requerimiento → OpenAPI → regla/ADR → prueba

### 1. Núcleo asignado / variante D (M7 Tarifas, Pagos y Billetera) y Temas de Arquitectura

| Requerimiento | Operación OpenAPI | Regla de negocio / ADR | Evidencia de prueba | Estado |
|---|---|---|---|---|
| **M7 · RF-7.1 / Tarifa** · Estimar tarifa antes y al pedir viaje | `POST /viajes/estimacion`, `POST /viajes` | Centavos enteros (`dinero.js`), distancia por calles × 1,3 y tope máximo ([`modelo.md`](modelo.md)) | `tests/dominio/tarifa.test.js`, `tests/aplicacion/estimarViaje.test.js`, `tests/infra/estimacionHttp.test.js` | Cubierto |
| **M7 · Admin tarifas** · Consultar y reemplazar tarifa sin carreras | `GET /admin/tarifa`, `POST /admin/tarifa` | Fila nueva activa con `LOCK TABLE ... IN EXCLUSIVE MODE` ([ADR 004](adr/004-concurrencia-asignacion-y-cobro.md)) | `tests/infra/rutasAdministracion.test.js`, `tests/integracion/administracion.test.js` | Cubierto |
| **M7 · RF-7.2 / Saldo y movimientos** · Consultar saldo y movimientos | `GET /billetera/me`, `GET /billetera/me/movimientos` | Saldo derivado de `SUM(movimientos_billetera)`, nunca columna mutable ([ADR 008](adr/008-base-de-datos-por-servicio.md), [ADR 009](adr/009-cqrs-proyecciones.md)) | `tests/dominio/billetera.test.js`, `tests/integracion/proyeccionSaldos.test.js`, `tests/integracion/historialYMovimientos.test.js` | Cubierto |
| **M7 · Carga por webhook** · Acreditar saldo con firma e idempotencia | `POST /billetera/webhooks/cargas` | HMAC-SHA256 sobre bytes crudos + dedupe por `eventoExternoId` ([ADR 006](adr/006-webhook-hmac-y-sse.md), [ADR 010](adr/010-idempotencia-y-deduplicacion.md)) | `tests/infra/verificadorWebhookHmac.test.js`, `tests/infra/cargaDemoWebhook.test.js`, `tests/integracion/repositorioBilleterasPostgres.test.js` | Cubierto |
| **M7 · RF-7.6 / Cobro nunca parcial** · Finalizar viaje y reintentar deuda | `POST /choferes/viajes/{viajeId}/finalizar`, `POST /viajes/{viajeId}/reintentar-cobro`, `POST /operador/viajes/{viajeId}/reintentar-cobro` | Cobro todo-o-nada; sin saldo queda `pago_pendiente`; índice `ux_un_consumo_por_viaje` ([ADR 004](adr/004-concurrencia-asignacion-y-cobro.md), [ADR 008](adr/008-base-de-datos-por-servicio.md)) | `tests/aplicacion/cobroDeViajes.test.js`, `tests/integracion/repositorioViajesPostgres.test.js`, `e2e/tests/viaje.spec.js` | Cubierto |
| **Tema 12 / RNF-05** · Base de datos por servicio | — | 3 bases (`viajes`, `billetera`, `lectura`) y 3 roles sin privilegios ni consultas cruzadas ([ADR 008](adr/008-base-de-datos-por-servicio.md)) | `npm run demo:propiedad-datos`, `tests/integracion/readyMigraciones.test.js`, `tests/seguridad/inyeccionSql.test.js` | Cubierto |
| **Tema 13** · CQRS y proyecciones | `GET /billetera/me`, `GET /viajes` | Outbox `UsuarioRegistrado` y `ViajeCambiado` hacia `lectura` con versionado monotónico ([ADR 009](adr/009-cqrs-proyecciones.md)) | `tests/integracion/outbox.test.js`, `tests/integracion/proyeccionSaldos.test.js`, `tests/integracion/historialYMovimientos.test.js` | Cubierto |
| **Tema 3 / RNF-09** · Idempotencia y deduplicación | 11 operaciones `POST` con `Idempotency-Key` | Misma clave+cuerpo repite respuesta (`Idempotency-Replayed: true`); distinto cuerpo da `422` ([ADR 010](adr/010-idempotencia-y-deduplicacion.md)) | `tests/infra/idempotenciaHttp.test.js`, `tests/integracion/idempotenciaHttp.test.js` | Cubierto |

### 2. Módulos propios de soporte en el backend (M1, M3–M6) y Bloques Puljiz

| Requerimiento | Operación OpenAPI | Regla de negocio / ADR | Evidencia de prueba | Estado |
|---|---|---|---|---|
| **M1 · Autenticación y roles** · Registro, login, perfil y autorización | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | Argon2id, JWT HS256 (15 min), RBAC antes de idempotencia ([ADR 003](adr/003-autenticacion-y-autorizacion.md)) | `tests/dominio/roles.test.js`, `tests/infra/tokensJwt.test.js`, `tests/seguridad/autenticacion.test.js`, `tests/seguridad/autorizacion.test.js`, `e2e/tests/autenticacion.spec.js` | Cubierto |
| **M3 · Choferes (admin)** · Listado y habilitación | `GET /admin/choferes`, `PATCH /admin/choferes/{choferId}/habilitacion` | Chofer inicia deshabilitado; deshabilitar lo marca no disponible | `tests/infra/rutasAdministracion.test.js`, `tests/integracion/administracion.test.js` | Cubierto |
| **M4 · Bloque 7 / Ubicación** · Disponibilidad y pings a escala (500 choferes) | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion`, `GET /admin/metricas` | Sin `FOR UPDATE` en pings, batching `unnest`, TTL 60 s ([ADR 005](adr/005-tarea-pesada-ubicaciones.md), [`mediciones.md`](mediciones.md)) | `tests/infra/metricasProceso.test.js`, `tests/infra/recolectorHistorialUbicaciones.test.js`, `tests/integracion/ubicacionesBatch.test.js` | Cubierto |
| **M5 · Despacho y concurrencia** · Oferta al más cercano, rechazo, vencimiento y aceptación única | `POST /viajes/{viajeId}/ofertas`, `GET /choferes/me/ofertas`, `POST /ofertas/{ofertaId}/aceptar`, `POST /ofertas/{ofertaId}/rechazar` | PostGIS `<= 5 km` ([ADR 007](adr/007-geolocalizacion-y-busqueda-cercanos.md)), `SKIP LOCKED` + orden global ([ADR 004](adr/004-concurrencia-asignacion-y-cobro.md)) | `tests/aplicacion/aceptarOferta.test.js`, `tests/aplicacion/despachoYOfertas.test.js`, `tests/concurrencia/aceptacionOfertas.test.js`, `tests/integracion/ofertasVencimientoRechazo.test.js`, `e2e/tests/ofertas.spec.js` | Cubierto |
| **M6 · Ciclo de vida del viaje** · Solicitud, avance, cancelación con motivo y privacidad de ubicación | `GET /viajes/{viajeId}`, `GET /choferes/me/viaje-actual`, `POST /choferes/viajes/{viajeId}/estado`, `POST /viajes/{viajeId}/cancelar`, `POST /choferes/viajes/{viajeId}/cancelar`, `GET/POST /operador/viajes/*` | Máquina de estados ([`modelo.md`](modelo.md)), ubicación del chofer expuesta sólo durante viaje activo (`6.4`), auditoría en `eventos_viaje` | `tests/dominio/estadosViaje.test.js`, `tests/aplicacion/cicloVidaViaje.test.js`, `tests/concurrencia/cancelacionVsAceptacion.test.js`, `tests/integracion/nombresYUbicacionChofer.test.js`, `tests/integracion/operadorViajes.test.js`, `e2e/tests/cancelacion.spec.js` | Cubierto |

### 3. Requisitos transversales (Calidad, Contratos, Operación y Seguridad)

| Requerimiento | Artefacto / Mecanismo | Evidencia de prueba | Estado |
|---|---|---|---|
| **TP1 · Contratos OpenAPI** · Validación de respuestas contra `openapi.yaml` | `openapi.yaml` (3.1.0, Swagger UI en `:8080`), `tests/ayudantes/validadorOpenApi.js` | `tests/infra/contratoOpenApi.test.js` (32 respuestas `2xx` + errores `400/401/403/404/409/422/503`) | Cubierto |
| **TP1 / Bloque 1 · Empaquetado** · Dockerfile, compose y config sin secretos | `viajes-backend/Dockerfile`, `.dockerignore`, `docker-compose.yml` (`profiles: ["api"]`), `src/config/env.js` | `docker compose --profile api up -d --wait api` → `/health` y `/ready` (`200 OK`) | Cubierto |
| **Bloques 3 y 4 · Operación y errores** · `/health`, `/ready`, apagado ordenado, logs JSON | `src/infra/http/errores.js`, `contexto.js`, `apagadoOrdenado.js` | `tests/infra/apagadoOrdenado.test.js`, `tests/integracion/readyMigraciones.test.js` | Cubierto |
| **Bloque 5 · Seguridad** · Rate limiting, CORS, CSP, validación estricta, SQLi | `cabecerasSeguridad.js`, `limitadorTasa.js`, Zod `.strict()`, Semgrep en CI | `tests/infra/cabecerasSeguridad.test.js`, `tests/seguridad/headersCors.test.js`, `tests/seguridad/inyeccionSql.test.js`, `tests/seguridad/prototypePollution.test.js`, `tests/seguridad/rateLimiting.test.js`, `tests/seguridad/validacionEntradas.test.js`, `tests/seguridad/validacionYRateLimit.test.js` | Cubierto |
| **Observabilidad y carga** · k6 y logs en Grafana Cloud (Loki) | `carga/estres-viajes.js`, `observabilidad/capturar-logs.mjs`, `config.alloy`, `dashboard-backend.json` | `carga/RESULTADOS_PRUEBAS.md`, `observabilidad/README.md`, `viajes-backend/docs/mediciones.md` | Cubierto |

---

## Fuera de alcance de TP1 / módulos externos del consorcio

- **M2 (perfil extendido y calificaciones)**, **M3 (tipos de vehículo auto/moto y documentación)**, **M8 (notificaciones por SSE y tickets)** y **M9 (reservas futuras)**: no pertenecen al núcleo TP1 del Grupo 4 (ADR 011).
- **RabbitMQ / Redis**: sustituidos por outbox en PostgreSQL y marcas temporales en base mientras no se integre el bus del consorcio en TP2 (ADR 009 y `CLAUDE.md`).
- **Bitácora de ataque cruzado**: reservada en [`ataque.md`](ataque.md) para la fase correspondiente con el grupo atacante asignado.
