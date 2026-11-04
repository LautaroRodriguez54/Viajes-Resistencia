# Viajes Resistencia

Plataforma de viajes bajo demanda para Resistencia (Chaco): los pasajeros piden un viaje, los choferes cercanos lo aceptan y el cobro se hace con una billetera digital. El foco está en que el sistema sea correcto ante concurrencia: un viaje nunca queda asignado a dos choferes y un cobro nunca se hace dos veces ni a medias.

## Materia

Trabajo práctico final de **Programación IV**, Universidad Tecnológica Nacional, Facultad Regional Resistencia (UTN FRRe), 2026.

- **Grupo 4, variante D: billetera y pagos.**
- Docentes: Puljiz (enunciado del TP) y Fernández (temas de arquitectura y TP integrador).
- Integrantes: Escobar Lucas, Valussi Agustín, Rodríguez Lautaro.

El mismo proyecto cumple las consignas de los dos docentes. Además del enunciado base, implementa tres temas de arquitectura: **base de datos por servicio**, **CQRS** e **idempotencia y deduplicación**.

## Qué hace

- **Pasajero:** se registra, estima y pide un viaje, sigue al chofer y paga con su billetera.
- **Chofer:** se pone disponible, envía su ubicación y acepta o rechaza ofertas con tiempo límite.
- **Operador:** ve los viajes activos y los cancela con motivo.
- **Administrador:** habilita choferes y configura la tarifa.

Reglas que el sistema garantiza en la base de datos:

- Un viaje se asigna a un solo chofer, aunque varios acepten a la vez.
- Un chofer tiene como máximo un viaje activo.
- Un viaje se cobra una sola vez y nunca de forma parcial: si el saldo no alcanza, no se debita nada y queda como pago pendiente.
- Una carga de saldo repetida no se acredita dos veces.
- El dinero se guarda siempre en centavos enteros.

## Estructura del repositorio

| Carpeta | Contenido |
|---|---|
| [`viajes-backend/`](viajes-backend/) | API REST en Node.js 22 + Express 5, PostgreSQL 16 + PostGIS, SQL directo, JWT y Argon2id. Arquitectura hexagonal. |
| [`viajes-web/`](viajes-web/) | Interfaz web en React + Vite. Hoy tiene las 7 pantallas del diseño, todavía sin conexión al backend. |

## Cómo correrlo

Requisitos: Node.js 22, Docker y Docker Compose.

**Backend** (desde `viajes-backend/`):

```bash
cp .env.example .env
npm install
docker compose up -d
npm run setup
npm test
npm run dev        # http://localhost:3000
```

Comprobar con `GET http://localhost:3000/health` y `GET http://localhost:3000/ready`. Es sólo API: se prueba con `curl`, REST Client o Postman. Administrador de desarrollo: `admin@demo.local` / `AdminDemo123!`.

**Web** (desde `viajes-web/`):

```bash
npm install
npm run dev        # http://localhost:5173
```

En Windows PowerShell 5.1 no existe `&&`: ejecutar los comandos uno por línea.

## Documentación

- [README del backend](viajes-backend/README.md)
- [Modelo de dominio](viajes-backend/docs/modelo.md)
- [Contrato HTTP](viajes-backend/docs/api.md)
- [Decisiones de arquitectura (ADR)](viajes-backend/docs/adr/)
- [Mediciones](viajes-backend/docs/mediciones.md)
- [Bitácora del ataque cruzado](viajes-backend/docs/ataque.md)
- [Diseño de la interfaz web](viajes-backend/docs/diseno-web/README.md)

## Forma de trabajo

Una rama por tarea y pull request a `main` con revisión de otro integrante.
