/**
 * Agrupa inserciones de `historial_ubicaciones_chofer` en memoria y las persiste por lotes
 * con `unnest` para evitar contención y roundtrips por cada ping de ubicación.
 * Mantiene una cola acotada y drena los pendientes al detenerse (apagado ordenado).
 */
export function crearRecolectorHistorialUbicaciones({
  pool,
  logger,
  intervaloMs = 1_000,
  loteMax = 250,
  bufferMax = 10_000,
}) {
  const pendientes = [];
  let temporizador = null;
  let enCurso = null;
  let enVuelo = 0;
  let ultimoErrorAt = 0;
  let activo = false;
  let insertados = 0;
  let descartados = 0;

  async function escribirLote(lote) {
    const choferIds = lote.map((r) => r.choferId);
    const latitudes = lote.map((r) => r.latitud);
    const longitudes = lote.map((r) => r.longitud);
    const fechas = lote.map((r) => r.reportadaAt);
    await pool.query(
      `INSERT INTO historial_ubicaciones_chofer (chofer_id, ubicacion, reportada_at)
       SELECT chofer_id, ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography, reportada_at
       FROM unnest($1::uuid[], $2::double precision[], $3::double precision[], $4::timestamptz[])
         AS t(chofer_id, latitud, longitud, reportada_at)`,
      [choferIds, latitudes, longitudes, fechas],
    );
  }

  async function vaciarInterno(todo) {
    while (pendientes.length > 0) {
      if (!todo && pendientes.length < loteMax) break;
      const lote = pendientes.slice(0, loteMax);
      enVuelo = lote.length;
      try {
        await escribirLote(lote);
        pendientes.splice(0, lote.length);
        insertados += lote.length;
        ultimoErrorAt = 0;
      } catch (error) {
        if (error?.code === '23503') {
          pendientes.splice(0, lote.length);
          descartados += lote.length;
          logger?.warn({ err: error, cantidad: lote.length }, 'lote de historial descartado por referencia inexistente');
          continue;
        }
        ultimoErrorAt = Date.now();
        logger?.error({ err: error, cantidad: lote.length }, 'falló el volcado de historial de ubicaciones');
        break;
      } finally {
        enVuelo = 0;
      }
    }
  }

  // Los volcados van en fila: el último siempre queda en `enCurso`, así `encolar` nunca arranca
  // otro en paralelo que tome el mismo lote (duplicaría filas y el doble `splice` perdería otras).
  function vaciar({ todo = false } = {}) {
    if (enCurso && !todo) return enCurso;
    const previo = enCurso ?? Promise.resolve();
    const promesa = previo.catch(() => {}).then(() => vaciarInterno(todo)).finally(() => {
      if (enCurso === promesa) enCurso = null;
    });
    enCurso = promesa;
    return promesa;
  }

  function programar() {
    if (!activo) return;
    temporizador = setTimeout(() => {
      vaciar({ todo: true })
        .catch(() => {})
        .finally(programar);
    }, intervaloMs);
    temporizador.unref?.();
  }

  return {
    encolar({ choferId, latitud, longitud, reportadaAt = new Date() }) {
      if (pendientes.length >= bufferMax) {
        descartados += 1;
        if (descartados === 1 || descartados % 500 === 0) {
          logger?.warn({ bufferMax, descartados }, 'buffer de historial de ubicaciones lleno; descartando registro más antiguo');
        }
        if (enVuelo < pendientes.length) {
          pendientes.splice(enVuelo, 1);
        } else {
          return;
        }
      }
      pendientes.push({ choferId, latitud, longitud, reportadaAt });
      if (pendientes.length >= loteMax && !enCurso && Date.now() - ultimoErrorAt >= intervaloMs) {
        vaciar({ todo: false }).catch(() => {});
      }
    },
    vaciar,
    obtenerEstadisticas() {
      return { pendientes: pendientes.length, insertados, descartados };
    },
    iniciar() {
      if (activo) return;
      activo = true;
      programar();
    },
    async detener() {
      activo = false;
      clearTimeout(temporizador);
      await vaciar({ todo: true });
    },
  };
}
