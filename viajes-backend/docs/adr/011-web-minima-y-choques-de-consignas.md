# ADR 011 - Web mínima, consulta periódica en lugar de SSE y choques entre consignas

- Estado: aceptado en lo que es de la web y la consulta periódica; **propuesto** en los choques con el TP integrador, hasta que Fernández los apruebe en el Acta de Alcance
- Fecha: 2026-11-26
- Participantes: Agustín Valussi (redacción e implementación de la web); a revisar por Lucas Escobar y Lautaro Rodríguez
- Reemplaza en parte: ADR 006, en lo que dice del seguimiento en tiempo real

## Contexto

Pregunta: **¿cuánta interfaz hacemos y cómo se entera la pantalla de lo que pasa en el servidor, si dos consignas piden cosas distintas?**

- Para Puljiz el frontend es opcional y no suma nota. El enunciado advierte que "empezar por el frontend" es un error frecuente.
- Para el TP3 de Fernández, un cliente web responsivo es **obligatorio** para recorrer los dos recorridos críticos sin llamar a la API a mano.
- El ADR 006 eligió SSE para que el pasajero siga el viaje. El SSE todavía no está hecho, y `EventSource` no permite mandar el header `Authorization`, así que haría falta un ticket corto de un solo uso. Poner el JWT en la URL está prohibido (RNF-19).
- Al conectar la web (rama 5), el chofer no tenía ningún `GET` para enterarse de su oferta ni de su viaje.

El mismo repo también tiene que cumplir el TP integrador, que en algunos puntos pide otra cosa que lo que ya decidimos. Esos choques se juntan acá para tener un solo lugar donde defenderlos.

## Decisión 1: una web mínima, hecha después del backend obligatorio

La web (`viajes-web/`, React + Vite) tiene lo justo para recorrer los flujos y explicar el backend en la defensa:

- **Conectados a la API**: pasajero (pedir, mi viaje y billetera con "Pagar ahora") y chofer (disponibilidad, oferta con la carrera de la aceptación, avanzar y finalizar).
- **Con datos de ejemplo y un aviso visible**: operador y admin, hasta que existan sus endpoints.
- `src/api/cliente.js` es el único lugar que llama a la API: agrega el JWT, manda `Idempotency-Key` (ADR 010) y traduce `error.codigo` a un mensaje. La web nunca decide por el texto del error.
- La tarifa, el saldo y la elegibilidad se calculan **siempre en el servidor**. El cliente sólo manda coordenadas e intenciones.
- La sesión vive en `sessionStorage`, una por pestaña: en la demo el pasajero y el chofer están abiertos a la vez.
- Al principio se usaban una lista fija de lugares de Resistencia, todos a 5 km o menos de la plaza, y un mapa simulado. Desde la Decisión 4 hay un mapa real con búsqueda de direcciones, y la lista y el dibujo quedan como respaldo. El chofer está en una posición fija junto a la plaza: con el GPS real de la PC de la demo quedaría fuera del radio de búsqueda.

Se hizo **después** de la billetera, la idempotencia y el OpenAPI, que eran lo obligatorio para Puljiz.

## Decisión 2: consulta periódica cada 2 s en lugar de SSE, por ahora

`usarConsultaPeriodica` (en `viajes-web/src/ganchos.js`) consulta cada cierto tiempo y se detiene al llegar a un estado terminal:

| Pantalla | Endpoint | Cada |
|---|---|---|
| Pasajero · Mi viaje | `GET /viajes/:viajeId` | 2 s |
| Chofer · Oferta (sólo si está disponible y sin viaje) | `GET /choferes/me/ofertas` | 2 s |
| Chofer · Viaje en curso | `GET /choferes/me/viaje-actual` | 2 s |
| Pasajero · Billetera | `GET /billetera/me` y `GET /viajes/:viajeId` | 5 s |
| Pasajero · Pedir (saldo) | `GET /billetera/me` | 10 s |

El chofer, además, manda su ubicación cada 10 s (`PUT /choferes/me/ubicacion`).

