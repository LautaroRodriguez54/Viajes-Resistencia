# Diseño de la interfaz web

Referencia visual para `viajes-web/`. Acordado el 3/11/2026. Lienzo con las 7 pantallas y las notas de endpoints (HECHO / FALTA): https://claude.ai/artifact/V4dJiPEoog8HZrJ3F9zJ6W

Los `.html` de esta carpeta son el código de cada pantalla del lienzo. Fuera del editor no se ven exactamente igual (usan su motor: `support.js`, `{{...}}`, `<sc-if>`), pero todos los estilos están en línea y sirven para copiar valores al armar los componentes de React. Los links internos apuntan a los nombres del lienzo (`Main.dc.html`, etc.).

| Archivo | Pantalla |
|---|---|
| `01-ingresar.html` | Ingresar |
| `02-pasajero-pedir.html` | Pasajero · Pedir viaje |
| `03-pasajero-mi-viaje.html` | Pasajero · Mi viaje |
| `04-pasajero-billetera.html` | Pasajero · Billetera (incluye historial) |
| `05-chofer.html` | Chofer · Oferta con vista previa |
| `06-operador.html` | Operador |
| `07-admin.html` | Admin |

## Principios

- **Básica:** la web sirve para explicar el backend en la defensa. Cuanto menos tenga, mejor, pero tiene que funcionar y verse prolija.
- **No copiar a Uber:** nada de barra negra, paneles laterales ni estadísticas.
- **Una acción principal por pantalla:** Pedir, Cancelar, Cargar, Aceptar, Habilitar.
- **Los colores de estado se usan sólo para estados.** El resto es neutro y azul.
- **Los mensajes muestran las reglas del backend:** "No se cobró nada" (cobro nunca parcial), "Otro chofer lo aceptó primero" (carrera de la aceptación), motivo obligatorio al cancelar.

## Tokens

| Uso | Valor |
|---|---|
| Fondo de página | `#F2F0EB` |
| Tarjeta | `#FFFFFF`, borde `1px solid #E4E0D8`, radio `20px` |
| Tarjeta sobre el mapa | sin borde, sombra `0 4px 18px rgba(32,33,36,.16)` |
| Texto | `#1C1B19` |
| Texto secundario | `#67635C` |
| Separadores | `#EEEBE5` |
| Borde de inputs | `#D6D1C7`, alto `46px`, radio `12px` |
| Acento (botón principal, links, progreso) | `#3346D3` (hover de links `#1F2E9E`) |
| Éxito: pagado, disponible, habilitar | texto `#1F7A4D`, fondo `#E3F2EA` |
| Advertencia: pago pendiente, sin pagar | texto `#8A3F05`, fondo `#FBEBD6` |
| Peligro: cancelar, carrera perdida | texto `#B42318`, fondo `#FCE9E7` |
| Ruta en el mapa | `#1A73E8` con borde `#1557B0` |
| Destino en el mapa | pin `#EA4335` |

- **Tipografía:** Outfit (Google Fonts), pesos 400/500/600/700. Base `15px`, títulos de tarjeta `22–24px` en 600, montos con `font-variant-numeric: tabular-nums`.
- **Botones:** alto mínimo `44px` (principal `48–52px`), radio `12px`. Principal: fondo acento y texto blanco. Secundario: blanco con borde `#D6D1C7`.
- **Chips de estado:** `13px`, peso 600, radio `999px`, padding `4px 10px`.
- **Encabezado:** a la izquierda un punto azul de `12px` + "Viajes Resistencia"; en el medio la navegación del rol (el activo subrayado en azul); a la derecha "Rol · Salir".

## Pantallas

- **Ingresar:** tarjeta centrada con email, contraseña, "Entrar" y link a registro (pasajero o chofer).
- **Pasajero · Pedir:** mapa de Google a pantalla completa con la ruta. Tarjeta flotante arriba a la izquierda (`380px`) con Desde/Hasta (Places Autocomplete), distancia y tiempo, precio grande, "Pedir viaje" y el saldo.
- **Pasajero · Mi viaje:** mismo mapa con el auto del chofer en vivo (etiqueta con patente y minutos) y el camino punteado al retiro. La tarjeta muestra el estado (chip), el título "Llega en N minutos", el vehículo y la patente, el progreso en 4 pasos (Pedido, Asignado, En camino, En viaje), el precio estimado y "Cancelar viaje".
- **Pasajero · Billetera:** sin mapa, columna de `480px`. Saldo grande + "Cargar $ 100", aviso de viaje sin pagar, "Mis viajes" (recorrido, fecha, estado, monto) y "Movimientos".
- **Chofer:** mapa con la vista previa del viaje ofrecido: "Vos", camino punteado hasta "Retiro", ruta azul y "Destino". Arriba al centro, notificación tipo push (`440px`): "Viajes Resistencia · ahora", segundos restantes, "Nuevo viaje" + monto, recorrido, distancia al retiro y del viaje, barra de 30 s (roja en los últimos 5), Rechazar/Aceptar. Abajo a la izquierda, píldora "Disponible · enviando ubicación" con interruptor.
- **Operador:** columna de `640px` con los viajes activos (recorrido, detalle y chip de estado). El viaje seleccionado despliega motivo obligatorio + "Cancelar viaje".
- **Admin:** columna de `640px` con los choferes por habilitar (vehículo, patente, email, "Habilitar") y la tarifa (base, por km, por minuto, máximo, "Guardar tarifa nueva").

## Mapa

- Google Maps con `@vis.gl/react-google-maps`, centrado en Resistencia (aprox. `-27.451, -58.986`). El mapa del diseño es un dibujo simulado.
- La ruta y el precio los calcula el backend (Routes API detrás del puerto `calculadorRutas`, con caída a Haversine). El navegador sólo dibuja.
- Claves y restricciones: ver "Mapas y seguridad" en `CLAUDE.md`.
