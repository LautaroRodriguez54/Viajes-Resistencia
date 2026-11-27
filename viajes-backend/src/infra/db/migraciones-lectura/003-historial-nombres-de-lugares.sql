-- Nombres del origen y del destino en el historial (migración 007 de `viajes`). Nulos en los viajes
-- anteriores; la web muestra la dirección aproximada en ese caso.
ALTER TABLE historial_viajes ADD COLUMN IF NOT EXISTS origen_nombre TEXT;
ALTER TABLE historial_viajes ADD COLUMN IF NOT EXISTS destino_nombre TEXT;
