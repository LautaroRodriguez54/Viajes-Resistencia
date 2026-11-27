# Plataforma de viajes - Billetera y pagos

Backend para solicitar, asignar y finalizar viajes, con una billetera basada en movimientos y cobros idempotentes. Es el TP final de Programación IV, variante D.

## Qué hace

- **Viajes**: el pasajero pide un viaje con origen y destino (el servidor calcula la tarifa), se le ofrece al chofer habilitado y disponible más cercano a 5 km o menos, el chofer acepta o rechaza, y las ofertas vencen solas a los 30 s y pasan al siguiente. El viaje avanza por `asignado → chofer_en_camino → en_curso → finalizado`, y se puede cancelar según el rol.
- **Billetera (variante D)**: saldo derivado de movimientos inmutables en centavos enteros, cargas por webhook firmado con HMAC y cobro al finalizar, que nunca es parcial: si no alcanza, el viaje queda en `pago_pendiente` y se reintenta.
- **Concurrencia**: una sola aceptación gana entre muchas simultáneas, dos cobros no gastan el mismo saldo y la tarifa no se pisa entre dos administradores (ADR 004).
- **Arquitectura**: hexagonal (dominio puro, casos de uso, adaptadores Postgres y en memoria), tres bases separadas por módulo (ADR 008), proyecciones CQRS (ADR 009) e idempotencia en 3 niveles (ADR 010).
- **Operación**: `/health` y `/ready` (las tres bases y sus migraciones), logs JSON con `requestId`, apagado ordenado, límites de tasa y `GET /admin/metricas` (lag del event loop y memoria).

## Requisitos

- Node.js 22 LTS
- Docker y Docker Compose (la base usa PostGIS)

## Arranque local

```bash
cp .env.example .env
npm install
docker compose up -d
npm run setup
npm test
npm run dev
```

La base de este proyecto se publica en el puerto local `5433` para no interferir con una instalación local de PostgreSQL.

## Bases de datos (ADR 008)

El contenedor tiene tres bases, una por módulo, y cada una con su propio rol: `viajes` (`viajes_app`), `billetera` (`billetera_app`) y `lectura` (`lectura_app`, proyecciones del ADR 009). `npm run setup` las crea junto con sus roles y migraciones. Se puede correr las veces que haga falta, y en un volumen ya existente no hace falta `docker compose down -v`. Las URL están en `.env.example`. `ADMIN_DATABASE_URL` (el superusuario del contenedor) sólo la usa `npm run migrate`, no la app.

- `npm run demo:propiedad-datos`: muestra que cada rol entra sólo a su base (`permission denied` entre módulos).
- `npm run proyecciones:reconstruir`: rearma las proyecciones de saldos e historial de viajes desde los outbox.

### Tests de integración

Sin `DATABASE_URL` en el entorno, `npm test` corre sólo los tests que no necesitan base (los de integración se saltean). Para correrlos todos:

```powershell
npm run setup:test
$env:DATABASE_URL='postgres://viajes:viajes@localhost:5433/viajes_test'; npm test
```

`setup:test` crea `viajes_test`, `billetera_test` y `lectura_test`. Los tests derivan las URL de las otras dos a partir de `DATABASE_URL`.

Comprobar el proceso con `GET http://localhost:3000/health` y la disponibilidad real con `GET http://localhost:3000/ready`.

## Acceso inicial

El registro público admite pasajeros y choferes mediante `POST /auth/register`. La respuesta de registro y login contiene `accessToken` (JWT de 15 min); enviarlo luego como `Authorization: Bearer <accessToken>`. El operador y el administrador no se registran: los crea el seed. Un chofer registrado no recibe viajes hasta que el administrador lo habilita.

Accesos de desarrollo que crea `npm run setup` (seed):

| Rol | Email | Contraseña |
|---|---|---|
| Pasajero | `pasajero@demo.local` | `PasajeroDemo123!` |
| Chofer (ya habilitado, patente `DEMO001`) | `chofer@demo.local` | `ChoferDemo123!` |
| Operador | `operador@demo.local` | `OperadorDemo123!` |
| Administrador | `admin@demo.local` | `AdminDemo123!` |

El pasajero arranca con saldo 0: ver "Cargar saldo para la demo".

## Cargar saldo para la demo

En producción el saldo lo acredita el proveedor de pagos con un webhook firmado (`POST /billetera/webhooks/cargas`, HMAC-SHA256 con `WEBHOOK_HMAC_SECRET`). Para desarrollo y demos, el script simula a ese proveedor: firma el cuerpo con el secreto del `.env` y llama al mismo webhook. No agrega ningún endpoint, así que no amplía lo que se puede atacar, y el secreto nunca sale del servidor ni llega al front.

