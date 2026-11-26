# ADR 004 - Resolveremos asignación, cancelación y cobro con bloqueo pesimista y orden global

- Estado: aceptado
- Fecha: 2026-11-26
- Participantes: Lucas Escobar, Agustín Valussi
- Complementado por: [ADR 008](008-base-de-datos-por-servicio.md) (separación de `billetera` en base propia y cobro en dos pasos)

## Contexto

El flujo de viajes tiene carreras concurrentes inevitables bajo `READ COMMITTED`:
1. Múltiples choferes intentando aceptar ofertas del mismo viaje o de viajes distintos.
2. Múltiples pasajeros compitiendo por los mismos choferes cercanos en `ofrecerAlChoferCercano`.
3. Vencimiento automático de ofertas, rechazo o cancelación simultánea frente a la aceptación del chofer.
4. Dos cobros concurrentes contra la billetera del mismo pasajero (variante D).

## Opciones consideradas

1. **Bloqueo pesimista con `SELECT ... FOR UPDATE` y orden global de bloqueo:** serializa los recursos en conflicto, evita interbloqueos mediante orden fijo y permite usar invariantes fuertes en PostgreSQL.
2. **Concurrencia optimista por columna `version`:** reduce bloqueos en lecturas, pero obliga a bucles de reintento en operaciones multi-tabla (`viajes` + `ofertas_viaje` + `perfiles_chofer`) y no resuelve la selección exclusiva de choferes cercanos.

## Decisión

Se adopta **bloqueo pesimista** en PostgreSQL bajo `READ COMMITTED` con las siguientes reglas:

1. **Orden global de bloqueos dentro de `viajes`:**
   `viajes (FOR UPDATE)` → `ofertas_viaje (ORDER BY id FOR UPDATE)` → `perfiles_chofer (FOR UPDATE)`
   Todas las transacciones de oferta, aceptación, rechazo, vencimiento y cancelación adquieren los bloqueos estrictamente en ese orden para impedir ciclos de interbloqueo (`40P01`).
2. **Selección de candidatos con `SKIP LOCKED` y revalidación post-bloqueo:**
   `ofrecerAlChoferCercano` y el re-ofrecimiento seleccionan con `FOR UPDATE OF p SKIP LOCKED` y revalidan elegibilidad dentro de un `SAVEPOINT` una vez tomado el bloqueo sobre `p`, para ver commits recientes en `READ COMMITTED`. El vencimiento automático toma viajes con `FOR UPDATE OF v SKIP LOCKED` para permitir múltiples instancias del backend.
3. **Defensa en profundidad mediante índices únicos parciales:**
   - `ux_chofer_un_viaje_activo` sobre `viajes (chofer_id)` en `('asignado', 'chofer_en_camino', 'en_curso')`.
   - `ux_una_oferta_aceptada_por_viaje` sobre `ofertas_viaje (viaje_id)` en `('aceptada')`.
   - `ux_oferta_pendiente_viaje_chofer` sobre `ofertas_viaje (viaje_id, chofer_id)` en `('pendiente')`.
   - `ux_un_consumo_por_viaje` sobre `movimientos_billetera (viaje_id)` en `('consumo')` (en la base `billetera`).
4. **Alineación con ADR 008 (cobro en dos pasos):**
   Al separarse `billetera` en su propia base, el cobro ya no ocurre en una única transacción con `finalizar`. En su lugar, `en_curso → pago_pendiente` se confirma primero en `viajes` y luego `cobrarViajePendiente` mantiene el bloqueo `FOR UPDATE` del viaje mientras `billetera.cobrar` bloquea la fila de `billeteras` en su base (orden `viaje → billetera`, idempotente por `viajeId`).

## Consecuencias

- Las carreras sobre el mismo viaje o billetera se serializan de forma determinística sin reintentos en aplicación ni pérdidas de consistencia.
- La latencia de contención en `viajes` queda acotada a transacciones cortas, salvo el paso de cobro en `billetera` (que requerirá timeout HTTP si `billetera` se extrae a un servicio remoto).

## Qué nos haría cambiar

- Necesidad de escalar `viajes` a alto volumen distribuido entre múltiples regiones o particiones, donde convendría migrar a colas particionadas por zona o sagas explícitas.
