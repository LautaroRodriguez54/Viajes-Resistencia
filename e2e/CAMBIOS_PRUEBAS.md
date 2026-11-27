# Registro de cambios de pruebas E2E

## 27/11/2026

- `autenticacion.spec.js`: agrega registro de pasajero, cierre de sesión y recuperación de un inicio de sesión fallido.
- `cancelacion.spec.js`: agrega solicitud y cancelación confirmada de un viaje desde la interfaz, verificando el estado devuelto por el backend.
- Se conserva `viaje.spec.js`, que cubre un tema distinto: asignación, avance del viaje y pago pendiente.
- Validación local: 4 casos aprobados en Chromium, con servidor y ejecución de Playwright en Node 22.23.5, web en modo mapa simulado y bases descartables.
- Pendientes: rechazo y vencimiento de ofertas, pago tras cargar saldo y recuperación ante otros fallos. El registro prepara datos reales de desarrollo y requiere un entorno aislado.