Con el servidor levantado (`npm run dev`):

```bash
npm run cargar-saldo -- pasajero@demo.local 150000
npm run cargar-saldo -- <pasajeroId> 50000 --url http://localhost:3000
```

- El destino es el email de un pasajero registrado (el script busca su id en la base) o directamente su id (uuid).
- El importe va en **centavos enteros**: `150000` son $1500.
- Cada ejecución genera un `eventoExternoId` nuevo (`demo-<uuid>`), así que dos ejecuciones acreditan dos veces. El webhook sigue descartando un mismo evento repetido.
- Se niega a correr con `NODE_ENV=production`.

## Roles y permisos

Cada ruta verifica el rol antes que cualquier otra cosa (403 si no corresponde), y la propiedad del recurso se verifica en la consulta: un pasajero que pide un viaje ajeno recibe 404.

| Rol | Qué puede hacer | Endpoints |
|---|---|---|
| Pasajero | Pedir viajes, buscar chofer, cancelar antes de que lo levanten, ver su historial, su billetera y sus movimientos, pagar una deuda | `POST /viajes`, `GET /viajes`, `GET /viajes/:id`, `POST /viajes/:id/ofertas`, `POST /viajes/:id/cancelar`, `POST /viajes/:id/reintentar-cobro`, `GET /billetera/me`, `GET /billetera/me/movimientos` |
| Chofer | Disponibilidad y ubicación, ver y aceptar o rechazar ofertas, avanzar, finalizar (cobra) y cancelar en `asignado` o `chofer_en_camino` | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion`, `GET /choferes/me/ofertas`, `GET /choferes/me/viaje-actual`, `POST /ofertas/:id/aceptar`, `POST /ofertas/:id/rechazar`, `POST /choferes/viajes/:id/estado`, `POST /choferes/viajes/:id/finalizar`, `POST /choferes/viajes/:id/cancelar` |
| Operador | Ver los viajes activos, cancelar con motivo obligatorio, reintentar un cobro pendiente | `GET /operador/viajes?estado=activos`, `POST /operador/viajes/:id/cancelar`, `POST /operador/viajes/:id/reintentar-cobro` |
| Administrador | Habilitar choferes, cambiar la tarifa (crea una nueva activa), ver métricas del proceso | `GET /admin/choferes`, `PATCH /admin/choferes/:id/habilitacion`, `GET /admin/tarifa`, `POST /admin/tarifa`, `GET /admin/metricas` |

Las contraseñas se guardan con Argon2id (ADR 003). Los 11 endpoints que crean, cobran o cambian la tarifa exigen `Idempotency-Key` (ADR 010).

## Carga de 500 choferes (bloque 7)

Con el servidor levantado (`npm run dev`), en otra terminal:

```bash
npm run carga:ubicaciones -- --escenario=ubicaciones --duracion-s=30
```

Crea 500 choferes sintéticos que mandan su ubicación cada 2 s mientras otros pasajeros piden viajes, mide p50/p95/p99, tiempo de asignación y lag del event loop (desde `GET /admin/metricas`) y al terminar borra lo que creó. Sólo corre contra un servidor y un Postgres locales. Los resultados y el análisis están en [`docs/mediciones.md`](docs/mediciones.md) y la decisión en el ADR 005.

## Documentación

- [Modelo de dominio](docs/modelo.md): estados del viaje, tarifa, billetera, bases y reglas
- [Contrato HTTP (OpenAPI 3.1)](docs/openapi.yaml): resumen en [`api.md`](docs/api.md); Swagger UI con `docker compose --profile docs up -d docs` (http://localhost:8080)
- [Colección de pedidos](docs/requests.http): el recorrido completo de un viaje para REST Client
- [Mediciones](docs/mediciones.md)
- [Bitácora de ataque](docs/ataque.md)
- [Guía de implementación](docs/guia-implementacion.md)
- [Decisiones de arquitectura](docs/adr/):
  - 001 ESM · 002 PostgreSQL con SQL parametrizado · 003 JWT, Argon2id y roles · 004 concurrencia (bloqueo pesimista y orden global)
  - 005 ubicaciones sin bloqueo y por lotes · 006 HMAC del webhook (el SSE lo reemplaza el 011) · 007 PostGIS
  - 008 base de datos por servicio · 009 CQRS · 010 idempotencia · 011 web mínima y choques entre consignas

