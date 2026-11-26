# Revisión pendiente: validaciones de seguridad

**Estado:** Pendiente de revisión e integración  
**Motivo:** Se detectaron fallos durante las pruebas automatizadas de validación de entradas.  
**Importante:** No modificar código productivo hasta coordinar la revisión con el resto del equipo.

## 1. Resultado de las pruebas

Archivo: `tests/seguridad/validacionEntradas.test.js`

- Tests ejecutados: 12
- Correctos: 6
- Fallidos: 6

## 2. Hallazgos

### 2.1. Validación del estado de un viaje

**Archivo:** `src/infra/http/rutasChoferes.js`  
**Endpoint:** `POST /choferes/viajes/:viajeId/estado`

Problemas:
- Los estados no permitidos generan un error Zod que termina respondiendo HTTP 500 en lugar de 400.
- Se aceptan campos adicionales en el body.
- Los UUID inválidos generan HTTP 500.

Correcciones sugeridas:
- Definir un esquema Zod estricto para el body completo.
- Utilizar `safeParse()` para validar el estado y el identificador.
- Convertir los errores de validación en `ErrorDeDominio('ENTRADA_INVALIDA', ...)`.

### 2.2. Validación del identificador al consultar un viaje

**Archivo:** `src/infra/http/rutasViajes.js`  
**Endpoint:** `GET /viajes/:viajeId`

Problema:
- No se valida explícitamente el UUID antes de consultar el caso de uso.
- Un identificador inválido termina respondiendo 404 en lugar de 400.

Corrección sugerida:
- Validar el UUID antes de ejecutar `buscarViajePropio()`.

### 2.3. Manejo global de errores

**Archivo:** `src/infra/http/errores.js`

Problema:
- El middleware solamente traduce errores de tipo `ErrorDeDominio`.
- Los errores de Zod y los errores internos del parser JSON terminan como HTTP 500.

Correcciones sugeridas:
- Reconocer errores de Zod y responder HTTP 400.
- Reconocer JSON malformado generado por Express y responder HTTP 400.
- Mantener respuestas genéricas sin exponer detalles internos.

### 2.4. Límite del cuerpo de las solicitudes

**Archivo:** `src/infra/http/app.js`

Configuración actual:
- `express.json({ limit: '100kb', strict: true })`

Problema:
- El límite está configurado correctamente, pero una solicitud que lo supera devuelve HTTP 500.

Corrección sugerida:
- Reconocer el error `entity.too.large` en el middleware global y responder HTTP 413.

## 3. Tests que detectaron los problemas

| Test | Resultado actual | Resultado esperado |
|---|---:|---:|
| Estado no permitido | 500 | 400 |
| Campos adicionales en estado | 200 | 400 |
| UUID inválido al actualizar estado | 500 | 400 |
| UUID inválido al consultar viaje | 404 | 400 |
| JSON malformado | 500 | 400 |
| Body superior a 100 KB | 500 | 413 |

Los otros seis tests del archivo pasaron correctamente.

## 4. Plan de revisión

1. Esperar la integración de los cambios del resto del equipo.
2. Revisar nuevamente los archivos afectados.
3. Comprobar si los problemas continúan presentes.
4. Corregir las validaciones y el manejo global de errores.
5. Ejecutar nuevamente `validacionEntradas.test.js`.
6. Ejecutar toda la suite de seguridad y posteriormente la suite completa.

## 5. Comando de verificación

```powershell
node --test .\tests\seguridad\validacionEntradas.test.js
```

**Criterio de aceptación:** los 12 tests deben pasar sin modificar sus expectativas para adaptarse a respuestas incorrectas del backend.