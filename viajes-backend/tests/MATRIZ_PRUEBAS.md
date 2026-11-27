# Matriz de pruebas del backend

Esta matriz permite presentar cada tema sin confundir pruebas de dominio, integración y seguridad. Ejecutar desde `viajes-backend` con Node 22, PostgreSQL de prueba preparado y `DATABASE_URL` apuntando a `viajes_test`: `npm test`. Sin esa variable las pruebas de base se omiten.

| Tema | Archivos | Evidencia principal |
| --- | --- | --- |
| Billetera y tarifa | `dominio/billetera.test.js`, `dominio/tarifa.test.js`, `aplicacion/cobroDeViajes.test.js` | Centavos, límites, cobro completo o pendiente y recuperación. |
| Cobro con PostgreSQL | `integracion/repositorioBilleterasPostgres.test.js`, `integracion/repositorioViajesPostgres.test.js` | Persistencia, inmutabilidad y cobros concurrentes reales. Complementa la capa de dominio. |
| Idempotencia y eventos | `infra/idempotenciaHttp.test.js`, `integracion/idempotenciaHttp.test.js`, `integracion/outbox.test.js` | Repetición, solicitudes simultáneas, entregas duplicadas y recuperación. |
| Bases separadas y CQRS | `integracion/repositorioBilleterasPostgres.test.js`, `integracion/proyeccionSaldos.test.js` | Propiedad de datos, proyección y reconstrucción. |
| Ofertas y concurrencia | `concurrencia/aceptacionOfertas.test.js`, `infra/concurrenciaOfertasUnit.test.js`, `integracion/ofertasVencimientoRechazo.test.js` | Aceptación simultánea, bloqueo, rechazo y vencimiento. |
| Cancelación y operador | `dominio/estadosViaje.test.js`, `concurrencia/cancelacionVsAceptacion.test.js`, `integracion/operadorViajes.test.js` | Reglas por rol, carreras y operaciones del operador. |
| Seguridad: identidad y autorización | `seguridad/autenticacion.test.js`, `seguridad/autorizacion.test.js`, `infra/tokensJwt.test.js` | Tokens, roles y propiedad de recursos. |
| Seguridad: entradas y errores | `seguridad/validacionEntradas.test.js`, `seguridad/validacionYRateLimit.test.js`, `seguridad/prototypePollution.test.js`, `seguridad/inyeccionSql.test.js` | Esquemas, parser, contaminación de prototipos e inyección SQL. |
| Seguridad: tasa y cabeceras | `seguridad/rateLimiting.test.js`, `seguridad/validacionYRateLimit.test.js`, `seguridad/headersCors.test.js`, `infra/cabecerasSeguridad.test.js` | Límite HTTP, respuesta 429, CORS y CSP. |

## Consolidación del 26/11/2026

Se integró `origin/main` en la rama de testing. Se eliminaron de `validacionEntradas.test.js` los casos repetidos de estado inválido, campos extra, UUID inválidos, JSON inválido y cuerpo excesivo; permanecen en `validacionYRateLimit.test.js`, que además comprueba códigos y `requestId`. En la prueba de validación de chofer se añadió la aserción de que no se ejecutan los casos de uso con entrada inválida. Se conservaron escenarios similares en memoria y PostgreSQL por cubrir capas distintas.

El archivo `rateLimiting.test.js` conserva cuatro escenarios omitidos que representan propuestas no implementadas, no pruebas aprobadas. Login válido y fallido tienen coberturas complementarias en los dos archivos de tasa; no se eliminaron. Consolidaciones adicionales deben preservar sus aserciones y casos especiales.

Resultado de la suite integrada con Node 22.23.5 y PostgreSQL de prueba: **221 pruebas, 217 aprobadas, 0 fallidas y 4 omitidas**. Las omitidas son las propuestas de rate limiting indicadas arriba. No se modificó la base de desarrollo por esta ejecución.
