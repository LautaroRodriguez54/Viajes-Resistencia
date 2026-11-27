# Contrato HTTP

**La fuente de verdad es [`openapi.yaml`](openapi.yaml)** (OpenAPI 3.1): esquemas, validaciones, ejemplos, errores por endpoint y seguridad. Este archivo sólo resume el contrato y dice dónde está cada cosa.

## Cómo verlo y probarlo

| Qué | Cómo |
|---|---|
| Swagger UI (interactivo) | `docker compose --profile docs up -d docs` → http://localhost:8080. Con el servidor levantado (`npm run dev`), "Try it out" llama a `http://localhost:3000`: el origen `http://localhost:8080` ya está en `CORS_ORIGINS` de `.env.example`. Se apaga con `docker compose --profile docs stop docs`. |
| Colección de pedidos | [`requests.http`](requests.http): el recorrido completo de un viaje en orden, más los errores típicos. Se usa con la extensión REST Client de VS Code. |
| Cargar saldo | `npm run cargar-saldo -- <email> <centavos>` (ver el README del backend). |

## Endpoints

| Área | Endpoint | Rol | `Idempotency-Key` |
|---|---|---|---|
| Salud | `GET /health`, `GET /ready` | — | |
| Autenticación | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | — / cualquiera | |
| Viajes | `POST /viajes/estimacion` (precio aproximado, no crea nada) | pasajero | no |
| Viajes | `POST /viajes` | pasajero | **sí** |
| Viajes | `GET /viajes/:viajeId` (con origen y destino con nombre; mientras está activo, el vehículo y la posición del chofer) | pasajero dueño | |
| Viajes | `POST /viajes/:viajeId/cancelar` | pasajero dueño | **sí** |
| Ofertas | `POST /viajes/:viajeId/ofertas` | pasajero dueño | **sí** |
| Ofertas | `POST /ofertas/:ofertaId/aceptar` | chofer de la oferta | **sí** |
| Ofertas | `POST /ofertas/:ofertaId/rechazar` | chofer de la oferta | **sí** |
| Chofer | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion` | chofer | |
| Chofer | `GET /choferes/me/ofertas` (oferta vigente o `null`), `GET /choferes/me/viaje-actual` (viaje activo o `null`) | chofer | |
| Chofer | `POST /choferes/viajes/:viajeId/estado` | chofer asignado | |
| Chofer | `POST /choferes/viajes/:viajeId/cancelar` | chofer asignado | **sí** |
| Chofer | `POST /choferes/viajes/:viajeId/finalizar` (finaliza y cobra) | chofer asignado | **sí** |
| Billetera | `POST /viajes/:viajeId/reintentar-cobro` | pasajero dueño | **sí** |
| Viajes | `GET /viajes?limite=` (historial desde la proyección `historial_viajes`, ADR 009) | pasajero | |
| Billetera | `GET /billetera/me` | pasajero | |
| Billetera | `GET /billetera/me/movimientos?limite=` (desde la base `billetera`) | pasajero | |
| Billetera | `POST /billetera/webhooks/cargas` | proveedor de pagos (firma HMAC) | no: deduplica por `eventoExternoId` |
| Operador | `GET /operador/viajes?estado=activos` | operador | |
| Operador | `POST /operador/viajes/:viajeId/cancelar` (motivo obligatorio) | operador | **sí** |
| Operador | `POST /operador/viajes/:viajeId/reintentar-cobro` | operador | **sí** |
| Administración | `GET /admin/choferes?estado=&limite=` (`pendientes` por defecto, o `todos`) | administrador | |
| Administración | `PATCH /admin/choferes/:choferId/habilitacion` | administrador | |
| Administración | `GET /admin/tarifa` (tarifa activa) | administrador | |
| Administración | `POST /admin/tarifa` (crea una tarifa nueva activa; la anterior queda en el historial) | administrador | **sí** |
| Administración | `GET /admin/metricas?reiniciar=` (lag del event loop, memoria y conteos del negocio para el panel, bloque 7) | administrador | |

**Pendientes** (se agregan al OpenAPI cuando existan): historial del chofer y SSE.

## Convenciones

- **Errores**: siempre `{ "error": { "codigo", "requestId" } }`, sin stack trace. El cliente decide por `codigo`. El `requestId` es el mismo del header `X-Request-Id` y de los logs.
- **Idempotencia** (ADR 010):
  - sin header: `400 CLAVE_IDEMPOTENCIA_REQUERIDA`;
  - la misma clave con otro pedido: `422 CLAVE_IDEMPOTENCIA_REUTILIZADA`;
  - repetida mientras la primera sigue en curso: `409 PEDIDO_EN_CURSO`;
  - repetida ya completada: la misma respuesta con `Idempotency-Replayed: true`.
- **Entrada estricta**: los cuerpos se validan con Zod `.strict()`, así que un campo de más da `400 ENTRADA_INVALIDA`. JSON mal formado da `400 JSON_INVALIDO`; un cuerpo de más de 100 kB, `413`.
- **Puntos**: en la solicitud, `origen` y `destino` pueden traer `nombre` (opcional, 1 a 120 caracteres, sin caracteres de control); en las respuestas el nombre viene siempre (`null` si no se mandó).
- **Dinero** en centavos enteros. La tarifa la calcula el servidor (ver `modelo.md`).
- **Webhook**: HMAC-SHA256 sobre los bytes exactos del cuerpo, en `X-Webhook-Signature: sha256=<hex>`, con `WEBHOOK_HMAC_SECRET`.
- **Autenticación**: JWT Bearer HS256 de 15 min, sin refresh ni revocación todavía. Contraseñas de 12 a 128 caracteres, guardadas con Argon2id. El registro público admite sólo pasajero y chofer; el chofer queda sin habilitar.
- **Límite de tasa** en login, webhook y ubicación: `429 LIMITE_DE_PETICIONES_EXCEDIDO` con headers `RateLimit-*`.

## Equivalencias con el TP integrador

pasajero = cliente · chofer = conductor · billetera = medio de pago (M7) · oferta = oferta de despacho (M5).

## Pendiente de acordar

- Prefijo y versión de la API (`/v1`), cuando haya que convivir con otros módulos del consorcio.
- Eventos SSE, estrategia de reconexión y `Last-Event-ID`.
- Tests que validen las respuestas contra `openapi.yaml` (TP1). Hace falta elegir una librería que lea YAML y valide JSON Schema.
