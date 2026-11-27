# viajes-web

Interfaz web de la plataforma. Sigue el diseño de `viajes-backend/docs/diseno-web/`. Para Puljiz es opcional (no suma nota); para el TP integrador de Fernández es obligatoria en TP3 (ver "Lo que piden las consignas").

## Levantarla contra el backend

En PowerShell, una línea por comando. Primero el backend (ver su README):

```powershell
cd viajes-backend
docker compose up -d
npm run setup
npm run dev                      # http://localhost:3000
```

En otra terminal, la web:

```powershell
cd viajes-web
npm install
npm run dev                      # http://localhost:5173
```

- La API se toma de `VITE_API_URL` (por defecto `http://localhost:3000`). `http://localhost:5173` ya está en `CORS_ORIGINS` del `.env.example` del backend.
- La sesión vive en `sessionStorage`: cada pestaña tiene la suya. Para la demo, abrí el pasajero en una pestaña y el chofer en otra (o en una ventana de incógnito).
- El token dura 15 min y no hay refresh: al vencer, la web vuelve a Ingresar con un aviso.

## Recorrido de la demo

1. **Chofer**: ingresá con `chofer@demo.local` / `ChoferDemo123!` (lo crea el seed, ya habilitado) y prendé **Disponible**: la web manda la ubicación cada 10 s, junto a la Plaza 25 de Mayo. Un chofer registrado en `/registro` lo tiene que habilitar el admin desde su pantalla (`admin@demo.local` / `AdminDemo123!`).
2. **Pasajero**: en otra pestaña, ingresá con `pasajero@demo.local` / `PasajeroDemo123!` (o registrá uno nuevo). La billetera arranca en 0.
3. **Pedir**: escribí Desde y Hasta (o elegí un lugar frecuente). Se marca la ruta y tocás **Pedir viaje**. La web hace `POST /viajes` (el servidor calcula el precio) y `POST /viajes/:id/ofertas` (le ofrece el viaje al chofer más cercano), cada uno con su `Idempotency-Key`.
4. **Chofer**: en menos de 2 s aparece la oferta con el monto y la cuenta regresiva de 30 s, que sale de `venceAt`. **Aceptar**. Si otro chofer la aceptó antes, aparece "Otro chofer lo aceptó primero".
   - **Rechazar** (`POST /ofertas/:id/rechazar`): el backend se la ofrece al siguiente chofer cercano y a éste no se la vuelve a ofrecer. Si no queda ninguno, el viaje pasa a `sin_choferes_disponibles` y el pasajero ve "No encontramos chofer" con **Pedir otro viaje**.
   - **Si nadie contesta**, la oferta vence sola a los 30 s (`OFERTA_TTL_SEGUNDOS`): el backend hace lo mismo que con un rechazo. Con un solo chofer en la demo, el viaje termina en `sin_choferes_disponibles`.
5. **Chofer**: "Voy en camino" → "Pasajero a bordo: iniciar viaje" → "Finalizar y cobrar". El pasajero ve cada paso en **Mi viaje** (consulta cada 2 s). Antes de que suba el pasajero, el chofer puede **Cancelar viaje** (con confirmación y un motivo opcional); queda no disponible hasta que vuelva a prender el interruptor.
6. **Sin saldo**: el viaje termina en `pago_pendiente`, y el pasajero y el chofer ven que **no se cobró nada**. Cargá saldo con `npm run cargar-saldo -- <email> <centavos>` en `viajes-backend` (la billetera se actualiza sola cada 5 s) y tocá **Pagar ahora**.
7. **Admin** (`admin@demo.local`): habilitá a un chofer recién registrado y cambiá la tarifa con **Guardar tarifa nueva**. El próximo viaje que se pida ya usa la nueva.

## Qué está conectado

