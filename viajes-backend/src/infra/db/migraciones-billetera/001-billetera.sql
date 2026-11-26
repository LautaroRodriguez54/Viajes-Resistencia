-- Base `billetera` (tema 12, ADR 008). Es de la billetera y de nadie más: el rol de Viajes no
-- puede ni conectarse. Por eso no hay claves foráneas hacia `usuarios` ni `viajes`, que viven en
-- otra base: `pasajero_id` y `viaje_id` son referencias por valor.

-- La fila permite bloquear la billetera (FOR UPDATE), pero nunca guarda el saldo.
CREATE TABLE IF NOT EXISTS billeteras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pasajero_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos_billetera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billetera_id UUID NOT NULL REFERENCES billeteras(id),
  viaje_id UUID,
  tipo TEXT NOT NULL CHECK (tipo IN ('carga', 'consumo')),
  importe_centavos INTEGER NOT NULL CHECK (importe_centavos > 0),
  referencia_externa TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tipo = 'carga') OR (tipo = 'consumo' AND viaje_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_un_consumo_por_viaje
  ON movimientos_billetera (viaje_id) WHERE tipo = 'consumo';
CREATE UNIQUE INDEX IF NOT EXISTS ux_referencia_externa_billetera
  ON movimientos_billetera (referencia_externa) WHERE referencia_externa IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_movimientos_billetera_saldo ON movimientos_billetera (billetera_id, created_at);

-- El libro contable sólo admite inserciones; las correcciones se registran como movimientos nuevos.
CREATE OR REPLACE FUNCTION impedir_mutacion_movimiento_billetera()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de billetera son inmutables';
END;
$$;

DROP TRIGGER IF EXISTS tr_movimientos_billetera_inmutables ON movimientos_billetera;
CREATE TRIGGER tr_movimientos_billetera_inmutables
  BEFORE UPDATE OR DELETE ON movimientos_billetera
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_movimiento_billetera();

CREATE TABLE IF NOT EXISTS eventos_webhook_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_evento_id TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  firma_valida BOOLEAN NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('recibido', 'procesado', 'rechazado')),
  recibido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  procesado_at TIMESTAMPTZ
);

-- Eventos de otros módulos ya consumidos (por ejemplo UsuarioRegistrado de Viajes): si el
-- despachador entrega dos veces el mismo evento, el segundo no hace nada (tema 3).
CREATE TABLE IF NOT EXISTS eventos_consumidos (
  evento_id UUID PRIMARY KEY,
  tipo TEXT NOT NULL,
  procesado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox de la billetera: cada movimiento (y cada billetera nueva) deja su evento en la misma
-- transacción. De acá lee el proyector de saldos (tema 13). Las filas no se borran: con ellas
-- se reconstruye la proyección desde cero.
CREATE TABLE IF NOT EXISTS outbox_billetera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  datos JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  procesado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_outbox_billetera_pendientes
  ON outbox_billetera (created_at) WHERE procesado_at IS NULL;
