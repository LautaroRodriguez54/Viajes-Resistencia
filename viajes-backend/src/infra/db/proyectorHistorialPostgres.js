// Proyección del historial de viajes (tema 13, ADR 009) sobre la base `lectura`. La alimentan los
// eventos ViajeCambiado de `outbox_viajes`, que deja el trigger de la migración 006 con la foto de
// la fila en la misma transacción del cambio. La lee GET /viajes.
// - Una fila por viaje con su último estado conocido. El estado del cobro sale del estado del
//   viaje (`finalizado` = cobrado, `pago_pendiente` = se debe) y de la tarifa final.
// - Ordenada por versión: el upsert sólo pisa la fila si el evento trae una versión más nueva. Un
//   evento repetido (entrega "al menos una vez") o atrasado (dos despachadores) no hace nada, así
//   que no hace falta registrar los ids de evento aplicados (tema 3).
// - Las versiones de un mismo viaje se generan en orden: cada cambio bloquea la fila del viaje.
// - Se puede reconstruir desde cero reproduciendo el outbox (`npm run proyecciones:reconstruir`).
export const LIMITE_HISTORIAL_MAXIMO = 50;

const COLUMNAS = `viaje_id AS "viajeId", chofer_id AS "choferId", estado,
  json_build_object('latitud', origen_latitud, 'longitud', origen_longitud, 'nombre', origen_nombre) AS origen,
  json_build_object('latitud', destino_latitud, 'longitud', destino_longitud, 'nombre', destino_nombre) AS destino,
  estimacion_centavos AS "estimacionCentavos", tarifa_final_centavos AS "tarifaFinalCentavos",
  solicitado_at AS "solicitadoAt", asignado_at AS "asignadoAt", iniciado_at AS "iniciadoAt",
  finalizado_at AS "finalizadoAt", cancelado_at AS "canceladoAt", motivo_cancelacion AS "motivoCancelacion"`;

export function crearProyectorHistorialPostgres(pool) {
  return {
    async aplicar(evento) {
      if (evento.tipo !== 'ViajeCambiado') return { aplicado: false };
      const d = evento.datos;
      const { rowCount } = await pool.query(
        `INSERT INTO historial_viajes (
           viaje_id, pasajero_id, chofer_id, estado,
           origen_latitud, origen_longitud, destino_latitud, destino_longitud,
           estimacion_centavos, tarifa_final_centavos,
           solicitado_at, asignado_at, iniciado_at, finalizado_at, cancelado_at, motivo_cancelacion, version,
           origen_nombre, destino_nombre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (viaje_id) DO UPDATE SET
           chofer_id = EXCLUDED.chofer_id, estado = EXCLUDED.estado,
           tarifa_final_centavos = EXCLUDED.tarifa_final_centavos,
           asignado_at = EXCLUDED.asignado_at, iniciado_at = EXCLUDED.iniciado_at,
           finalizado_at = EXCLUDED.finalizado_at, cancelado_at = EXCLUDED.cancelado_at,
           motivo_cancelacion = EXCLUDED.motivo_cancelacion, version = EXCLUDED.version, actualizado_at = now(),
           -- Los nombres no cambian, pero un viaje creado antes de la migración 007 los recibe acá si se actualiza.
           origen_nombre = COALESCE(historial_viajes.origen_nombre, EXCLUDED.origen_nombre),
           destino_nombre = COALESCE(historial_viajes.destino_nombre, EXCLUDED.destino_nombre)
         WHERE historial_viajes.version < EXCLUDED.version`,
        [
          d.viajeId, d.pasajeroId, d.choferId, d.estado,
          d.origen.latitud, d.origen.longitud, d.destino.latitud, d.destino.longitud,
          d.estimacionCentavos, d.tarifaFinalCentavos,
          d.solicitadoAt, d.asignadoAt, d.iniciadoAt, d.finalizadoAt, d.canceladoAt, d.motivoCancelacion, d.version,
          d.origen.nombre ?? null, d.destino.nombre ?? null,
        ],
      );
      return { aplicado: rowCount > 0 };
    },

    // Los viajes del pasajero, del más nuevo al más viejo. Filtra por el id autenticado.
    async listarPorPasajero(pasajeroId, { limite }) {
      const { rows } = await pool.query(
        `SELECT ${COLUMNAS} FROM historial_viajes
         WHERE pasajero_id = $1 ORDER BY solicitado_at DESC, viaje_id LIMIT $2`,
        [pasajeroId, Math.min(limite, LIMITE_HISTORIAL_MAXIMO)],
      );
      return rows;
    },

    async reiniciar() {
      await pool.query('TRUNCATE historial_viajes');
    },
  };
}
