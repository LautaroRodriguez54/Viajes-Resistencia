# Viajes Resistencia

Plataforma de viajes bajo demanda para Resistencia (Chaco): los pasajeros piden un viaje, los choferes cercanos lo aceptan y el cobro se hace con una billetera digital. El foco está en que el sistema sea correcto ante concurrencia: un viaje nunca queda asignado a dos choferes y un cobro nunca se hace dos veces ni a medias.

## Materia

Trabajo práctico final de **Programación IV**, Universidad Tecnológica Nacional, Facultad Regional Resistencia (UTN FRRe), 2026.

- **Grupo 4, variante D: billetera y pagos.**
- Docentes: Puljiz (enunciado del TP) y Fernández (temas de arquitectura y TP integrador).
- Integrantes: Escobar Lucas, Valussi Agustín, Rodríguez Lautaro.

El mismo proyecto cumple las consignas de los dos docentes. Además del enunciado base, implementa tres temas de arquitectura: **base de datos por servicio**, **CQRS** e **idempotencia y deduplicación**.

## Qué hace

- **Pasajero:** se registra, busca la dirección de origen y de destino en el mapa, pide el viaje, lo sigue, lo puede cancelar y paga con su billetera. Ve su historial de viajes y los movimientos de la billetera.
- **Chofer:** se pone disponible, envía su ubicación, recibe la oferta con cuenta regresiva y la ruta en el mapa, la acepta o la rechaza, avanza el viaje y lo finaliza (ahí se cobra).
- **Operador:** ve los viajes activos, los cancela con motivo y reintenta el cobro de un pago pendiente.
- **Administrador:** habilita choferes (por la API; la pantalla todavía usa datos de ejemplo).

Reglas que el sistema garantiza en la base de datos:

- Un viaje se asigna a un solo chofer, aunque varios acepten a la vez.
- Un chofer tiene como máximo un viaje activo.
- Un viaje se cobra una sola vez y nunca de forma parcial: si el saldo no alcanza, no se debita nada y queda como pago pendiente.
- Una carga de saldo repetida no se acredita dos veces.
- El dinero se guarda siempre en centavos enteros.
- Repetir un pedido con la misma `Idempotency-Key` no repite la operación.

## Estructura del repositorio

| Carpeta | Contenido |
|---|---|
| [`viajes-backend/`](viajes-backend/) | API REST en Node.js 22 + Express 5, PostgreSQL 16 + PostGIS, SQL directo, JWT y Argon2id. Arquitectura hexagonal, con tres bases (`viajes`, `billetera`, `lectura`) en el mismo contenedor. |
| [`viajes-web/`](viajes-web/) | Interfaz web en React + Vite, conectada al backend y responsiva para el celular. Mapa de OpenStreetMap (Leaflet), búsqueda de direcciones (Photon) y ruta por calles (OSRM), sin claves. |

## Cómo correrlo

Requisitos: Node.js 22, Docker y Docker Compose. En Windows, abrir Docker Desktop antes.

**Backend** (desde `viajes-backend/`):

```bash
cp .env.example .env
npm install
docker compose up -d
npm run setup          # crea las 3 bases y sus roles, aplica migraciones y carga el seed
npm run setup:test     # bases *_test para los tests de integración
npm test               # con DATABASE_URL apuntando a viajes_test corren todos (ver README del backend)
npm run dev            # http://localhost:3000
```

Comprobar con `GET http://localhost:3000/health` (el proceso) y `GET http://localhost:3000/ready` (las 3 bases y las migraciones). Es sólo API: se prueba con `curl`, REST Client o Postman, o desde la web.

**Web** (desde `viajes-web/`, en otra terminal):

```bash
npm install
npm run dev            # http://localhost:5173
```

En Windows PowerShell 5.1 no existe `&&`: ejecutar los comandos uno por línea.

### Usuarios de desarrollo

Los crea `npm run setup` (seed, sólo para desarrollo):

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `admin@demo.local` | `AdminDemo123!` |
| Operador | `operador@demo.local` | `OperadorDemo123!` |

Pasajeros y choferes se registran desde la web (`/registro`). Un chofer nuevo tiene que ser habilitado por el administrador (`PATCH /admin/choferes/:choferId/habilitacion`, está en la [colección de pedidos](viajes-backend/docs/requests.http)).

### Recorrido de la demo

