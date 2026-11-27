# Revisión de pruebas — 26 de noviembre de 2026

## Alcance y base

Revisión del árbol local en `feature/testing-backend`, commit `3feece79`, con cambios locales preexistentes. Se leyeron primero los dos informes históricos de `tests/seguridad/`. No se revisaron las ramas de PR posteriores como si estuvieran integradas.

## Cambios realizados

- `seguridad/rateLimiting.test.js`: se actualizó la aplicación de prueba con repositorio de idempotencia en memoria, TTL y logger completo. Se configuró un límite de cinco solicitudes para probar el límite de login de forma controlada; no cambia la configuración de producción.
- Se conservaron marcadas como `skip` cuatro pruebas que expresan propuestas no implementadas: excluir los logins exitosos del límite y limitar las ofertas por usuario. No son pruebas aprobadas ni requisitos confirmados. El login actual contabiliza solicitudes exitosas y fallidas; la creación de ofertas no tiene ese limitador.
- No se cambió código productivo ni se eliminaron archivos. Los informes históricos se conservaron como evidencia de su momento.

## Solapamientos

`validacionEntradas.test.js` y `validacionYRateLimit.test.js` cubren algunos casos comunes de validación y parser, pero no son archivos idénticos: el primero cubre otras entradas y el segundo agrega comprobaciones de errores, registros y limitadores. `rateLimiting.test.js` se solapa en login con el segundo, pero contiene escenarios propuestos que no están allí. No se eliminó ninguno: consolidar sin perder aserciones requiere separar y trasladar casos, no borrar un archivo completo.

## Resultados

Con Node 22.23.5 y `DATABASE_URL=postgres://viajes:viajes@localhost:5433/viajes_test`, ejecución final `node --test --test-concurrency=1 --test-reporter=spec`: **206 pruebas, 202 aprobadas, 0 fallidas, 4 omitidas**. Las bases de integración se usaron para pruebas.

La primera ejecución arrojó 199 aprobadas y 7 fallidas: seis por el montaje obsoleto de `rateLimiting.test.js` y otra falla cuya salida completa no se conservó. La prueba de concurrencia `SKIP LOCKED` pasó al repetirla y en la ejecución final; una ejecución exitosa no descarta la carrera intermitente conocida, tratada en el PR #21 aún no integrado en esta base.

## Pendientes

- Acordar con el equipo si se desea limitar ofertas y excluir logins exitosos; implementar y activar las pruebas correspondientes si se adopta esa política.
- Revisar la carrera de ofertas y volver a ejecutar la suite cuando se integren los PR #21 y #22.
- Consolidar los casos parcialmente repetidos preservando sus aserciones y cobertura; los archivos actuales no son duplicados completos.
