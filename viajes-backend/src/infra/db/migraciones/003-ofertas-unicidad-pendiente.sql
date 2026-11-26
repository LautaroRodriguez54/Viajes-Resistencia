-- Impide emitir más de una oferta pendiente simultánea al mismo chofer para el mismo viaje.
CREATE UNIQUE INDEX IF NOT EXISTS ux_oferta_pendiente_viaje_chofer
  ON ofertas_viaje (viaje_id, chofer_id)
  WHERE estado = 'pendiente';