- Las dos lecturas del chofer se sumaron en la rama 5 (PR #17). Son de sólo lectura y no toman bloqueos. Si no hay nada, responden `200` con `null`, no `404`: "no hay oferta" es el caso normal de una consulta que se repite, no un error.
- La cuenta regresiva de la oferta sale de `venceAt`, que manda el servidor. Desde el PR #22, el servidor vence la oferta aunque el chofer cierre la pestaña.

### Opciones consideradas

1. **Consulta periódica (elegida por ahora).** Usa los mismos endpoints con JWT, no suma ningún estado de conexión y se prueba igual que cualquier `GET`. Costo: hasta 2 s de demora y pedidos aunque no haya cambios.
2. **SSE con ticket de un solo uso (lo del ADR 006).** Es lo que corresponde para la ubicación del chofer en vivo, pero requiere el ticket, `Last-Event-ID`, la recuperación de estado al reconectar y un test de quién ve la posición de quién. Es mucho para la rama de la web.
3. **WebSocket.** Bidireccional, pero ningún flujo necesita que el cliente empuje mensajes. Ya lo había descartado el ADR 006.

## Decisión 3: cómo resolvemos los choques con el TP integrador (propuesta)

| Choque | Lo que ya teníamos | Lo que pide Fernández | Propuesta | Estado |
|---|---|---|---|---|
| Mensajería | Sólo Postgres: outbox + despachador por consulta periódica (ADR 008 y 009) | RNF-10: RabbitMQ o una alternativa aprobada (TP2) | Pedir que se apruebe el outbox en Postgres. Si no lo aprueba, mantener el outbox y sumar un publicador a RabbitMQ: el outbox sigue evitando perder eventos entre el COMMIT y la publicación, y sólo cambia el adaptador del bus | A confirmar con Fernández |
| Caché y TTL de ubicación | PostGIS en Postgres (ADR 007) | RNF-11: Redis o una alternativa aprobada; RF-4.3: TTL de ubicación | TTL en Postgres: `UBICACION_TTL_SEGUNDOS` filtra por `reportada_at` al buscar candidatos (PR #22). No hace falta Redis | Hecho en el PR #22; falta aprobarlo |
| Identidad | JWT propio (ADR 003) | RF-1.4: otros módulos validan el token; RF-1.6: OAuth/OIDC | Si M1 lo hace otro grupo, validar sus tokens detrás de un puerto; nuestro JWT queda para el modo aislado | Depende del Acta |
| Nombres | `pasajero`, `chofer` | "cliente", "conductor" | En el código quedan los nuestros. El OpenAPI tiene la tabla de equivalencias | Hecho |
| Forma del sistema | Un backend con todo | 9 módulos de distintos grupos | Monolito modular con una base por módulo (ADR 008). Nuestro módulo del Word se publica como imagen propia; el resto queda como mock o alternativa | Depende del Acta |
| Documentación de la API | `docs/api.md` | OpenAPI versionado | `docs/openapi.yaml` es la fuente; `api.md` es un índice. Swagger UI en un contenedor aparte | Hecho |

## Decisión 4: mapas con OpenStreetMap en lugar de Google Maps (26/11/2026)

El diseño de la web pedía Google Maps (mapa, Places y Routes). Google exige una cuenta de facturación con tarjeta aunque el uso quede dentro del crédito gratis, y no tiene sentido pedírsela a un integrante para un TP. Por eso se usa **OpenStreetMap**, gratis, sin cuenta y sin clave:

| Para qué | Con Google (descartado) | Elegido |
|---|---|---|
| Mapa | Maps JavaScript API | **Leaflet 1.9.4** (BSD-2, versión fija) con los mosaicos de `tile.openstreetmap.org` |
| Buscar direcciones mientras se escribe | Places Autocomplete | **Photon** (`photon.komoot.io`), sobre datos de OSM. Nominatim, el buscador oficial, prohíbe el autocompletado en su política de uso |
| Ruta por calles | Routes API desde el backend | **OSRM** (`router.project-osrm.org`), el servidor público de demostración |

Cómo se usa, en `viajes-web/src/mapas/` y `src/componentes/`:

- `Mapa.jsx` elige el mapa. Usa `MapaReal.jsx` (Leaflet) salvo que `VITE_MAPA=simulado`, o que los mosaicos no carguen porque no hay internet. En esos casos vuelve solo al dibujo del diseño (`MapaSimulado.jsx`) y a la lista fija de lugares. **El clon limpio, la CI y los E2E no dependen de ningún servicio externo.**
- El buscador (`CampoLugar.jsx`) busca dentro del rectángulo de Resistencia, desde 3 letras, con 300 ms de espera entre teclas y cancelando el pedido anterior. Con el campo vacío ofrece los lugares frecuentes.
- La ruta (`rutas.js`) se pide una vez por par de puntos y queda en memoria: la consulta periódica de 2 s no la vuelve a pedir. Si OSRM no responde, quedan sólo los marcadores, nunca una línea recta, que sería engañosa.
- **La tarifa no cambia**: la sigue calculando el backend con sus reglas. La ruta es sólo visual.
- **CSP**: sólo se agregan las imágenes de `tile.openstreetmap.org` y las conexiones a `photon.komoot.io` y `router.project-osrm.org`. No entra ningún script de terceros. Con `VITE_MAPA=simulado` no se agrega nada.
- La atribución "© OpenStreetMap" es obligatoria: se ubica en la esquina que la tarjeta no tapa.

Costos y riesgos a defender:

- **Uso moderado**: los servidores públicos de OSM, Photon y OSRM son para tráfico bajo (OSRM, como mucho 1 consulta por segundo). Alcanza para el TP. Un producto real usaría servidores propios (las tres cosas se pueden instalar con Docker) o un proveedor pago.
- **Privacidad**: lo que el pasajero escribe en "Desde"/"Hasta" va a Photon, y los puntos del viaje van a OSRM. Son servicios de terceros, igual que lo habría sido Google. Al backend sólo van coordenadas.
- **Nombres**: el backend guarda coordenadas, no nombres. La web recuerda en la pestaña (`sessionStorage`) el nombre de lo que eligió el pasajero. El chofer no lo conoce, así que, si la dirección no es un lugar frecuente, ve las coordenadas, hasta que el backend guarde la dirección del viaje.

Opciones descartadas: **Google Maps** (tarjeta obligatoria); **MapLibre con mosaicos vectoriales** (más pesado y con más piezas que defender para lo mismo); **sólo el dibujo** (no cumple el "mapa con la ruta" del diseño ni se ve real en la demo).

## Consecuencias

- Los recorridos 1 a 5 (pedir, ofertar, aceptar con carrera, avanzar, finalizar y cobrar, incluido `pago_pendiente` y "Pagar ahora") se pueden hacer desde la web. El recorrido 6 (operador) todavía no.
- Cada consulta de 2 s abierta suma 0,5 pedidos por segundo: un chofer disponible hace 1 por segundo entre la oferta y el viaje actual. Para la demo no importa. Con muchos choferes conectados, la consulta suma carga de lectura que el SSE no tendría, y conviene tenerla en cuenta al medir el bloque 7.
- La web todavía no es responsiva, que es obligatorio en el TP3, y le faltan Google Maps, el historial y los movimientos. Está en `viajes-web/README.md`. *(Actualización del 26/11: la responsiva está en el #35, el historial y los movimientos en el #28, y los mapas con OpenStreetMap en la Decisión 4.)*
- Los choques marcados "a confirmar" no se tocan en el código hasta tener la respuesta de Fernández. Si cambian, se modifica el adaptador correspondiente, no el dominio.

## Qué nos haría cambiar

- La ubicación del chofer en vivo en el mapa del pasajero: ahí 2 s de demora se notan y conviene el SSE con ticket.
- Que las mediciones del bloque 7 muestren que la consulta periódica pesa en el tiempo de asignación.
- Que Fernández no apruebe el outbox o el TTL en Postgres: se suma RabbitMQ o Redis detrás del puerto que ya existe.
