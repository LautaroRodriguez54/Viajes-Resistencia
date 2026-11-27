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

## Rampa gradual y estrés exploratorio

`estres-viajes.js` incrementa usuarios virtuales gradualmente a 2, 10 y 30, mantiene cada nivel durante 30 s y baja a cero. Cada usuario espera un segundo entre iteraciones. En total dura aproximadamente 2 minutos y 30 segundos y crea cientos de viajes, eventos y claves de idempotencia: ejecutar únicamente contra backend local con las tres bases descartables. La confirmación explícita evita ejecuciones accidentales, pero no detecta por sí sola qué bases usa el servidor.

```powershell
k6 run -e ENTORNO_DESCARTABLE=1 --summary-export=carga/resultado-estres.json carga/estres-viajes.js
```

Se requiere `TOKEN_PASAJERO` en la terminal como en el escenario anterior. Los umbrales de errores y checks del 1 % son provisionales y abortan tras los primeros 20 segundos si se superan. Una finalización exitosa sólo demuestra lo ocurrido con esa carga: no identifica necesariamente el límite o punto de saturación del sistema. Registrar versión de Node, equipo, bases, número de usuarios, tiempos, errores y parámetros; repetir las corridas para poder compararlas. Resultados locales pueden contener información del entorno: revisar antes de versionarlos.

Para enviar resultados a Grafana Cloud, tras autenticar k6, ejecutar localmente:

```powershell
k6 cloud run --local-execution --no-archive-upload -e "TOKEN_PASAJERO=$env:TOKEN_PASAJERO" -e ENTORNO_DESCARTABLE=1 carga/estres-viajes.js
```

La ejecución local transmite métricas y logs de k6 a Grafana Cloud y consume cuota. Mantener el token fuera de capturas y archivos versionados. El escenario usa una sola cuenta compartida y cubre únicamente la creación de viajes; no simula conductores, geolocalización ni el viaje completo.
