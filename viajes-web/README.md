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

1. **Chofer**: registrate como chofer en `/registro`. Un admin lo habilita: con `admin@demo.local` / `AdminDemo123!`, `PATCH /admin/choferes/:choferId/habilitacion` desde `viajes-backend/docs/requests.http` (la pantalla Admin todavía no está conectada). Volvé a ingresar y prendé **Disponible**: la web manda la ubicación cada 10 s, junto a la Plaza 25 de Mayo.
2. **Pasajero**: registrate como pasajero. Al entrar, la billetera está en 0.
3. **Pedir**: elegí Desde y Hasta y tocá **Pedir viaje**. La web hace `POST /viajes` (el servidor calcula el precio) y `POST /viajes/:id/ofertas` (le ofrece el viaje al chofer más cercano), cada uno con su `Idempotency-Key`.
4. **Chofer**: en menos de 2 s aparece la oferta con el monto y la cuenta regresiva de 30 s, que sale de `venceAt`. **Aceptar**. Si otro chofer la aceptó antes, aparece "Otro chofer lo aceptó primero".
5. **Chofer**: "Voy en camino" → "Pasajero a bordo: iniciar viaje" → "Finalizar y cobrar". El pasajero ve cada paso en **Mi viaje** (consulta cada 2 s).
6. **Sin saldo**: el viaje termina en `pago_pendiente`, y el pasajero y el chofer ven que **no se cobró nada**. Cargá saldo con `npm run cargar-saldo -- <email> <centavos>` en `viajes-backend` (la billetera se actualiza sola cada 5 s) y tocá **Pagar ahora**.

## Qué está conectado

| Ruta | Pantalla | Endpoints |
|---|---|---|
| `/ingresar` | 1 · Ingresar | `POST /auth/login` |
| `/registro` | Registro pasajero / chofer | `POST /auth/register` (entra directo) |
| `/pasajero/pedir` | 2 · Pedir viaje | `POST /viajes`, `POST /viajes/:id/ofertas`, `GET /billetera/me` |
| `/pasajero/viaje` | 3 · Mi viaje | `GET /viajes/:id` cada 2 s (el id llega desde Pedir; si se entra por el menú, sale de `GET /viajes?limite=1`); "Buscar chofer de nuevo" |
| `/pasajero/billetera` | 4 · Billetera | `GET /billetera/me`, `GET /viajes` ("Mis viajes" y la deuda) y `GET /billetera/me/movimientos` cada 5 s; `POST /viajes/:id/reintentar-cobro` |
| `/chofer` | 5 · Chofer | `PUT /choferes/me/disponibilidad`, `PUT /choferes/me/ubicacion`, `GET /choferes/me/ofertas`, `GET /choferes/me/viaje-actual`, `POST /ofertas/:id/aceptar`, `POST /choferes/viajes/:id/estado`, `POST /choferes/viajes/:id/finalizar` |
| `/operador` | 6 · Operador | **Datos de ejemplo** (faltan los endpoints del operador) |
| `/admin` | 7 · Admin | **Datos de ejemplo** (falta listar choferes y administrar tarifas) |

Cómo está armado:
- **`src/api/cliente.js`** es el único lugar que llama a la API. Agrega el JWT en `Authorization` (nunca en la URL), manda `Idempotency-Key` y traduce `error.codigo` a un mensaje.
- **`src/ganchos.js`**:
  - `usarConsultaPeriodica` reemplaza al SSE mientras no exista.
  - `usarClaveIdempotente` mantiene **una clave por intención**: si se corta la conexión, el reintento manda la misma clave y el servidor no repite la operación. Con una respuesta (éxito o 4xx), la clave se renueva.
- **`src/sesion.jsx`**: la sesión y la guarda de ruta por rol. Es sólo comodidad: el que autoriza es el backend.
- Los `data-testid` de cada pantalla son para los E2E con Playwright.

**Falta en el backend** (la web lo resuelve así mientras tanto):
- Estimación antes de pedir: el precio aparece al pedir.
- Lugares con Places: hay una lista fija de lugares de Resistencia en `src/datos/lugares.js`, todos a menos de 5 km de la plaza.
- Patente y vehículo en el viaje: no se muestran.
- Cancelar con motivo y rechazar la oferta: "Rechazar" sólo oculta la oferta en esa pestaña.
- Vencimiento de la ubicación: un chofer que cierra la pestaña sin apagar "Disponible" sigue recibiendo ofertas.
- Google Maps: el mapa sigue siendo el dibujo del diseño (`MapaSimulado.jsx`).

## Lo que piden las consignas

**Puljiz:** el frontend es opcional y no suma; "empezar por el frontend" es un error frecuente. Por eso la web va después de lo obligatorio del backend.

**Fernández, TP integrador** (`CONSIGNA FERNANDEZ.docx`, TP3 y RNF-15): "cliente web responsivo común o conjunto coherente de interfaces que permita ejecutar los recorridos críticos **sin invocar manualmente cada API**". Puede ser una web común del consorcio; si no, ésta tiene que cubrir lo siguiente. Lo que exija nuestro módulo lo fija el Acta de Alcance.

- [ ] **Responsiva:** que se use en el celular (el pasajero y el chofer la van a abrir ahí). Hoy las tarjetas flotan sobre el mapa pensadas para escritorio.
- [ ] **Estados claros** en cada acción (RNF-15): espera (cargando, buscando chofer), confirmación, rechazo, cancelación, error y **recuperación** (reintentar, volver a un estado válido). Los mensajes salen de `error.codigo` vía `src/api/cliente.js`.
- [ ] **Recorrido de viaje inmediato completo** desde la interfaz: ingresar → pedir → asignación → arribo → inicio → viaje → tarifa → pago → comprobante o aviso.
  - Pedir: elegir **tipo de vehículo auto/moto** (RF-5.1, 7.1).
  - Chofer: botón **"Llegué"** (RF-6.3) e **inicio con QR o código de un solo uso** que muestra el pasajero (RF-6.4, 8.3).
  - Cancelar **con motivo** también para el pasajero y el chofer (RF-6.6, 6.7), no sólo el operador.
  - Al terminar: **calificar** al chofer y al pasajero, una sola vez por viaje (RF-2.5, 3.7) y ver/descargar el **comprobante** (RF-8.4).
- [ ] **Recorrido de reserva completo** (M9): pantalla para reservar con fecha, hora y zona horaria; ver, reprogramar y cancelar con motivo (RF-9.1, 9.6, 9.7); al activarse, sigue como un viaje normal.
- [ ] Billetera: mostrar reintegros y cargos de cancelación como movimientos (RF-7.4, 7.5).
- [ ] Admin/operador: habilitación con aprobar, observar, suspender o rechazar con motivo (RF-3.4), no sólo "Habilitar".
- [ ] Mostrar el caso de concurrencia en vivo (ya está el aviso "Otro chofer lo aceptó primero") y una falla parcial controlada (p. ej. pago que no responde → "no se cobró nada, se reintenta").
- [ ] Sin datos sensibles en URLs (RNF-19): el JWT nunca en la URL ni en el QR.
- [ ] Si el consorcio arma tests End-to-End sobre contenedores, que esta web se pueda levantar como contenedor más (Dockerfile con el build estático).

Perfil del cliente, direcciones frecuentes y preferencias (RF-2.1–2.3) y vehículos y documentación del chofer (RF-3.2, 3.3) son de M2 y M3: se suman sólo si quedan en nuestro alcance o si la web es la común del consorcio.