| Ruta | Pantalla | Endpoints |
|---|---|---|
| `/ingresar` | 1 · Ingresar | `POST /auth/login` |
| `/registro` | Registro pasajero / chofer | `POST /auth/register` (entra directo) |
| `/pasajero/pedir` | 2 · Pedir viaje | `POST /viajes`, `POST /viajes/:id/ofertas`, `GET /billetera/me` |
| `/pasajero/viaje` | 3 · Mi viaje | `GET /viajes/:id` cada 2 s (el id llega desde Pedir; si se entra por el menú, sale de `GET /viajes?limite=1`); "Buscar chofer de nuevo" sólo si el viaje no tiene una oferta vigente (`tieneOfertaVigente`); "Cancelar viaje" con confirmación (`POST /viajes/:id/cancelar`). Con chofer asignado: el **auto se mueve en el mapa** (`viaje.chofer.ubicacion`), su vehículo, la patente y los minutos estimados. Al terminar, el **comprobante** |
| `/pasajero/billetera` | 4 · Billetera | `GET /billetera/me`, `GET /viajes?limite=50` ("Mis viajes": **sólo los viajes completos**, `finalizado` o `pago_pendiente`; los cancelados o sin chofer no movieron plata y no se muestran) y `GET /billetera/me/movimientos` cada 5 s, con un ícono por tipo; `POST /viajes/:id/reintentar-cobro`. **Tocar un viaje abre su comprobante** (imprimible o en PDF) |
| `/chofer` | 5 · Chofer | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion`, `GET /choferes/me/ofertas`, `GET /choferes/me/viaje-actual`, `POST /ofertas/:id/aceptar`, `POST /ofertas/:id/rechazar`, `POST /choferes/viajes/:id/estado`, `POST /choferes/viajes/:id/finalizar`, `POST /choferes/viajes/:id/cancelar` (en asignado o en camino, con motivo opcional). La oferta entra animada, **suena, vibra y el título de la pestaña parpadea**. Con "Voy en camino" el chofer de la demo **avanza por la ruta** de OSRM hasta el retiro y después hasta el destino, y manda cada posición (`PUT /choferes/me/ubicacion` cada 2,5 s). Al finalizar, el comprobante |
| `/operador` | 6 · Operador | `GET /operador/viajes?estado=activos` cada 5 s, `POST /operador/viajes/:id/cancelar` (motivo obligatorio) y `POST /operador/viajes/:id/reintentar-cobro` en los `pago_pendiente` (rama 12) |
| `/admin` | 7 · Admin | **Panel en vivo** con `GET /admin/metricas` cada 3 s (viajes activos, choferes disponibles, por habilitar, pagos pendientes, lag p99 del event loop con gráfica y objetivo de 50 ms, memoria). `GET /admin/choferes` cada 10 s con **Habilitar** (`PATCH /admin/choferes/:id/habilitacion`), `GET /admin/tarifa` y **Guardar tarifa nueva** (`POST /admin/tarifa` con `Idempotency-Key`; los importes se pasan a centavos con `parsearImporte`, sin `parseFloat`) |

Cómo está armado:
- **`src/api/cliente.js`** es el único lugar que llama a la API. Agrega el JWT en `Authorization` (nunca en la URL), manda `Idempotency-Key` y traduce `error.codigo` a un mensaje.
- **`src/ganchos.js`**:
  - `usarConsultaPeriodica` reemplaza al SSE mientras no exista.
  - `usarClaveIdempotente` mantiene **una clave por intención**: si se corta la conexión, el reintento manda la misma clave y el servidor no repite la operación. Con una respuesta (éxito o 4xx), la clave se renueva.
- **`src/sesion.jsx`**: la sesión y la guarda de ruta por rol. Es sólo comodidad: el que autoriza es el backend.
- Los `data-testid` de cada pantalla son para los E2E con Playwright.

**Falta en el backend** (la web lo resuelve así mientras tanto):
- Estimación antes de pedir: el precio aparece al pedir.
- Nombres de los lugares: hechos (migración 007). Pedir los manda y todas las pantallas los muestran. Para los viajes anteriores, la web busca la dirección aproximada con Photon (una vez por punto).
- Patente, vehículo y posición del chofer: hechos (`GET /viajes/:id`, sólo mientras el viaje está activo).
- El movimiento del chofer de la demo lo simula la web; un chofer real mandaría su GPS al mismo endpoint.
- Cancelar: hecho (rama 12). El pasajero cancela desde Mi viaje con confirmación en la tarjeta, mientras el viaje está pedido, asignado o con el chofer en camino. El operador cancela con un motivo obligatorio y reintenta el cobro de un `pago_pendiente` desde su pantalla, que ya usa `GET /operador/viajes?estado=activos` (#26). El chofer cancela desde su tarjeta mientras el viaje está asignado o en camino.
- Vencimiento de la ubicación: activo desde el #34 (`UBICACION_TTL_SEGUNDOS=60`). El chofer manda su ubicación cada 10 s, así que mientras tiene la pestaña abierta nunca vence.

## Mapa (OpenStreetMap, sin clave)

Google Maps pide tarjeta de crédito para habilitar la facturación, así que se usa OpenStreetMap (ADR 011, Decisión 4). No hace falta cuenta, clave ni configuración:

- **Mapa**: Leaflet con los mosaicos de OpenStreetMap (`src/componentes/MapaReal.jsx`). La atribución "© OpenStreetMap" es obligatoria y queda siempre a la vista.
- **Buscar direcciones**: en Pedir, "Desde" y "Hasta" buscan con **Photon** mientras se escribe, dentro de Resistencia (`src/componentes/CampoLugar.jsx`). Con el campo vacío ofrece los lugares frecuentes.
- **Ruta por calles**: **OSRM**, en azul. Para el chofer se suma el tramo punteado hasta el retiro (`src/mapas/rutas.js`). Es sólo visual: **la tarifa la calcula el backend**.
- **Pedir arranca vacía**, con el estado "Conectado" (o "Sin conexión" si el servidor no responde). No muestra un viaje ni una ruta hasta que se eligen los dos puntos.
- **Sin internet**, o con `VITE_MAPA=simulado` en `.env.local`: se usan el dibujo del diseño (`MapaSimulado.jsx`) y la lista fija de lugares. Así la demo, la CI y los E2E no dependen de servicios externos.
- **Privacidad**: lo que se escribe en "Desde"/"Hasta" viaja a `photon.komoot.io` y los puntos del viaje a `router.project-osrm.org`. Son servidores públicos para **uso moderado**: la web espera 300 ms entre teclas, busca desde 3 letras y pide cada ruta una sola vez.
- **CSP** (`vite.config.js`): sólo se agregan esos tres orígenes (imágenes de los mosaicos, y conexiones a Photon y OSRM). No entra ningún script de terceros.

## Lo que piden las consignas

**Puljiz:** el frontend es opcional y no suma; "empezar por el frontend" es un error frecuente. Por eso la web va después de lo obligatorio del backend.

**Fernández, TP integrador** (`CONSIGNA FERNANDEZ.docx`, TP3 y RNF-15): "cliente web responsivo común o conjunto coherente de interfaces que permita ejecutar los recorridos críticos **sin invocar manualmente cada API**". Puede ser una web común del consorcio; si no, ésta tiene que cubrir lo siguiente. Lo que exija nuestro módulo lo fija el Acta de Alcance.

- [x] **Responsiva** (rama 11): las 7 pantallas se usan en un celular, sólo con CSS (`src/estilos.css`, al final). Probado a 390 × 844 y a 360 × 640: nada más ancho que la pantalla, todo lo que se toca mide al menos 44 px y los inputs tienen letra de 16 px (con menos, el iPhone hace zoom). En las pantallas con mapa, la tarjeta pasa a ser una hoja inferior y el dibujo se corre para que la ruta (pasajero) o "Vos" y el retiro (chofer) queden a la vista. El encabezado ocupa dos renglones, con el email cortado y pestañas a lo ancho. En la computadora no cambia nada.
- [ ] **Estados claros** en cada acción (RNF-15): espera (cargando, buscando chofer), confirmación, rechazo, cancelación, error y **recuperación** (reintentar, volver a un estado válido). Los mensajes salen de `error.codigo` vía `src/api/cliente.js`.
- [ ] **Recorrido de viaje inmediato completo** desde la interfaz: ingresar → pedir → asignación → arribo → inicio → viaje → tarifa → pago → comprobante o aviso.
  - Pedir: elegir **tipo de vehículo auto/moto** (RF-5.1, 7.1).
  - Chofer: botón **"Llegué"** (RF-6.3) e **inicio con QR o código de un solo uso** que muestra el pasajero (RF-6.4, 8.3).
  - Cancelar **con motivo** también para el pasajero y el chofer (RF-6.6, 6.7), no sólo el operador.
  - Al terminar: **calificar** al chofer y al pasajero, una sola vez por viaje (RF-2.5, 3.7) y ver/descargar el **comprobante** (RF-8.4).
- [ ] **Recorrido de reserva completo** (M9): pantalla para reservar con fecha, hora y zona horaria; ver, reprogramar y cancelar con motivo (RF-9.1, 9.6, 9.7); al activarse, sigue como un viaje normal.
- [ ] Billetera: mostrar reintegros y cargos de cancelación como movimientos (RF-7.4, 7.5).
- [~] Admin: la pantalla está conectada (choferes por habilitar y tarifa). Falta la habilitación con aprobar, observar, suspender o rechazar con motivo (RF-3.4), no sólo "Habilitar".
- [ ] Mostrar el caso de concurrencia en vivo (ya está el aviso "Otro chofer lo aceptó primero") y una falla parcial controlada (p. ej. pago que no responde → "no se cobró nada, se reintenta").
- [ ] Sin datos sensibles en URLs (RNF-19): el JWT nunca en la URL ni en el QR.
- [ ] Si el consorcio arma tests End-to-End sobre contenedores, que esta web se pueda levantar como contenedor más (Dockerfile con el build estático).

Perfil del cliente, direcciones frecuentes y preferencias (RF-2.1–2.3) y vehículos y documentación del chofer (RF-3.2, 3.3) son de M2 y M3: se suman sólo si quedan en nuestro alcance o si la web es la común del consorcio.
