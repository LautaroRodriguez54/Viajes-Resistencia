import { ErrorDeDominio } from '../../dominio/errores.js';
import { ESTADOS_ACTIVOS_OPERADOR } from '../../dominio/viajes/estadosViaje.js';

function mapearViaje(row) {
  return {
    id: row.id, estado: row.estado, pasajeroId: row.pasajero_id, choferId: row.chofer_id,
    estimacionCentavos: row.estimacion_centavos, tarifaFinalCentavos: row.tarifa_final_centavos,
    solicitadoAt: row.solicitado_at,
  };
}

async function vencerOfertasExpiradasDelViaje(client, viajeId) {
  const { rows } = await client.query(
    `WITH vencidas AS (
       SELECT id FROM ofertas_viaje
       WHERE viaje_id = $1 AND estado = 'pendiente' AND vence_at <= now()
       ORDER BY id
       FOR UPDATE
     )
     UPDATE ofertas_viaje o
     SET estado = 'vencida', respondida_at = now()
     FROM vencidas
     WHERE o.id = vencidas.id
     RETURNING o.id, o.chofer_id`,
    [viajeId],
  );
  for (const fila of rows) {
    await client.query(
      "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_vencida', $2::jsonb)",
      [viajeId, JSON.stringify({ ofertaId: fila.id, choferId: fila.chofer_id })],
    );
  }
  return rows.map((fila) => ({ id: fila.id, choferId: fila.chofer_id }));
}

