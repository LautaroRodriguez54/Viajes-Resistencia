# Registro de cambios de pruebas E2E

## 27/11/2026

- `autenticacion.spec.js`: agrega registro de pasajero, cierre de sesión y recuperación de un inicio de sesión fallido.
- `cancelacion.spec.js`: agrega solicitud y cancelación confirmada de un viaje desde la interfaz, verificando el estado devuelto por el backend.
- Se conserva `viaje.spec.js`, que cubre un tema distinto: asignación, avance del viaje y pago pendiente.
- Validación local: 4 casos aprobados en Chromium, con servidor y ejecución de Playwright en Node 22.23.5, web en modo mapa simulado y bases descartables.
- Pendientes: rechazo y vencimiento de ofertas, pago tras cargar saldo y recuperación ante otros fallos. El registro prepara datos reales de desarrollo y requiere un entorno aislado.

## Ampliación contra main actualizado

- `ofertas.spec.js`: prueba el rechazo y el vencimiento real de una oferta, comprueba el estado sin choferes desde la web y desde la API, y desactiva al chofer de prueba.
- `viaje.spec.js`: extiende el flujo de pago pendiente con un webhook de carga firmado, reintento desde la billetera y verificación de un único movimiento de consumo.
- CI aumenta el límite de login exclusivamente para el proceso E2E: las pruebas de rate limiting continúan en el trabajo del backend.
- Suite local completa: 6 casos aprobados con Node 22.23.5, Chromium y las tres bases descartables tras integrar `main`.
- Los escenarios no cubren todos los fallos posibles ni reemplazan las pruebas unitarias e integración.
