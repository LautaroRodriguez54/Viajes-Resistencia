# Guía de implementación del proyecto

Este documento describe el estado actual del backend, módulo por módulo, y la responsabilidad de cada archivo. Es una guía de lectura: conviene recorrerla junto al código.

## 1. Qué funciona hoy

El backend ya permite ejecutar un flujo mínimo completo:

```text
pasajero se registra e inicia sesión
→ recibe una carga firmada en su billetera
→ chofer se registra
→ administrador habilita al chofer
→ chofer se declara disponible y reporta ubicación
→ pasajero solicita viaje
→ se crea una oferta al chofer cercano
→ chofer acepta la oferta
→ chofer marca "en camino" y "en curso"
→ finaliza: se debita saldo o queda pago_pendiente
```

El sistema usa Node.js, Express, PostgreSQL con PostGIS, ESM y SQL directo mediante `pg`.

## 2. Arquitectura y recorrido de una petición

```text
HTTP / Express
  → ruta y validación de entrada
  → caso de uso (aplicación)
  → puerto/repository inyectado
  → adaptador PostgreSQL o externo
  → respuesta HTTP / middleware de error
```

El dominio no importa Express, PostgreSQL ni librerías de infraestructura. `src/composicion.js` es el único lugar que une los adaptadores concretos con los casos de uso y rutas.

## 3. Arranque y archivos raíz

| Archivo | Responsabilidad |
|---|---|
| `package.json` | Declara Node 22, dependencias y comandos `dev`, `start`, `test`, `migrate`, `seed` y `setup`. |
| `package-lock.json` | Fija las versiones reales instaladas para reproducibilidad. |
| `.env.example` | Lista toda configuración necesaria sin secretos reales. La base se publica en el puerto local 5433. |
| `docker-compose.yml` | Levanta PostgreSQL con PostGIS y volumen persistente. |
| `README.md` | Explica instalación, arranque, roles y acceso del administrador de desarrollo. |
| `src/servidor.js` | Arranca Express y realiza apagado ordenado ante `SIGTERM`/`SIGINT`. |
| `src/composicion.js` | Crea pool PostgreSQL, repositorios, hash Argon2, JWT, casos de uso y rutas. |
| `src/config/env.js` | Lee y valida variables de entorno con Zod; evita que el proceso arranque con configuración incompleta. |

## 4. Dominio

| Archivo | Qué representa |
|---|---|
| `src/dominio/errores.js` | `ErrorDeDominio`: error con un código estable que la capa HTTP traduce a una respuesta segura. |
| `src/dominio/usuarios/roles.js` | Los cuatro roles: pasajero, chofer, operador y administrador. |
| `src/dominio/billetera/dinero.js` | Rechaza importes no enteros o negativos. El dinero se expresa en centavos, nunca con punto flotante. |
| `src/dominio/billetera/billetera.js` | Calcula saldo sumando cargas y restando consumos. No existe un saldo mutable. |
| `src/dominio/viajes/estadosViaje.js` | Estados permitidos del viaje, incluido `pago_pendiente`. |
| `src/dominio/viajes/tarifa.js` | Calcula distancia Haversine y estimación de precio desde parámetros de tarifa. |
| `src/dominio/puertos/*.js` | Contratos conceptuales para repositorios y verificación de webhook. Hoy sirven como documentación de las dependencias del dominio; se pueden convertir a interfaces más estrictas al crecer el proyecto. |

## 5. Autenticación y usuarios

### Flujo

1. `POST /auth/register` recibe email, contraseña, rol y, si corresponde, vehículo.
2. La contraseña se hashea con Argon2id.
3. Se inserta usuario; un pasajero recibe billetera y un chofer recibe perfil inicialmente no habilitado.
4. `POST /auth/login` verifica el hash y emite un JWT.
5. El middleware Bearer valida ese JWT en rutas protegidas.