async function seleccionarYCrearOferta(client, { ofertaTtlSegundos = 30, ubicacionTtl = null }, { viajeId, origen, estadosExcluidos }) {
  const MAX_INTENTOS_CANDIDATO = 10;
  let choferId = null;
  for (let intento = 0; intento < MAX_INTENTOS_CANDIDATO; intento += 1) {
    await client.query('SAVEPOINT buscar_candidato');
    const candidato = await client.query(
      `SELECT p.usuario_id
       FROM perfiles_chofer p
       JOIN ubicaciones_actuales_chofer u ON u.chofer_id = p.usuario_id
       WHERE p.habilitado = TRUE AND p.disponible = TRUE
         AND ST_DWithin(u.ubicacion, $1::geography, 5000)
         AND ($3::int IS NULL OR u.reportada_at >= now() - make_interval(secs => $3))
         AND NOT EXISTS (
           SELECT 1 FROM viajes v
           WHERE v.chofer_id = p.usuario_id
             AND v.estado IN ('asignado', 'chofer_en_camino', 'en_curso')
         )
         AND NOT EXISTS (
           SELECT 1 FROM ofertas_viaje o
           WHERE o.viaje_id = $2
             AND o.chofer_id = p.usuario_id
             AND o.estado = ANY($4::text[])
         )
         AND NOT EXISTS (
           SELECT 1 FROM ofertas_viaje o
           WHERE o.chofer_id = p.usuario_id
             AND o.estado = 'pendiente'
             AND o.vence_at > now()
         )
       ORDER BY ST_Distance(u.ubicacion, $1::geography)
       LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,
      [origen, viajeId, ubicacionTtl, estadosExcluidos],
    );
    if (!candidato.rows[0]) {
      await client.query('RELEASE SAVEPOINT buscar_candidato');
      break;
    }

    // En READ COMMITTED, el NOT EXISTS del SELECT anterior usa el snapshot previo al bloqueo.
    // Con el bloqueo exclusivo sobre `p` ya tomado, esta segunda sentencia toma un snapshot
    // nuevo que ve cualquier oferta recién confirmada por otra transacción concurrente.
    const candidatoId = candidato.rows[0].usuario_id;
    const sigueElegible = await client.query(
      `SELECT 1
       FROM perfiles_chofer p
       JOIN ubicaciones_actuales_chofer u ON u.chofer_id = p.usuario_id
       WHERE p.usuario_id = $1
         AND p.habilitado = TRUE
         AND p.disponible = TRUE
         AND ($3::int IS NULL OR u.reportada_at >= now() - make_interval(secs => $3))
         AND NOT EXISTS (
           SELECT 1 FROM viajes v
           WHERE v.chofer_id = p.usuario_id
             AND v.estado IN ('asignado', 'chofer_en_camino', 'en_curso')
         )
         AND NOT EXISTS (
           SELECT 1 FROM ofertas_viaje o
           WHERE o.viaje_id = $2
             AND o.chofer_id = p.usuario_id
             AND o.estado = ANY($4::text[])
         )
         AND NOT EXISTS (
           SELECT 1 FROM ofertas_viaje o
           WHERE o.chofer_id = p.usuario_id
             AND o.estado = 'pendiente'
             AND o.vence_at > now()
         )`,
      [candidatoId, viajeId, ubicacionTtl, estadosExcluidos],
    );
    if (sigueElegible.rowCount === 1) {
      await client.query('RELEASE SAVEPOINT buscar_candidato');
      choferId = candidatoId;
      break;
    }
    await client.query('ROLLBACK TO SAVEPOINT buscar_candidato');
    await client.query('RELEASE SAVEPOINT buscar_candidato');
  }
  if (!choferId) return null;
  const oferta = await client.query(
    `INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at)
     VALUES ($1, $2, 'pendiente', now() + make_interval(secs => $3))
     RETURNING id, chofer_id, vence_at`,
    [viajeId, choferId, ofertaTtlSegundos],
  );
  await client.query(
    "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_creada', $2::jsonb)",
    [viajeId, JSON.stringify({ ofertaId: oferta.rows[0].id, choferId: oferta.rows[0].chofer_id })],
  );
  return { ofertaId: oferta.rows[0].id, choferId: oferta.rows[0].chofer_id, venceAt: oferta.rows[0].vence_at };
}

export function crearRepositorioViajesPostgres(pool) {
  return {
    async obtenerParametrosTarifaActivos() {
      const { rows } = await pool.query(
        `SELECT base_centavos, por_kilometro_centavos, por_minuto_centavos,
                maximo_viaje_centavos, velocidad_promedio_kmh
         FROM parametros_tarifa WHERE activo = TRUE`,
      );
      if (!rows[0]) throw new ErrorDeDominio('TARIFA_NO_CONFIGURADA', 'No hay parámetros de tarifa activos.');
      return {
        baseCentavos: rows[0].base_centavos, porKilometroCentavos: rows[0].por_kilometro_centavos,
        porMinutoCentavos: rows[0].por_minuto_centavos, maximoViajeCentavos: rows[0].maximo_viaje_centavos,
        velocidadPromedioKmh: rows[0].velocidad_promedio_kmh,
      };
    },
    async crearSolicitud({ pasajeroId, origen, destino, estimacion }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO viajes (pasajero_id, estado, origen, destino, estimacion_centavos)
           VALUES ($1, 'solicitado',
             ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
             ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
           RETURNING id, estado, pasajero_id, chofer_id, estimacion_centavos, tarifa_final_centavos, solicitado_at`,
          [pasajeroId, origen.latitud, origen.longitud, destino.latitud, destino.longitud, estimacion.importeCentavos],
        );
        await client.query(
          `INSERT INTO eventos_viaje (viaje_id, tipo, datos)
           VALUES ($1, 'viaje_solicitado', $2::jsonb)`,
          [rows[0].id, JSON.stringify({ estimacionCentavos: estimacion.importeCentavos })],
        );
        await client.query('COMMIT');
        return { ...mapearViaje(rows[0]), estimacion };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async buscarPorIdDelPasajero(viajeId, pasajeroId) {
      const { rows } = await pool.query(
        `SELECT v.id, v.estado, v.pasajero_id, v.chofer_id, v.estimacion_centavos,
                v.tarifa_final_centavos, v.solicitado_at,
                EXISTS (
                  SELECT 1 FROM ofertas_viaje o
                  WHERE o.viaje_id = v.id
                    AND o.estado = 'pendiente'
                    AND o.vence_at > now()
                ) AS tiene_oferta_vigente
         FROM viajes v
         WHERE v.id = $1 AND v.pasajero_id = $2`,
        [viajeId, pasajeroId],
      );
      if (!rows[0]) return null;
      return { ...mapearViaje(rows[0]), tieneOfertaVigente: Boolean(rows[0].tiene_oferta_vigente) };
    },
    // Lecturas del chofer (sin bloqueos): la web las consulta cada 2 s mientras no haya SSE.
    // Sólo devuelve una oferta pendiente, vigente y de un viaje que todavía se puede asignar.
    async buscarOfertaPendienteDelChofer(choferId) {
      const { rows } = await pool.query(
        `SELECT o.id AS oferta_id, o.viaje_id, o.vence_at, v.estimacion_centavos,
                ST_Y(v.origen::geometry) AS origen_latitud, ST_X(v.origen::geometry) AS origen_longitud,
                ST_Y(v.destino::geometry) AS destino_latitud, ST_X(v.destino::geometry) AS destino_longitud
         FROM ofertas_viaje o JOIN viajes v ON v.id = o.viaje_id
         WHERE o.chofer_id = $1 AND o.estado = 'pendiente' AND o.vence_at > now() AND v.estado = 'solicitado'
         ORDER BY o.vence_at DESC LIMIT 1`,
        [choferId],
      );
      const fila = rows[0];
      if (!fila) return null;
      return {
        ofertaId: fila.oferta_id, viajeId: fila.viaje_id, venceAt: fila.vence_at,
        estimacionCentavos: fila.estimacion_centavos, ...mapearRecorrido(fila),
      };
    },
    async buscarViajeActualDelChofer(choferId) {
      const { rows } = await pool.query(
        `SELECT id, estado, estimacion_centavos,
                ST_Y(origen::geometry) AS origen_latitud, ST_X(origen::geometry) AS origen_longitud,
                ST_Y(destino::geometry) AS destino_latitud, ST_X(destino::geometry) AS destino_longitud
         FROM viajes
         WHERE chofer_id = $1 AND estado IN ('asignado', 'chofer_en_camino', 'en_curso')
         LIMIT 1`,
        [choferId],
      );
      const fila = rows[0];
      if (!fila) return null;
      return { id: fila.id, estado: fila.estado, estimacionCentavos: fila.estimacion_centavos, ...mapearRecorrido(fila) };
    },
    async listarViajesActivos() {
      const { rows } = await pool.query(
        `SELECT v.id, v.estado, v.pasajero_id, v.chofer_id, p.patente,
                v.estimacion_centavos, v.tarifa_final_centavos, v.solicitado_at,
                ST_Y(v.origen::geometry) AS origen_latitud, ST_X(v.origen::geometry) AS origen_longitud,
                ST_Y(v.destino::geometry) AS destino_latitud, ST_X(v.destino::geometry) AS destino_longitud
         FROM viajes v
         LEFT JOIN perfiles_chofer p ON p.usuario_id = v.chofer_id
         WHERE v.estado = ANY($1::text[])
         ORDER BY v.solicitado_at DESC
         LIMIT 100`,
        [ESTADOS_ACTIVOS_OPERADOR],
      );
      return rows.map((fila) => ({
        id: fila.id,
        estado: fila.estado,
        pasajeroId: fila.pasajero_id,
        choferId: fila.chofer_id,
        patente: fila.patente ?? null,
        estimacionCentavos: fila.estimacion_centavos,
        tarifaFinalCentavos: fila.tarifa_final_centavos,
        solicitadoAt: fila.solicitado_at,
        ...mapearRecorrido(fila),
      }));
    },
  };
}

