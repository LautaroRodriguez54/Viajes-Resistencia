-- Nombre del origen y del destino tal como los eligió el pasajero ("Hospital Perrando", "Av. Sarmiento 1200").
-- Son opcionales y sólo para mostrar: la tarifa y la búsqueda de choferes siguen usando las coordenadas.
-- Antes la web recordaba el nombre sólo en la pestaña del pasajero, y el chofer, el operador y el
-- historial veían coordenadas.
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS origen_nombre TEXT;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS destino_nombre TEXT;

ALTER TABLE viajes DROP CONSTRAINT IF EXISTS viajes_nombres_largo_check;
ALTER TABLE viajes ADD CONSTRAINT viajes_nombres_largo_check CHECK (
  (origen_nombre IS NULL OR char_length(origen_nombre) BETWEEN 1 AND 120)
  AND (destino_nombre IS NULL OR char_length(destino_nombre) BETWEEN 1 AND 120)
);

-- La foto del viaje (migración 006) suma el nombre dentro de cada punto, así la proyección
-- `historial_viajes` de la base `lectura` también lo tiene. Los eventos viejos no lo traen (null).
CREATE OR REPLACE FUNCTION foto_viaje(v viajes)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'viajeId', v.id,
    'pasajeroId', v.pasajero_id,
    'choferId', v.chofer_id,
    'estado', v.estado,
    'origen', jsonb_build_object('latitud', ST_Y(v.origen::geometry), 'longitud', ST_X(v.origen::geometry), 'nombre', v.origen_nombre),
    'destino', jsonb_build_object('latitud', ST_Y(v.destino::geometry), 'longitud', ST_X(v.destino::geometry), 'nombre', v.destino_nombre),
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
