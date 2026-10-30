# ADR 006 - Usamos SSE para seguimiento y HMAC para el webhook simulado

- Estado: aceptado
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

El pasajero necesita actualizaciones de viaje y posición; las cargas de billetera llegan por un proveedor simulado verificable.

## Opciones consideradas

1. SSE y webhook HMAC propio: unidireccional, simple de probar con HTTP y sin proveedor externo; requiere reconexión documentada.
2. WebSocket y proveedor externo: más bidireccionalidad/realismo; más estados de conexión y dependencia operativa.

## Decisión

Usaremos SSE para servidor a cliente y un webhook interno firmado con HMAC-SHA256.

## Consecuencias

La ubicación entrará por HTTP autenticado; se definirá `Last-Event-ID` y la recuperación de estado al reconectar.

## Qué nos haría cambiar

Un requisito real de mensajería bidireccional persistente desde el cliente.