| Archivo | Responsabilidad |
|---|---|
| `src/infra/autenticacion/contrasenasArgon2.js` | Adaptador para hashear/verificar contraseñas con Argon2id y costos configurables. |
| `src/infra/autenticacion/tokensJwt.js` | Emite y valida JWT con `sub` (id de usuario) y rol. |
| `src/aplicacion/autenticacion/registrarUsuario.js` | Caso de uso que limita el registro público a pasajero/chofer y crea el token inicial. |
| `src/aplicacion/autenticacion/iniciarSesion.js` | Caso de uso de login y transformación a usuario público, sin exponer hash. |
| `src/infra/db/repositorioUsuariosPostgres.js` | Inserta y consulta usuarios con SQL parametrizado; crea billetera o perfil de chofer dentro de una transacción. |
| `src/infra/http/autenticacion.js` | Middleware `requiereAutenticacion`: extrae `Authorization: Bearer ...` y deja identidad en `req.autenticacion`. |
| `src/infra/http/rutasAutenticacion.js` | Endpoints `/auth/register`, `/auth/login` y `/auth/me`, con validación Zod estricta. |

## 6. Billetera y webhook de carga

### Garantías actuales

- El cliente/proveedor firma el cuerpo exacto con HMAC-SHA256.
- Una firma inválida se rechaza antes de crear movimientos.
- `eventoExternoId` es único: un reintento no acredita dos veces.
- Un movimiento es inmutable en PostgreSQL: no se actualiza ni borra.
- El saldo se consulta como suma de movimientos.

| Archivo | Responsabilidad |
|---|---|
| `src/infra/externos/verificadorWebhookHmac.js` | Calcula y compara HMAC de manera segura con `timingSafeEqual`. |
| `src/aplicacion/billetera/procesarCargaWebhook.js` | Verifica firma y delega la carga al repositorio. |
| `src/infra/db/repositorioBilleterasPostgres.js` | Deduplica el evento, bloquea la billetera, inserta la carga y calcula saldo. |
| `src/infra/http/rutasBilletera.js` | `POST /billetera/webhooks/cargas` y `GET /billetera/me`. |

El body parser en `src/infra/http/app.js` conserva `req.cuerpoCrudo`; esto es imprescindible porque volver a serializar JSON puede cambiar los bytes y romper una firma válida.

## 7. Viajes, ubicación y ofertas

### Solicitud

`POST /viajes` exige pasajero autenticado, valida coordenadas, obtiene parámetros activos y crea el viaje en estado `solicitado`. La tarifa actual es una estimación de desarrollo basada en tarifa base, kilómetros redondeados, minutos estimados y velocidad promedio.

### Chofer y PostGIS

El chofer habilitado puede usar:

- `PUT /choferes/me/disponibilidad`
- `PUT /choferes/me/ubicacion`

La posición actual va a `ubicaciones_actuales_chofer` con índice GiST. El historial va a otra tabla para que posteriormente pueda aplicarse una política de retención.

### Oferta y aceptación

`POST /viajes/:viajeId/ofertas` busca el chofer habilitado/disponible más cercano en un radio temporal de 5 km, con `ST_DWithin` de PostGIS, y crea una oferta de 30 segundos.

`POST /ofertas/:ofertaId/aceptar` bloquea, dentro de una transacción, la oferta, el viaje y el perfil del chofer. Luego confirma la asignación y deja al chofer no disponible. El índice parcial de PostgreSQL impide dos viajes activos para un chofer.

| Archivo | Responsabilidad |
|---|---|
| `src/aplicacion/viajes/solicitarViaje.js` | Caso de uso de solicitud: obtiene tarifa y persiste viaje. |
| `src/infra/db/repositorioViajesPostgres.js` | SQL de viaje, búsqueda geográfica, oferta, aceptación transaccional, cambios de estado y cobro final. |
| `src/infra/db/repositorioChoferesPostgres.js` | Disponibilidad, habilitación y actualización atómica de posiciones. |
| `src/infra/http/rutasViajes.js` | Solicitar, consultar viaje propio y generar oferta. |
| `src/infra/http/rutasOfertas.js` | Aceptar oferta como chofer. |
| `src/infra/http/rutasChoferes.js` | Disponibilidad, ubicación, transición de estado y finalización. |
| `src/infra/http/rutasAdministracion.js` | Habilita/deshabilita choferes con rol administrador. |