1. Abrir el pasajero y el chofer en **pestañas distintas** (la sesión es por pestaña).
2. **Chofer:** prender "Disponible".
3. **Pasajero:** elegir "Desde" y "Hasta" (se marca la ruta) y tocar "Pedir viaje".
4. **Chofer:** aparece la oferta con la cuenta regresiva de 30 s. Aceptar y avanzar: "Voy en camino" → "Pasajero a bordo: iniciar viaje" → "Finalizar y cobrar".
5. **Sin saldo** el viaje queda en `pago_pendiente` y no se cobra nada. Cargar saldo con `npm run cargar-saldo -- <email> <centavos>` (en `viajes-backend/`) y tocar "Pagar ahora" en la billetera.
6. **Operador** (`operador@demo.local`): ve los viajes activos, cancela con motivo o reintenta un cobro pendiente.

El detalle de cada pantalla y sus endpoints está en el [README de la web](viajes-web/README.md).

### Comandos útiles (en `viajes-backend/`)

| Comando | Para qué |
|---|---|
| `npm run cargar-saldo -- <email> <centavos>` | Carga saldo por el webhook real, firmado con HMAC (la demo no tiene un endpoint de carga). |
| `npm run demo:propiedad-datos` | Muestra que el módulo Viajes no puede leer la base de la billetera (`permission denied`, tema 12). |
| `npm run proyecciones:reconstruir` | Rearma las proyecciones de lectura (saldos e historial) desde los outbox (tema 13). |
| `npm run lint` | ESLint con reglas de seguridad. |
| `docker compose --profile docs up -d docs` | Swagger UI con el contrato en http://localhost:8080. |

## Dónde se defiende cada tema

| Tema | Dónde está | ADR |
|---|---|---|
| Asignación única ante aceptaciones simultáneas | `SELECT ... FOR UPDATE` + índices únicos; test de 50 aceptaciones a la vez | [004](viajes-backend/docs/adr/004-concurrencia-asignacion-y-cobro.md) |
| Cobro sin duplicados y nunca parcial (variante D) | Bloqueo de la billetera, suma de movimientos, `pago_pendiente`; test de dos cobros contra un saldo | [004](viajes-backend/docs/adr/004-concurrencia-asignacion-y-cobro.md), [008](viajes-backend/docs/adr/008-base-de-datos-por-servicio.md) |
| Base de datos por servicio (tema 12) | Billetera en su propia base, con su rol y sin consultas cruzadas | [008](viajes-backend/docs/adr/008-base-de-datos-por-servicio.md) |
| CQRS (tema 13) | Outbox + proyecciones en la base `lectura` (saldos e historial) | [009](viajes-backend/docs/adr/009-cqrs-proyecciones.md) |
| Idempotencia y deduplicación (tema 3) | `Idempotency-Key` en los endpoints que crean o cobran; webhook y eventos deduplicados | [010](viajes-backend/docs/adr/010-idempotencia-y-deduplicacion.md) |
| Web mínima, consulta periódica y mapas | Consulta cada 2 s en lugar de SSE; OpenStreetMap en lugar de Google | [011](viajes-backend/docs/adr/011-web-minima-y-choques-de-consignas.md) |

## Calidad

- **Tests** (`node --test`) en cinco niveles: dominio, aplicación (con adaptadores en memoria, sin base), integración (Postgres real), seguridad y concurrencia.
- **CI** en GitHub Actions en cada PR: lint, tests y auditoría del backend, build y auditoría de la web y análisis estático con Semgrep.
- Errores con forma estable (`{ error: { codigo, requestId } }`), logs JSON con `requestId`, límites de tasa con `429` y cabeceras de seguridad.

## Documentación

- [README del backend](viajes-backend/README.md) y [README de la web](viajes-web/README.md)
- [Guía de implementación](viajes-backend/docs/guia-implementacion.md): recorrido archivo por archivo
- [Modelo de dominio](viajes-backend/docs/modelo.md)
- [Contrato HTTP (OpenAPI 3.1)](viajes-backend/docs/openapi.yaml): resumen en [`api.md`](viajes-backend/docs/api.md)
- [Colección de pedidos](viajes-backend/docs/requests.http): el recorrido completo de un viaje para REST Client
- [Decisiones de arquitectura (ADR 001 a 011)](viajes-backend/docs/adr/)
- [Mediciones](viajes-backend/docs/mediciones.md)
- [Bitácora del ataque cruzado](viajes-backend/docs/ataque.md)
- [Diseño de la interfaz web](viajes-backend/docs/diseno-web/README.md)

## Forma de trabajo

Una rama por tarea y pull request a `main` con revisión de otro integrante y la CI en verde. Las ramas que dependen de otra se apilan, y antes de fusionar la de abajo se cambia la base de la de arriba a `main`.
