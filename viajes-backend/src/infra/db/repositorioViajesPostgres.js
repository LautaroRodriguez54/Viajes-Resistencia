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
          'SELECT id, origen FROM viajes WHERE id = $1 AND pasajero_id = $2 AND estado = \'solicitado\' FOR UPDATE', [viajeId, pasajeroId],
        );
        if (!viaje.rows[0]) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no está disponible para recibir ofertas.');
        const candidato = await client.query(
          `SELECT p.usuario_id
           FROM perfiles_chofer p
           JOIN ubicaciones_actuales_chofer u ON u.chofer_id = p.usuario_id
           WHERE p.habilitado = TRUE AND p.disponible = TRUE
             AND ST_DWithin(u.ubicacion, $1::geography, 5000)
             AND NOT EXISTS (SELECT 1 FROM viajes v WHERE v.chofer_id = p.usuario_id AND v.estado IN ('asignado','chofer_en_camino','en_curso'))
           ORDER BY ST_Distance(u.ubicacion, $1::geography) LIMIT 1 FOR UPDATE OF p`,
          [viaje.rows[0].origen],
        );
        if (!candidato.rows[0]) throw new ErrorDeDominio('SIN_CHOFERES_CERCANOS', 'No hay choferes disponibles en el radio configurado.');
        const oferta = await client.query(
          `INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at)
           VALUES ($1, $2, 'pendiente', now() + interval '30 seconds') RETURNING id, chofer_id, vence_at`,
          [viajeId, candidato.rows[0].usuario_id],
        );
        await client.query('INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, \'oferta_creada\', $2::jsonb)', [viajeId, JSON.stringify({ ofertaId: oferta.rows[0].id })]);
        await client.query('COMMIT');
        return { ofertaId: oferta.rows[0].id, choferId: oferta.rows[0].chofer_id, venceAt: oferta.rows[0].vence_at };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async aceptarOferta(ofertaId, choferId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oferta = await client.query('SELECT id, viaje_id, chofer_id, estado, vence_at FROM ofertas_viaje WHERE id = $1 FOR UPDATE', [ofertaId]);
        if (!oferta.rows[0]) throw new ErrorDeDominio('OFERTA_NO_ENCONTRADA', 'La oferta no existe.');
        const actual = oferta.rows[0];
        if (actual.chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'La oferta pertenece a otro chofer.');
        if (actual.estado !== 'pendiente' || new Date(actual.vence_at) <= new Date()) throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'La oferta venció o ya fue respondida.');
        const viaje = await client.query('SELECT id, estado FROM viajes WHERE id = $1 FOR UPDATE', [actual.viaje_id]);
        if (viaje.rows[0].estado !== 'solicitado') throw new ErrorDeDominio('OFERTA_NO_DISPONIBLE', 'El viaje ya no puede asignarse.');
        const chofer = await client.query('SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1 AND habilitado = TRUE FOR UPDATE', [choferId]);
        if (!chofer.rows[0]?.disponible) throw new ErrorDeDominio('CHOFER_NO_DISPONIBLE', 'El chofer no está disponible.');
        await client.query("UPDATE viajes SET chofer_id = $2, estado = 'asignado', asignado_at = now(), version = version + 1 WHERE id = $1", [actual.viaje_id, choferId]);
        await client.query("UPDATE ofertas_viaje SET estado = 'aceptada', respondida_at = now() WHERE id = $1", [ofertaId]);
        await client.query('UPDATE perfiles_chofer SET disponible = FALSE, updated_at = now() WHERE usuario_id = $1', [choferId]);
        await client.query("INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, 'viaje_asignado', $2::jsonb)", [actual.viaje_id, JSON.stringify({ choferId, ofertaId })]);
        await client.query('COMMIT');
        return { viajeId: actual.viaje_id, ofertaId, estado: 'asignado' };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
    async finalizarYCobrar(viajeId, choferId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const viaje = await client.query('SELECT pasajero_id, chofer_id, estado, estimacion_centavos FROM viajes WHERE id = $1 FOR UPDATE', [viajeId]);
        const actual = viaje.rows[0];
        if (!actual || actual.chofer_id !== choferId) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no pertenece al chofer.');
        if (actual.estado !== 'en_curso') throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Sólo un viaje en curso puede finalizar.');
        const billetera = await client.query('SELECT id FROM billeteras WHERE pasajero_id = $1 FOR UPDATE', [actual.pasajero_id]);
        const saldo = await client.query(`SELECT COALESCE(SUM(CASE WHEN tipo = 'carga' THEN importe_centavos ELSE -importe_centavos END), 0) AS centavos FROM movimientos_billetera WHERE billetera_id = $1`, [billetera.rows[0].id]);
        const importe = actual.estimacion_centavos;
        const suficiente = Number(saldo.rows[0].centavos) >= importe;
        if (suficiente) await client.query("INSERT INTO movimientos_billetera (billetera_id, viaje_id, tipo, importe_centavos) VALUES ($1, $2, 'consumo', $3)", [billetera.rows[0].id, viajeId, importe]);
        const estado = suficiente ? 'finalizado' : 'pago_pendiente';
        await client.query('UPDATE viajes SET estado = $2, tarifa_final_centavos = $3, finalizado_at = now(), version = version + 1 WHERE id = $1', [viajeId, estado, importe]);
        await client.query('INSERT INTO eventos_viaje (viaje_id, tipo, datos) VALUES ($1, $2, $3::jsonb)', [viajeId, suficiente ? 'cobro_confirmado' : 'cobro_pendiente', JSON.stringify({ importeCentavos: importe })]);
        await client.query('COMMIT');
        return { viajeId, estado, importeCentavos: importe };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
  };
}

