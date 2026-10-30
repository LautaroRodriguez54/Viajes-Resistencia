ALTER TABLE parametros_tarifa
  ADD COLUMN IF NOT EXISTS velocidad_promedio_kmh INTEGER NOT NULL DEFAULT 30
  CHECK (velocidad_promedio_kmh > 0);

