# Logs del backend en Grafana Cloud

El backend genera registros HTTP con Pino. `capturar-logs.mjs` conserva sólo tiempo, método, estado y duración; Grafana Alloy lee ese archivo y lo envía a Loki en Grafana Cloud. No envía rutas, identificadores, cuerpos, credenciales ni mensajes de error. El colector es independiente de las métricas de la rama de backend.

Uso para desarrollo local en Windows y Docker Desktop:

1. En Grafana Cloud obtener URL de Loki con `/loki/api/v1/push`, ID de usuario de Loki y un token con permiso `logs:write`. El token personal de k6 no es necesariamente válido para Loki.
2. Copiar `.env.example` a `.env` en esta carpeta y completar los tres valores. `.env` está ignorado por Git. No publicar credenciales ni capturas con el token.
3. Configurar la terminal del backend para apuntar a las bases de prueba deseadas; reiniciar el servidor de prueba desde `viajes-backend` con `node ../observabilidad/capturar-logs.mjs --iniciar-backend`. Dejar esa terminal abierta. El archivo se crea en `observabilidad/logs/backend.log`.
4. En otra terminal, desde `observabilidad`, ejecutar `docker compose up -d` y comprobar `docker compose logs --tail=50`. No compartir registros que contengan credenciales.
5. Generar tráfico con `Invoke-RestMethod http://localhost:3000/health` y abrir Grafana > Explore > Loki. Consultar `{app="viajes-backend",entorno="pruebas"}` con intervalo de últimos 15 minutos.
6. Para importar el dashboard incluido: Grafana > Dashboards > New > Import, seleccionar `dashboard-backend.json` y elegir la fuente Loki del stack. Muestra pedidos y errores del intervalo seleccionado, p95 de los últimos 5 minutos, pedidos y errores por minuto y registros HTTP. Si no hay pedidos recientes, el panel p95 indica que no hay datos. El valor cero de errores solo refleja los logs recibidos, no garantiza que el colector esté funcionando.

Detener Alloy con `docker compose stop`. Los datos del archivo local y del volumen de Alloy permanecen hasta su eliminación explícita. El registro exportado refleja sólo solicitudes HTTP terminadas; no reemplaza métricas de CPU, memoria o event loop. La prueba local contiene sólo datos de desarrollo. La salida HTTP y los logs se envían a Grafana Cloud y están sujetos a la retención y límites de la cuenta.
