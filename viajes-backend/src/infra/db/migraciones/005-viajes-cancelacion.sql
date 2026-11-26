-- Agrega cancelado_operador, metadatos de cancelación e índice para el panel de viajes activos.
ALTER TABLE viajes DROP CONSTRAINT IF EXISTS viajes_estado_check;
ALTER TABLE viajes ADD CONSTRAINT viajes_estado_check CHECK (estado IN (
  'solicitado', 'asignado', 'chofer_en_camino', 'en_curso', 'finalizado',
  'pago_pendiente', 'cancelado_pasajero', 'cancelado_chofer',
  'cancelado_operador', 'sin_choferes_disponibles'
));

ALTER TABLE viajes ADD COLUMN IF NOT EXISTS cancelado_at TIMESTAMPTZ;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS cancelado_por_id UUID REFERENCES usuarios(id);
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;

CREATE INDEX IF NOT EXISTS ix_viajes_activos_operador
  ON viajes (solicitado_at DESC)
  WHERE estado IN ('solicitado', 'asignado', 'chofer_en_camino', 'en_curso', 'pago_pendiente');
