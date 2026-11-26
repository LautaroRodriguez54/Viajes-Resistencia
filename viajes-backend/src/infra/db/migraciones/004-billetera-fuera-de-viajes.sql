-- Tema 12 (ADR 008): la billetera pasa a su propia base (`billetera`, migraciones-billetera/).
-- Viajes ya no guarda datos de la billetera. El runner vuelve a aplicar 001 en cada corrida y 001
-- crea estas tablas con IF NOT EXISTS, así que esta migración las vuelve a borrar: el resultado
-- final siempre es una base `viajes` sin tablas de billetera.
DROP TABLE IF EXISTS movimientos_billetera;
DROP TABLE IF EXISTS billeteras;
DROP TABLE IF EXISTS eventos_webhook_pago;
DROP FUNCTION IF EXISTS impedir_mutacion_movimiento_billetera();

-- Outbox de Viajes: el evento se inserta en la misma transacción que el cambio que lo causa
-- (por ejemplo, el registro de un pasajero) y un despachador lo entrega después. Si el proceso se
-- cae entre el COMMIT y la entrega, el evento sigue acá y se entrega al volver.
CREATE TABLE IF NOT EXISTS outbox_viajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  datos JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  procesado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_outbox_viajes_pendientes
  ON outbox_viajes (created_at) WHERE procesado_at IS NULL;
