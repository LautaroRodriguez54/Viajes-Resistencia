-- Carga de saldo desde la web (pasarela de pagos simulada). El pasajero pide cargar un importe y
-- queda una intención `pendiente`; al confirmar el pago, la pasarela manda el webhook firmado de
-- siempre con `eventoExternoId = checkout-<id>`, y recién ahí la intención pasa a `pagada`.
-- La acreditación la sigue haciendo sólo el webhook (con su dedupe por eventoExternoId).
CREATE TABLE IF NOT EXISTS intenciones_carga (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pasajero_id UUID NOT NULL,
  importe_centavos INTEGER NOT NULL CHECK (importe_centavos > 0),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagada_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_intenciones_carga_pasajero ON intenciones_carga (pasajero_id, created_at);