## 8. Finalización y cobro

El chofer avanza mediante:

```text
asignado → chofer_en_camino → en_curso → finalizado | pago_pendiente
```

En `finalizarYCobrar` se bloquean el viaje y la billetera. Se calcula el saldo desde los movimientos ya existentes. Si alcanza, se inserta exactamente un consumo asociado al viaje y se finaliza. Si no alcanza, no se inserta débito y el viaje queda en `pago_pendiente`. Esto evita cobrar parcialmente.

La tarifa final hoy reutiliza la estimación. Falta incorporar recorrido/tiempo real para recalcularla con datos efectivos.

## 9. Persistencia y migraciones

| Archivo | Responsabilidad |
|---|---|
| `src/infra/db/postgres.js` | Crea pool `pg` y verifica conexión. |
| `src/infra/db/migrate.js` | Ejecuta los SQL de `migraciones/` ordenados. |
| `src/infra/db/seed.js` | Carga tarifa de desarrollo y administrador `admin@demo.local`. |
| `001_inicial.sql` | Usuarios, choferes, viajes, PostGIS, ofertas, eventos, billetera, webhook e idempotencia. Incluye índices y trigger de inmutabilidad. |
| `002-parametros-tarifa-y-viajes.sql` | Agrega velocidad promedio a parámetros de tarifa. |

## 10. HTTP transversal

| Archivo | Responsabilidad |
|---|---|
| `src/infra/http/app.js` | Crea Express, Helmet, CORS, JSON, contexto, health/ready y monta todas las rutas. |
| `src/infra/http/contexto.js` | Usa `AsyncLocalStorage` para asociar `x-request-id` a logs/errores. |
| `src/infra/http/errores.js` | Un único traductor de errores a JSON seguro y códigos HTTP. No devuelve stack traces. |

## 11. Tests actuales

| Archivo | Prueba |
|---|---|
| `tests/dominio/billetera.test.js` | Saldo derivado e importes sin punto flotante. |
| `tests/dominio/roles.test.js` | Roles válidos. |
| `tests/dominio/tarifa.test.js` | Tarifa de distancia cero. |
| `tests/infra/tokensJwt.test.js` | JWT válido y rechazo con otra clave. |
| `tests/infra/verificadorWebhookHmac.test.js` | Firma HMAC válida y cuerpo alterado inválido. |

## 12. Pendiente antes de la entrega final

1. Idempotencia HTTP completa para crear viajes, aceptar ofertas y finalizar/cobrar.
2. Test de al menos 50 aceptaciones simultáneas y test de dos finalizaciones contra un saldo para un solo cobro.
3. Vencimiento automático de ofertas y nueva búsqueda de candidato.
4. Cancelación concurrente contra aceptación.
5. SSE y recuperación de estado al reconectar.
6. Tarifa final desde recorrido y duración efectiva.
7. Roles operador, autorización por recurso para chofer y panel de viajes en curso.
8. Rate limiting, logs JSON completos, pruebas de seguridad e informe de mediciones con 500 choferes.

## 13. Orden recomendado para estudiar

1. `src/composicion.js` y `src/infra/http/app.js`.
2. Autenticación: ruta → caso de uso → repositorio.
3. Webhook de billetera y su transacción.
4. `repositorioViajesPostgres.js`, especialmente `aceptarOferta` y `finalizarYCobrar`.
5. Las migraciones SQL e índices parciales.
6. ADR 004, 005, 006 y 007 antes de explicar concurrencia, carga y geolocalización.