function mapearRecorrido(fila) {
  return {
    origen: { latitud: fila.origen_latitud, longitud: fila.origen_longitud },
    destino: { latitud: fila.destino_latitud, longitud: fila.destino_longitud },
  };
}

// Parte de viajes del puerto unidadDeTrabajoCobro: trabaja sobre el `client` de la transacción que
// abre unidadDeTrabajoCobroPostgres, nunca abre ni cierra una propia.
export function crearCobroViajesPostgres(client) {
  return {
    // FOR UPDATE: el viaje queda bloqueado hasta el COMMIT. Es el primer bloqueo del cobro.
    async bloquearParaCobro(viajeId) {
      const { rows } = await client.query(
        'SELECT id, estado, pasajero_id, chofer_id, estimacion_centavos, tarifa_final_centavos FROM viajes WHERE id = $1 FOR UPDATE',
        [viajeId],
      );
      const fila = rows[0];
      if (!fila) return null;
      return {
        id: fila.id, estado: fila.estado, pasajeroId: fila.pasajero_id, choferId: fila.chofer_id,
        estimacionCentavos: fila.estimacion_centavos, tarifaFinalCentavos: fila.tarifa_final_centavos,
      };
    },
    // Paso 1 del finalizar: el viaje terminó y se debe la tarifa. Queda en pago_pendiente hasta que
    // la billetera confirme; si algo se cae después de este COMMIT, el viaje no queda "a medias".
    async registrarCobroSolicitado(viajeId, { tarifaFinalCentavos }) {
      await client.query("UPDATE viajes SET estado = 'pago_pendiente', tarifa_final_centavos = $2, finalizado_at = now(), version = version + 1 WHERE id = $1", [viajeId, tarifaFinalCentavos]);
      await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'cobro_solicitado', $2::jsonb)", [viajeId, JSON.stringify({ importeCentavos: tarifaFinalCentavos })]);
    },
    async registrarCobroConfirmado(viajeId, { importeCentavos, reintento }) {
      await client.query("UPDATE viajes SET estado = 'finalizado', version = version + 1 WHERE id = $1", [viajeId]);
      const datos = reintento ? { importeCentavos, reintento: true } : { importeCentavos };
      await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'cobro_confirmado', $2::jsonb)", [viajeId, JSON.stringify(datos)]);
    },
    // El viaje sigue en pago_pendiente; sólo queda registrado por qué no se cobró.
    async registrarCobroPendiente(viajeId, { importeCentavos, motivo }) {
      await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'cobro_pendiente', $2::jsonb)", [viajeId, JSON.stringify({ importeCentavos, motivo })]);
    },
  };
}

