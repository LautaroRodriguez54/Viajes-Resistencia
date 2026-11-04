# viajes-web

Interfaz web de la plataforma. Sigue el diseño de `viajes-backend/docs/diseno-web/`. Para Puljiz es opcional (no suma nota); para el TP integrador de Fernández es obligatoria en TP3 (ver "Lo que piden las consignas").

Desde la raíz del repo (en PowerShell, una línea por comando):

```powershell
cd viajes-web
npm install
npm run dev     # http://localhost:5173
```

## Estado

Sólo diseño visual, **sin conexión al backend**. Los datos salen de `src/datos/ejemplo.js`, que tiene la misma forma que van a devolver los endpoints. "Entrar" acepta cualquier email y contraseña; si el email empieza con `chofer`, `operador` o `admin` entra con ese rol (cualquier otro, como pasajero).

| Ruta | Pantalla | Estado |
|---|---|---|
| `/ingresar` | 1 · Ingresar | Visual |
| `/registro` | Registro pasajero / chofer | Visual |
| `/pasajero/pedir` | 2 · Pasajero · Pedir viaje | Visual, mapa simulado |
| `/pasajero/viaje` | 3 · Pasajero · Mi viaje | Visual, mapa simulado con el chofer |
| `/pasajero/billetera` | 4 · Pasajero · Billetera | Visual |
| `/chofer` | 5 · Chofer | Visual (cuenta regresiva de 30 s y aviso de la carrera en el navegador) |
| `/operador` | 6 · Operador | Visual (cancelar con motivo) |
| `/admin` | 7 · Admin | Visual (habilitar chofer, tarifa) |

El mapa es el dibujo del diseño (`MapaSimulado.jsx`); se reemplaza por Google Maps (`@vis.gl/react-google-maps`) al conectar.

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
