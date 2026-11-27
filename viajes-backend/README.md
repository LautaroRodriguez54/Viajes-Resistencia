# Plataforma de viajes - Billetera y pagos

Backend para solicitar, asignar y finalizar viajes, con una billetera basada en movimientos y cobros idempotentes. Es el TP final de Programación IV, variante D.

## Estado inicial

Esta primera base contiene la arquitectura, el arranque reproducible, salud del proceso, conexión a PostgreSQL y documentación de diseño. Los flujos de negocio están deliberadamente pendientes de definición e implementación.

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

El registro público admite pasajeros y choferes mediante `POST /auth/register`. La respuesta de registro y login contiene `accessToken`; enviarlo luego como `Authorization: Bearer <accessToken>`. Los usuarios operador y administrador se cargarán con los datos de demostración, no por registro público.

Administrador de desarrollo: `admin@demo.local` / `AdminDemo123!`.

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

## Roles previstos

| Rol | Alcance inicial |
|---|---|
| Pasajero | Solicita y consulta sus viajes; consulta su propia billetera. |
| Chofer | Administra disponibilidad, ubicación y sus viajes asignados. |
| Operador | Consulta viajes en curso y cancela con motivo. |
| Administrador | Configura tarifas, zonas y parámetros. |

La autenticación usa JWT y las contraseñas usarán Argon2id. La matriz detallada de permisos se completará antes de exponer los endpoints protegidos.

## Documentación

- [Modelo de dominio](docs/modelo.md)
- [Contrato HTTP (OpenAPI 3.1)](docs/openapi.yaml): resumen en [`api.md`](docs/api.md); Swagger UI con `docker compose --profile docs up -d docs` (http://localhost:8080)
- [Colección de pedidos](docs/requests.http): el recorrido completo de un viaje para REST Client
- [Mediciones](docs/mediciones.md)
- [Bitácora de ataque](docs/ataque.md)
- [Guía de implementación](docs/guia-implementacion.md)
- [Decisiones de arquitectura](docs/adr/)