// Operaciones de viajes sobre el `client` de la transacción abierta por unidadDeTrabajoViajesPostgres.
export function crearOperacionesViajesPostgres(client, opciones = {}) {
  const { ofertaTtlSegundos = 30, ubicacionTtlSegundos = null } = opciones;
  const ubicacionTtl = ubicacionTtlSegundos ?? null;

  return {
    async bloquearViaje(viajeId) {
      const { rows } = await client.query(
        'SELECT id, estado, pasajero_id, chofer_id, origen FROM viajes WHERE id = $1 FOR UPDATE',
        [viajeId],
      );
      const fila = rows[0];
      if (!fila) return null;
      return {
        id: fila.id,
        estado: fila.estado,
        pasajeroId: fila.pasajero_id,
        choferId: fila.chofer_id,
        origen: fila.origen,
      };
    },
    async actualizarEstadoViaje(viajeId, { nuevoEstado, registrarInicio }) {
      const sql = registrarInicio
        ? 'UPDATE viajes SET estado = $2, iniciado_at = now(), version = version + 1 WHERE id = $1'
        : 'UPDATE viajes SET estado = $2, version = version + 1 WHERE id = $1';
      await client.query(sql, [viajeId, nuevoEstado]);
    },
    async vencerOfertasPendientesDelViaje(viajeId) {
      const pendientes = await client.query(
        "SELECT id FROM ofertas_viaje WHERE viaje_id = $1 AND estado = 'pendiente' ORDER BY id FOR UPDATE",
        [viajeId],
      );
      if (pendientes.rows.length > 0) {
        await client.query(
          "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE id = ANY($1::uuid[])",
          [pendientes.rows.map((o) => o.id)],
        );
      }
    },
    async liberarChoferSiHabilitado(choferId) {
      await client.query(
        'UPDATE perfiles_chofer SET disponible = habilitado, updated_at = now() WHERE usuario_id = $1',
        [choferId],
      );
    },
    async registrarCancelacionViaje(viajeId, { nuevoEstado, actorId, motivo }) {
      const { rows } = await client.query(
        `UPDATE viajes
         SET estado = $2, cancelado_at = now(), cancelado_por_id = $3, motivo_cancelacion = $4, version = version + 1
         WHERE id = $1
         RETURNING id, estado, cancelado_at, motivo_cancelacion`,
        [viajeId, nuevoEstado, actorId, motivo],
      );
      return {
        viajeId: rows[0].id,
        estado: rows[0].estado,
        canceladoAt: rows[0].cancelado_at,
        motivo: rows[0].motivo_cancelacion,
      };
    },
    async registrarEventoViaje(viajeId, tipo, datos = null) {
      if (datos === null) {
        await client.query('INSERT INTO eventos_viaje (viaje_id, tipo) VALUES ($1, $2)', [viajeId, tipo]);
        return;
      }
      await client.query(
        'INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, $2, $3::jsonb)',
        [viajeId, tipo, JSON.stringify(datos)],
      );
    },
    async buscarReferenciaOferta(ofertaId) {
      const { rows } = await client.query(
        'SELECT id, viaje_id, chofer_id FROM ofertas_viaje WHERE id = $1',
        [ofertaId],
      );
      const fila = rows[0];
      if (!fila) return null;
      return { id: fila.id, viajeId: fila.viaje_id, choferId: fila.chofer_id };
    },
    async bloquearOfertasDelViaje(viajeId, ofertaId = null) {
      const { rows } = ofertaId
        ? await client.query(
          `SELECT id, viaje_id, chofer_id, estado, (vence_at <= now()) AS vencida
           FROM ofertas_viaje
           WHERE viaje_id = $1 AND (estado = 'pendiente' OR id = $2)
           ORDER BY id
           FOR UPDATE`,
          [viajeId, ofertaId],
        )
        : await client.query(
          `SELECT id, viaje_id, chofer_id, estado, (vence_at <= now()) AS vencida
           FROM ofertas_viaje
           WHERE viaje_id = $1 AND estado = 'pendiente'
           ORDER BY id
           FOR UPDATE`,
          [viajeId],
        );
      return rows.map((fila) => ({
        id: fila.id,
        viajeId: fila.viaje_id,
        choferId: fila.chofer_id,
        estado: fila.estado,
        vencida: Boolean(fila.vencida),
      }));
    },
    async bloquearChofer(choferId) {
      const { rows } = await client.query(
        'SELECT habilitado, disponible FROM perfiles_chofer WHERE usuario_id = $1 FOR UPDATE',
        [choferId],
      );
      const perfil = rows[0];
      if (!perfil) return null;
      const activo = await client.query(
        "SELECT 1 FROM viajes WHERE chofer_id = $1 AND estado IN ('asignado', 'chofer_en_camino', 'en_curso') LIMIT 1",
        [choferId],
      );
      return {
        habilitado: perfil.habilitado,
        disponible: perfil.disponible,
        tieneViajeActivo: Boolean(activo.rows[0]),
      };
    },
    async registrarAceptacionOferta({ viajeId, ofertaId, choferId }) {
      await client.query(
        "UPDATE viajes SET chofer_id = $2, estado = 'asignado', asignado_at = now(), version = version + 1 WHERE id = $1",
        [viajeId, choferId],
      );
      await client.query("UPDATE ofertas_viaje SET estado = 'aceptada', respondida_at = now() WHERE id = $1", [ofertaId]);
      await client.query(
        "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE viaje_id = $1 AND id <> $2 AND estado = 'pendiente'",
        [viajeId, ofertaId],
      );
      await client.query('UPDATE perfiles_chofer SET disponible = FALSE, updated_at = now() WHERE usuario_id = $1', [choferId]);
      await client.query(
        "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_asignado', $2::jsonb)",
        [viajeId, JSON.stringify({ choferId, ofertaId })],
      );
    },
    async bloquearViajeSolicitadoDelPasajero(viajeId, pasajeroId) {
      const { rows } = await client.query(
        "SELECT id, origen FROM viajes WHERE id = $1 AND pasajero_id = $2 AND estado = 'solicitado' FOR UPDATE",
        [viajeId, pasajeroId],
      );
      return rows[0] ?? null;
    },
    vencerOfertasExpiradasDelViaje(viajeId) {
      return vencerOfertasExpiradasDelViaje(client, viajeId);
    },
    seleccionarYCrearOferta({ viajeId, origen, estadosExcluidos }) {
      return seleccionarYCrearOferta(client, { ofertaTtlSegundos, ubicacionTtl }, { viajeId, origen, estadosExcluidos });
    },
    async marcarOfertaRechazada({ viajeId, ofertaId, choferId }) {
      await client.query("UPDATE ofertas_viaje SET estado = 'rechazada', respondida_at = now() WHERE id = $1", [ofertaId]);
      await client.query(
        "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_rechazada', $2::jsonb)",
        [viajeId, JSON.stringify({ ofertaId, choferId })],
      );
    },
    async marcarOfertasVencidas(viajeId, ofertasVencidas) {
      await client.query(
        "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE id = ANY($1::uuid[])",
        [ofertasVencidas.map((fila) => fila.id)],
      );
      for (const fila of ofertasVencidas) {
        await client.query(
          "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_vencida', $2::jsonb)",
          [viajeId, JSON.stringify({ ofertaId: fila.id, choferId: fila.choferId })],
        );
      }
    },
    async marcarViajeSinChoferesDisponibles(viajeId, datosEvento) {
      await client.query(
        "UPDATE viajes SET estado = 'sin_choferes_disponibles', version = version + 1 WHERE id = $1",
        [viajeId],
      );
      await client.query(
        "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_sin_choferes_disponibles', $2::jsonb)",
        [viajeId, JSON.stringify(datosEvento)],
      );
    },
    async bloquearSiguienteViajeConOfertaVencida() {
      const { rows } = await client.query(
        `SELECT v.id, v.estado, v.origen
         FROM viajes v
         WHERE EXISTS (
           SELECT 1 FROM ofertas_viaje o
           WHERE o.viaje_id = v.id
             AND o.estado = 'pendiente'
             AND o.vence_at <= now()
         )
         ORDER BY v.solicitado_at, v.id
         LIMIT 1
         FOR UPDATE OF v SKIP LOCKED`,
      );
      return rows[0] ?? null;
    },
  };
}

