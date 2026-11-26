import { ErrorDeDominio } from '../../dominio/errores.js';
import { decidirCancelacion } from '../../dominio/viajes/estadosViaje.js';
import { Rol } from '../../dominio/usuarios/roles.js';

function mapearViaje(row) {
  return {
    id: row.id, estado: row.estado, pasajeroId: row.pasajero_id, choferId: row.chofer_id,
    estimacionCentavos: row.estimacion_centavos, tarifaFinalCentavos: row.tarifa_final_centavos,
    solicitadoAt: row.solicitado_at,
  };
}

export function crearRepositorioViajesPostgres(pool, opciones = {}) {
  const { ofertaTtlSegundos = 30, ubicacionTtlSegundos = null } = opciones;
  const ubicacionTtl = ubicacionTtlSegundos ?? null;

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
    return rows;
  }

  async function seleccionarYCrearOferta(client, { viajeId, origen, estadosExcluidos }) {
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

  async function procesarUnViajeConOfertasVencidas() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
      const viaje = await client.query(
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
      if (!viaje.rows[0]) {
        await client.query('COMMIT');
        return { encontrada: false };
      }

      const viajeId = viaje.rows[0].id;
      const ofertas = await client.query(
        `SELECT id, chofer_id, (vence_at <= now()) AS vencida
         FROM ofertas_viaje
         WHERE viaje_id = $1 AND estado = 'pendiente'
         ORDER BY id
         FOR UPDATE`,
        [viajeId],
      );
      const vencidas = ofertas.rows.filter((fila) => fila.vencida);
      const vigentes = ofertas.rows.filter((fila) => !fila.vencida);
      if (vencidas.length === 0) {
        await client.query('COMMIT');
        return { encontrada: true, procesada: false };
      }

      await client.query(
        "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE id = ANY($1::uuid[])",
        [vencidas.map((fila) => fila.id)],
      );
      for (const fila of vencidas) {
        await client.query(
          "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_vencida', $2::jsonb)",
          [viajeId, JSON.stringify({ ofertaId: fila.id, choferId: fila.chofer_id })],
        );
      }

      let viajeEstado = viaje.rows[0].estado;
      let reofrecida = false;
      let nuevaOferta = null;
      if (viajeEstado === 'solicitado' && vigentes.length === 0) {
        nuevaOferta = await seleccionarYCrearOferta(client, {
          viajeId,
          origen: viaje.rows[0].origen,
          estadosExcluidos: ['pendiente', 'rechazada', 'vencida'],
        });
        if (nuevaOferta) {
          reofrecida = true;
        } else {
          await client.query(
            "UPDATE viajes SET estado = 'sin_choferes_disponibles', version = version + 1 WHERE id = $1",
            [viajeId],
          );
          await client.query(
            "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_sin_choferes_disponibles', $2::jsonb)",
            [viajeId, JSON.stringify({ motivo: 'sin_candidatos_tras_vencimiento', ofertasVencidas: vencidas.map((f) => f.id) })],
          );
          viajeEstado = 'sin_choferes_disponibles';
        }
      }

      await client.query('COMMIT');
      return {
        encontrada: true,
        procesada: true,
        resultado: { viajeId, vencidas: vencidas.length, reofrecida, viajeEstado, nuevaOferta },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
        // Limpia ofertas ya vencidas de este viaje para no bloquear al único chofer disponible en demos.
        await vencerOfertasExpiradasDelViaje(client, viajeId);
        const oferta = await seleccionarYCrearOferta(client, {
          viajeId,
          origen: viaje.rows[0].origen,
          estadosExcluidos: ['pendiente', 'rechazada'],
        });
        if (!oferta) throw new ErrorDeDominio('SIN_CHOFERES_CERCANOS', 'No hay choferes disponibles en el radio configurado.');
        await client.query('COMMIT');
        return oferta;
      } catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505' && error.constraint === 'ux_oferta_pendiente_viaje_chofer') {
          throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'Ya existe una oferta pendiente para ese chofer en este viaje.');
        }
        throw error;
      } finally { client.release(); }
    },
    async rechazarOferta(ofertaId, choferId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const referencia = await client.query('SELECT id, viaje_id, chofer_id FROM ofertas_viaje WHERE id = $1', [ofertaId]);
        if (!referencia.rows[0]) throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
        if (referencia.rows[0].chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
        const viajeId = referencia.rows[0].viaje_id;

        // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
        const viaje = await client.query('SELECT id, estado, origen FROM viajes WHERE id = $1 FOR UPDATE', [viajeId]);
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
        if (!viaje.rows[0] || viaje.rows[0].estado !== 'solicitado') throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya no admite respuestas sobre ofertas.');

        await client.query("UPDATE ofertas_viaje SET estado = 'rechazada', respondida_at = now() WHERE id = $1", [ofertaId]);
        await client.query(
          "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_rechazada', $2::jsonb)",
          [viajeId, JSON.stringify({ ofertaId, choferId })],
        );

        const otrasVencidas = ofertas.rows.filter(
          (fila) => fila.id !== ofertaId && fila.estado === 'pendiente' && fila.vencida,
        );
        if (otrasVencidas.length > 0) {
          await client.query(
            "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE id = ANY($1::uuid[])",
            [otrasVencidas.map((fila) => fila.id)],
          );
          for (const fila of otrasVencidas) {
            await client.query(
              "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'oferta_vencida', $2::jsonb)",
              [viajeId, JSON.stringify({ ofertaId: fila.id, choferId: fila.chofer_id })],
            );
          }
        }

        const quedaVigente = ofertas.rows.some(
          (fila) => fila.id !== ofertaId && fila.estado === 'pendiente' && !fila.vencida,
        );
        let viajeEstado = viaje.rows[0].estado;
        let reofrecida = false;
        if (!quedaVigente) {
          const nuevaOferta = await seleccionarYCrearOferta(client, {
            viajeId,
            origen: viaje.rows[0].origen,
            estadosExcluidos: ['pendiente', 'rechazada', 'vencida'],
          });
          if (nuevaOferta) {
            reofrecida = true;
          } else {
            await client.query(
              "UPDATE viajes SET estado = 'sin_choferes_disponibles', version = version + 1 WHERE id = $1",
              [viajeId],
            );
            await client.query(
              "INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_sin_choferes_disponibles', $2::jsonb)",
              [viajeId, JSON.stringify({ motivo: 'sin_candidatos_tras_rechazo', ofertaId })],
            );
            viajeEstado = 'sin_choferes_disponibles';
          }
        }

        await client.query('COMMIT');
        return { viajeId, ofertaId, estado: 'rechazada', viajeEstado, reofrecida };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async procesarOfertasVencidas({ maxPorVuelta = 100 } = {}) {
      const resultados = [];
      for (let i = 0; i < maxPorVuelta; i += 1) {
        const vuelta = await procesarUnViajeConOfertasVencidas();
        if (!vuelta.encontrada) break;
        if (vuelta.procesada) resultados.push(vuelta.resultado);
      }
      return resultados;
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
    async cancelarViaje({ viajeId, actorId, rol, motivo = null }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Orden global de bloqueos: viajes -> ofertas_viaje (ORDER BY id) -> perfiles_chofer.
        const actual = await client.query(
          'SELECT id, estado, pasajero_id, chofer_id FROM viajes WHERE id = $1 FOR UPDATE',
          [viajeId],
        );
        const fila = actual.rows[0];
        if (!fila) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe.');
        if (rol === Rol.PASAJERO && fila.pasajero_id !== actorId) {
          throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
        }
        if (rol === Rol.CHOFER && fila.chofer_id !== actorId) {
          throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
        }

        const decision = decidirCancelacion({ estadoActual: fila.estado, rol, motivo });

        const ofertasPendientes = await client.query(
          "SELECT id FROM ofertas_viaje WHERE viaje_id = $1 AND estado = 'pendiente' ORDER BY id FOR UPDATE",
          [viajeId],
        );
        if (ofertasPendientes.rows.length > 0) {
          await client.query(
            "UPDATE ofertas_viaje SET estado = 'vencida', respondida_at = now() WHERE id = ANY($1::uuid[])",
            [ofertasPendientes.rows.map((o) => o.id)],
          );
        }

        if (decision.liberarChofer && fila.chofer_id) {
          await client.query(
            'UPDATE perfiles_chofer SET disponible = habilitado, updated_at = now() WHERE usuario_id = $1',
            [fila.chofer_id],
          );
        }

        const { rows } = await client.query(
          `UPDATE viajes
           SET estado = $2, cancelado_at = now(), cancelado_por_id = $3, motivo_cancelacion = $4, version = version + 1
           WHERE id = $1
           RETURNING id, estado, cancelado_at, motivo_cancelacion`,
          [viajeId, decision.nuevoEstado, actorId, decision.motivo],
        );
        await client.query(
          'INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, $2, $3::jsonb)',
          [viajeId, decision.nuevoEstado, JSON.stringify({ actorId, rol, motivo: decision.motivo })],
        );
        await client.query('COMMIT');
        return {
          viajeId: rows[0].id,
          estado: rows[0].estado,
          canceladoAt: rows[0].cancelado_at,
          motivo: rows[0].motivo_cancelacion,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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

