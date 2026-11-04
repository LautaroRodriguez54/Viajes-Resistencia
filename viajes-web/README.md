# viajes-web

Interfaz web opcional (no suma nota). Sigue el diseño de `viajes-backend/docs/diseno-web/`.

Desde la raíz del repo (en PowerShell, una línea por comando):

```powershell
cd viajes-web
npm install
npm run dev     # http://localhost:5173
```

## Estado

Sólo diseño visual, **sin conexión al backend**. Los datos salen de `src/datos/ejemplo.js`, que tiene la misma forma que van a devolver los endpoints.

| Ruta | Pantalla | Estado |
|---|---|---|
| `/ingresar` | 1 · Ingresar | Visual (Entrar navega a `/pasajero/pedir`) |
| `/registro` | Registro pasajero / chofer | Visual |
| `/pasajero/pedir` | 2 · Pasajero · Pedir viaje | Visual, mapa simulado |
| `/pasajero/viaje` | 3 · Pasajero · Mi viaje | Visual, mapa simulado con el chofer |
| `/pasajero/billetera` | 4 · Pasajero · Billetera | Visual |
| — | 5 Chofer, 6 Operador, 7 Admin | Pendiente |

El mapa es el dibujo del diseño (`MapaSimulado.jsx`); se reemplaza por Google Maps (`@vis.gl/react-google-maps`) al conectar.
