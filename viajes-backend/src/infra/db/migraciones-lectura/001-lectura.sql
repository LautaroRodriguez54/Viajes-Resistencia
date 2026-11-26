-- Base `lectura` (tema 13, ADR 009): proyecciones para mostrar, alimentadas por eventos.
-- Nunca se decide un cobro con estos datos: el cobro suma los movimientos en la base `billetera`.

CREATE TABLE IF NOT EXISTS saldos (
  pasajero_id UUID PRIMARY KEY,
  saldo_centavos BIGINT NOT NULL DEFAULT 0,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eventos ya aplicados: si un evento llega dos veces, la segunda no suma (tema 3).
CREATE TABLE IF NOT EXISTS eventos_aplicados (
  evento_id UUID PRIMARY KEY,
  aplicado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
