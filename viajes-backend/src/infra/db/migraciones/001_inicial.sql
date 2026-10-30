CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('pasajero', 'chofer', 'operador', 'administrador')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_normalizado ON usuarios (lower(email));

CREATE TABLE IF NOT EXISTS perfiles_chofer (
  usuario_id UUID PRIMARY KEY REFERENCES usuarios(id),
  patente TEXT NOT NULL UNIQUE,
  marca_vehiculo TEXT NOT NULL,
  modelo_vehiculo TEXT NOT NULL,
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  disponible BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La tabla permite bloquear una fila de billetera, pero nunca guarda el saldo.
CREATE TABLE IF NOT EXISTS billeteras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pasajero_id UUID NOT NULL UNIQUE REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parametros_tarifa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_centavos INTEGER NOT NULL CHECK (base_centavos >= 0),
  por_kilometro_centavos INTEGER NOT NULL CHECK (por_kilometro_centavos >= 0),
  por_minuto_centavos INTEGER NOT NULL CHECK (por_minuto_centavos >= 0),
  maximo_viaje_centavos INTEGER NOT NULL CHECK (maximo_viaje_centavos > 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (maximo_viaje_centavos >= base_centavos)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_parametros_tarifa_activo ON parametros_tarifa (activo) WHERE activo;

CREATE TABLE IF NOT EXISTS viajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pasajero_id UUID NOT NULL REFERENCES usuarios(id),
  chofer_id UUID REFERENCES perfiles_chofer(usuario_id),
  estado TEXT NOT NULL CHECK (estado IN (
    'solicitado', 'asignado', 'chofer_en_camino', 'en_curso', 'finalizado',
    'pago_pendiente', 'cancelado_pasajero', 'cancelado_chofer', 'sin_choferes_disponibles'
  )),
  origen GEOGRAPHY(POINT, 4326) NOT NULL,
  destino GEOGRAPHY(POINT, 4326) NOT NULL,
  estimacion_centavos INTEGER NOT NULL CHECK (estimacion_centavos >= 0),
  tarifa_final_centavos INTEGER CHECK (tarifa_final_centavos >= 0),
  solicitado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_at TIMESTAMPTZ,
  iniciado_at TIMESTAMPTZ,
  finalizado_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS ix_viajes_pasajero_solicitado ON viajes (pasajero_id, solicitado_at DESC);
CREATE INDEX IF NOT EXISTS ix_viajes_estado_solicitado ON viajes (estado, solicitado_at);
CREATE INDEX IF NOT EXISTS ix_viajes_origen_gist ON viajes USING GIST (origen);

-- Defensa en base de datos: un chofer no puede tener dos viajes activos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chofer_un_viaje_activo
  ON viajes (chofer_id)
  WHERE estado IN ('asignado', 'chofer_en_camino', 'en_curso');

CREATE TABLE IF NOT EXISTS ofertas_viaje (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id UUID NOT NULL REFERENCES viajes(id),
  chofer_id UUID NOT NULL REFERENCES perfiles_chofer(usuario_id),
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'vencida')),
  vence_at TIMESTAMPTZ NOT NULL,
  respondida_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ofertas_viaje_pendientes ON ofertas_viaje (viaje_id, estado, vence_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_una_oferta_aceptada_por_viaje
  ON ofertas_viaje (viaje_id) WHERE estado = 'aceptada';

CREATE TABLE IF NOT EXISTS eventos_viaje (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viaje_id UUID NOT NULL REFERENCES viajes(id),
  tipo TEXT NOT NULL,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_eventos_viaje_reproduccion ON eventos_viaje (viaje_id, id);

-- Última posición para búsqueda indexada y control de disponibilidad.
CREATE TABLE IF NOT EXISTS ubicaciones_actuales_chofer (
  chofer_id UUID PRIMARY KEY REFERENCES perfiles_chofer(usuario_id),
  ubicacion GEOGRAPHY(POINT, 4326) NOT NULL,
  reportada_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ubicaciones_actuales_gist ON ubicaciones_actuales_chofer USING GIST (ubicacion);

-- Historial separado: la política de retención se documentará antes de cargar volumen real.
CREATE TABLE IF NOT EXISTS historial_ubicaciones_chofer (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chofer_id UUID NOT NULL REFERENCES perfiles_chofer(usuario_id),
  ubicacion GEOGRAPHY(POINT, 4326) NOT NULL,
  reportada_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_historial_ubicaciones_chofer_fecha
  ON historial_ubicaciones_chofer (chofer_id, reportada_at DESC);

CREATE TABLE IF NOT EXISTS movimientos_billetera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billetera_id UUID NOT NULL REFERENCES billeteras(id),
  viaje_id UUID REFERENCES viajes(id),
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

CREATE TABLE IF NOT EXISTS claves_idempotencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES usuarios(id),
  ambito TEXT NOT NULL,
  clave TEXT NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('procesando', 'completada', 'fallida')),
  respuesta_status SMALLINT CHECK (respuesta_status BETWEEN 100 AND 599),
  respuesta_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (actor_id, ambito, clave)
);


