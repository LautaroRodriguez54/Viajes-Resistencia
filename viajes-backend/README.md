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

Comprobar el proceso con `GET http://localhost:3000/health` y la disponibilidad real con `GET http://localhost:3000/ready`.

## Acceso inicial

El registro público admite pasajeros y choferes mediante `POST /auth/register`. La respuesta de registro y login contiene `accessToken`; enviarlo luego como `Authorization: Bearer <accessToken>`. Los usuarios operador y administrador se cargarán con los datos de demostración, no por registro público.

Administrador de desarrollo: `admin@demo.local` / `AdminDemo123!`.

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
- [Contrato HTTP](docs/api.md)
- [Mediciones](docs/mediciones.md)
- [Bitácora de ataque](docs/ataque.md)
- [Guía de implementación](docs/guia-implementacion.md)
- [Decisiones de arquitectura](docs/adr/)

