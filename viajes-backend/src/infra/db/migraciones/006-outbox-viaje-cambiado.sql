-- Historial de viajes (tema 13, ADR 009): cada cambio de una fila de `viajes` deja en `outbox_viajes`
-- un evento `ViajeCambiado` con la foto completa de la fila, en la misma transacción del cambio.
-- De ahí lo toma el proyector de `historial_viajes` en la base `lectura`.
--
-- Se hace con un trigger, no en cada método del repositorio: así un UPDATE nuevo queda cubierto
-- sin que nadie se acuerde de emitir el evento. Como el runner reaplica todas las migraciones en
-- cada `npm run setup`, todo es idempotente (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, NOT EXISTS).

-- 1. La versión sube siempre. El repositorio ya hace `version = version + 1` en cada UPDATE; si
--    algún UPDATE no lo hiciera (un script, un test, un método nuevo), la sube el trigger. La
--    proyección usa la versión para descartar eventos viejos o repetidos.
CREATE OR REPLACE FUNCTION asegurar_version_viaje()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <= OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_viajes_version ON viajes;
CREATE TRIGGER tr_viajes_version
  BEFORE UPDATE ON viajes
  FOR EACH ROW EXECUTE FUNCTION asegurar_version_viaje();

-- 2. La foto del viaje, con las coordenadas como números (la base `lectura` no tiene PostGIS).
CREATE OR REPLACE FUNCTION foto_viaje(v viajes)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'viajeId', v.id,
    'pasajeroId', v.pasajero_id,
    'choferId', v.chofer_id,
    'estado', v.estado,
    'origen', jsonb_build_object('latitud', ST_Y(v.origen::geometry), 'longitud', ST_X(v.origen::geometry)),
    'destino', jsonb_build_object('latitud', ST_Y(v.destino::geometry), 'longitud', ST_X(v.destino::geometry)),
    'estimacionCentavos', v.estimacion_centavos,
    'tarifaFinalCentavos', v.tarifa_final_centavos,
    'solicitadoAt', v.solicitado_at,
    'asignadoAt', v.asignado_at,
    'iniciadoAt', v.iniciado_at,
    'finalizadoAt', v.finalizado_at,
    'canceladoAt', v.cancelado_at,
    'motivoCancelacion', v.motivo_cancelacion,
    'version', v.version
  );
$$;

CREATE OR REPLACE FUNCTION emitir_viaje_cambiado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO outbox_viajes (tipo, datos) VALUES ('ViajeCambiado', foto_viaje(NEW));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_viajes_outbox ON viajes;
CREATE TRIGGER tr_viajes_outbox
  AFTER INSERT OR UPDATE ON viajes
  FOR EACH ROW EXECUTE FUNCTION emitir_viaje_cambiado();

-- 3. Carga inicial: los viajes que ya existían antes del trigger reciben un evento con su estado
--    actual. Sólo una vez por viaje (si ya tiene algún ViajeCambiado, no se repite).
CREATE INDEX IF NOT EXISTS ix_outbox_viajes_viaje_cambiado
  ON outbox_viajes ((datos->>'viajeId')) WHERE tipo = 'ViajeCambiado';

INSERT INTO outbox_viajes (tipo, datos)
SELECT 'ViajeCambiado', foto_viaje(v)
FROM viajes v
WHERE NOT EXISTS (
  SELECT 1 FROM outbox_viajes o
  WHERE o.tipo = 'ViajeCambiado' AND o.datos->>'viajeId' = v.id::text
);
