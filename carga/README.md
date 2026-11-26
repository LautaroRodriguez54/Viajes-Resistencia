# Prueba local de carga con k6

`viajes.js` mide solicitudes concurrentes de creación de viajes. Sólo admite API en localhost y requiere un token de pasajero de prueba. **Cada iteración crea un viaje y sus eventos**: usar exclusivamente un backend y bases descartables, nunca las bases habituales con datos que se quieran conservar.

Con k6 instalado y el backend aislado ejecutándose, obtener un token de una cuenta de prueba mediante el login, sin guardarlo en archivos versionados. En PowerShell:

```powershell
$env:TOKEN_PASAJERO='<token de una cuenta de prueba>'
k6 run -e VUS=2 -e DURATION=30s carga/viajes.js
Remove-Item Env:TOKEN_PASAJERO
```

`BASE_URL`, `VUS`, `DURATION` y `PAUSA` son configurables con `-e`. Comenzar con el valor mínimo, luego diseñar rampas y estrés de forma gradual. El resumen de k6 incluye percentiles de duración, solicitudes por segundo y errores. Los umbrales de 99% son provisionales, no son exigencias confirmadas de la cátedra; acordar objetivos y registrar entorno, comandos, carga y resultados de al menos tres corridas antes de concluir.

Este primer escenario no simula todavía 500 choferes, ubicación ni asignaciones; queda pendiente preparar usuarios por VU, escenarios representativos y mediciones comparables. No subir tokens ni resultados que contengan datos sensibles.
