-- Historial de viajes (tema 13, ADR 009): una fila por viaje con su último estado conocido.
-- La alimentan los eventos `ViajeCambiado` de `outbox_viajes` y la lee GET /viajes.
-- `version` es la de la fila en la base `viajes`: un evento sólo se aplica si trae una versión más
-- nueva, así un evento repetido o atrasado no pisa un estado posterior.
-- No hay claves foráneas: pasajero y chofer viven en otra base (tema 12).

CREATE TABLE IF NOT EXISTS historial_viajes (
  viaje_id UUID PRIMARY KEY,
  pasajero_id UUID NOT NULL,
  chofer_id UUID,
  estado TEXT NOT NULL,
  origen_latitud DOUBLE PRECISION NOT NULL,
  origen_longitud DOUBLE PRECISION NOT NULL,
  destino_latitud DOUBLE PRECISION NOT NULL,
  destino_longitud DOUBLE PRECISION NOT NULL,
  estimacion_centavos INTEGER NOT NULL,
  tarifa_final_centavos INTEGER,
  solicitado_at TIMESTAMPTZ NOT NULL,
  asignado_at TIMESTAMPTZ,
  iniciado_at TIMESTAMPTZ,
  finalizado_at TIMESTAMPTZ,
  cancelado_at TIMESTAMPTZ,
  motivo_cancelacion TEXT,
  version INTEGER NOT NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_historial_viajes_pasajero
  ON historial_viajes (pasajero_id, solicitado_at DESC);
