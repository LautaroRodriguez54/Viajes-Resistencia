# Contrato HTTP inicial

El contrato detallado se publica antes del congelamiento. Toda entrada se validará con esquema, incluidos parámetros, query y encabezados relevantes.

| Área | Endpoint previsto | Estado |
|---|---|---|
| Salud | `GET /health` | Implementado |
| Disponibilidad | `GET /ready` | Implementado |
| Autenticación | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | Implementado (alcance inicial) |
| Viajes | `POST /viajes`, `GET /viajes/:viajeId` | Implementado: solicitud/consulta de pasajero |
| Ofertas | `POST /viajes/:viajeId/ofertas` | Implementado: elige el chofer disponible más cercano en 5 km |
| Ofertas | `POST /ofertas/:ofertaId/aceptar` | Implementado: aceptación atómica del chofer |
| Choferes | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion` | Implementado |
| Viaje del chofer | `POST /choferes/viajes/:viajeId/estado`, `POST /choferes/viajes/:viajeId/finalizar` | Implementado |
| Administración | `PATCH /admin/choferes/:choferId/habilitacion` | Implementado |
| Ofertas | aceptación y vencimiento de oferta | TODO |
| Ubicaciones | actualización de chofer y seguimiento SSE | TODO |
| Billetera | `GET /billetera/me` | Implementado (saldo) |
| Pagos | `POST /billetera/webhooks/cargas` | Implementado (carga simulada) |

## Convenciones confirmadas

- Las operaciones que crean, cobran o producen efectos externos requerirán `Idempotency-Key`.
- Los errores no exponen stack traces; incluirán `codigo` y `requestId`.
- El webhook verificará HMAC sobre el cuerpo crudo antes de procesarlo.

## Carga de billetera simulada

`POST /billetera/webhooks/cargas` recibe un JSON estricto con `eventoExternoId`, `pasajeroId` e `importeCentavos`, y el encabezado `X-Webhook-Signature: sha256=<hmac>`. El HMAC-SHA256 se calcula sobre los bytes exactos del cuerpo con `WEBHOOK_HMAC_SECRET`. Un segundo envío del mismo `eventoExternoId` no crea otro movimiento y responde como duplicado.

## Autenticación inicial

- `POST /auth/register`: registra solamente `pasajero` o `chofer`. Un chofer debe incluir vehículo y queda pendiente de habilitación administrativa.
- `POST /auth/login`: devuelve un JWT Bearer con `sub` y `rol`.
- `GET /auth/me`: requiere `Authorization: Bearer <token>`.
- Las contraseñas requieren entre 12 y 128 caracteres y se almacenan con Argon2id.
- No se implementan refresh tokens, recuperación de contraseña ni revocación en esta primera etapa.

## Pendiente de acordar

- TODO: versión/prefijo de API.
- TODO: formato de login y duración de credenciales.
- TODO: eventos SSE, estrategia de reconexión y último evento recibido.

