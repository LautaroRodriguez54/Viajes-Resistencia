import { ErrorDeDominio } from '../../dominio/errores.js';

function mapearViaje(row) {
  return {
    id: row.id, estado: row.estado, pasajeroId: row.pasajero_id, choferId: row.chofer_id,
    estimacionCentavos: row.estimacion_centavos, tarifaFinalCentavos: row.tarifa_final_centavos,
    solicitadoAt: row.solicitado_at,
  };
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
        `SELECT id, estado, pasajero_id, chofer_id, estimacion_centavos, tarifa_final_centavos, solicitado_at
         FROM viajes WHERE id = $1 AND pasajero_id = $2`, [viajeId, pasajeroId],
      );
      return rows[0] ? mapearViaje(rows[0]) : null;
    },
    async ofrecerAlChoferCercano(viajeId, pasajeroId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const viaje = await client.query(
          "SELECT id, origen FROM viajes WHERE id = $1 AND pasajero_id = $2 AND estado = 'solicitado' FOR UPDATE",
          [viajeId, pasajeroId],
        );
        if (!viaje.rows[0]) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no está disponible para recibir ofertas.');
        const candidato = await client.query(
          `SELECT p.usuario_id
           FROM perfiles_chofer p
           JOIN ubicaciones_actuales_chofer u ON u.chofer_id = p.usuario_id
           WHERE p.habilitado = TRUE AND p.disponible = TRUE
             AND ST_DWithin(u.ubicacion, $1::geography, 5000)
             AND NOT EXISTS (
               SELECT 1 FROM viajes v
               WHERE v.chofer_id = p.usuario_id
                 AND v.estado IN ('asignado', 'chofer_en_camino', 'en_curso')
             )
             AND NOT EXISTS (
               SELECT 1 FROM ofertas_viaje o
               WHERE o.viaje_id = $2 AND o.chofer_id = p.usuario_id AND o.estado = 'pendiente'
             )
             AND NOT EXISTS (
               SELECT 1 FROM ofertas_viaje o
               WHERE o.chofer_id = p.usuario_id AND o.estado = 'pendiente' AND o.vence_at > now()
             )
           ORDER BY ST_Distance(u.ubicacion, $1::geography)
           LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,
          [viaje.rows[0].origen, viajeId],
        );
        if (!candidato.rows[0]) throw new ErrorDeDominio('SIN_CHOFERES_CERCANOS', 'No hay choferes disponibles en el radio configurado.');
        const oferta = await client.query(
          `INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at)
           VALUES ($1, $2, 'pendiente', now() + interval '30 seconds') RETURNING id, chofer_id, vence_at`,
          [viajeId, candidato.rows[0].usuario_id],
        );
        await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_creada', $2::jsonb)", [viajeId, JSON.stringify({ ofertaId: oferta.rows[0].id })]);
        await client.query('COMMIT');
        return { ofertaId: oferta.rows[0].id, choferId: oferta.rows[0].chofer_id, venceAt: oferta.rows[0].vence_at };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505' && error.constraint === 'ux_oferta_pendiente_viaje_chofer') {
          throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'Ya existe una oferta pendiente para ese chofer en este viaje.');
        }
        throw error;
      } finally { client.release(); }
    },
    async aceptarOferta(ofertaId, choferId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const referencia = await client.query('SELECT id, viaje_id, chofer_id FROM ofertas_viaje WHERE id = $1', [ofertaId]);
        if (!referencia.rows[0]) throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
        if (referencia.rows[0].chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
        const viajeId = referencia.rows[0].viaje_id;

        // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
        const viaje = await client.query('SELECT id, estado FROM viajes WHERE id = $1 FOR UPDATE', [viajeId]);
        const ofertas = await client.query(
          `SELECT id, viaje_id, chofer_id, estado, (vence_at <= now()) AS vencida
           FROM ofertas_viaje
           WHERE viaje_id = $1 AND (estado = 'pendiente' OR id = $2)
           ORDER BY id
           FOR UPDATE`,
          [viajeId, ofertaId],
        );
        const actual = ofertas.rows.find((fila) => fila.id === ofertaId);
        if (!actual) throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
        if (actual.chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
        if (actual.estado !== 'pendiente' || actual.vencida) throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'La oferta venció o ya fue respondida.');
        if (!viaje.rows[0] || viaje.rows[0].estado !== 'solicitado') throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya no puede asignarse.');

        const chofer = await client.query('SELECT habilitado, disponible FROM perfiles_chofer WHERE usuario_id = $1 FOR UPDATE', [choferId]);
        if (!chofer.rows[0]?.habilitado) throw new ErrorDeDominio('CHOFER_NO_HABILITADO', 'El chofer no está habilitado.');
        const viajeActivo = await client.query(
          "SELECT 1 FROM viajes WHERE chofer_id = $1 AND estado IN ('asignado', 'chofer_en_camino', 'en_curso') LIMIT 1",
          [choferId],
        );
        if (viajeActivo.rows[0]) throw new ErrorDeDominio('CHOFER_CON_VIAJE_ACTIVO', 'El chofer ya tiene un viaje activo.');
        if (!chofer.rows[0].disponible) throw new ErrorDeDominio('CHOFER_NO_DISPONIBLE', 'El chofer no está disponible.');

        await client.query("UPDATE viajes SET chofer_id = $2, estado = 'asignado', asignado_at = now(), version = version + 1 WHERE id = $1", [viajeId, choferId]);
        await client.query("UPDATE ofertas_viaje SET estado = 'aceptada', respondida_at = now() WHERE id = $1", [ofertaId]);
        await client.query(
          "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE viaje_id = $1 AND id <> $2 AND estado = 'pendiente'",
          [viajeId, ofertaId],
        );
        await client.query('UPDATE perfiles_chofer SET disponible = FALSE, updated_at = now() WHERE usuario_id = $1', [choferId]);
        await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_asignado', $2::jsonb)", [viajeId, JSON.stringify({ choferId, ofertaId })]);
        await client.query('COMMIT');
        return { viajeId, ofertaId, estado: 'asignado' };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
          if (error.constraint === 'ux_chofer_un_viaje_activo') {
            throw new ErrorDeDominio('CHOFER_CON_VIAJE_ACTIVO', 'El chofer ya tiene un viaje activo.');
          }
          if (error.constraint === 'ux_una_oferta_aceptada_por_viaje') {
            throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya fue asignado a otro chofer.');
          }
        }
        throw error;
      } finally { client.release(); }
    },
    async avanzarEstado(viajeId, choferId, nuevoEstado) {
      const anteriores = { chofer_en_camino: 'asignado', en_curso: 'chofer_en_camino' };
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const actual = await client.query('SELECT estado, chofer_id FROM viajes WHERE id = $1 FOR UPDATE', [viajeId]);
        if (!actual.rows[0] || actual.rows[0].chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
        if (anteriores[nuevoEstado] !== actual.rows[0].estado) throw new ErrorDeDominio('TRANSICION_INVALIDA', 'La transición de estado no es válida.');
        const columna = nuevoEstado === 'en_curso' ? 'iniciado_at' : null;
        await client.query(`UPDATE viajes SET estado = $2, ${columna ? `${columna} = now(), ` : ''}version = version + 1 WHERE id = $1`, [viajeId, nuevoEstado]);
        await client.query('INSERT INTO eventos_viaje (viaje_id, tipo) VALUES ($1, $2)', [viajeId, `estado_${nuevoEstado}`]);
        await client.query('COMMIT');
        return { viajeId, estado: nuevoEstado };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
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

