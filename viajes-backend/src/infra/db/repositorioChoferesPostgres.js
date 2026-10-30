import { ErrorDeDominio } from '../../dominio/errores.js';

export function crearRepositorioChoferesPostgres(pool) {
  return {
    async establecerHabilitacion(choferId, habilitado) {
      const { rows } = await pool.query(
        `UPDATE perfiles_chofer SET habilitado = $2,
           disponible = CASE WHEN $2 THEN disponible ELSE FALSE END, updated_at = now()
         WHERE usuario_id = $1
         RETURNING usuario_id, habilitado, disponible, updated_at`, [choferId, habilitado],
      );
      if (!rows[0]) throw new ErrorDeDominio('CHOFER_NO_ENCONTRADO', 'El chofer no existe.');
      return { choferId: rows[0].usuario_id, habilitado: rows[0].habilitado, disponible: rows[0].disponible };
    },
    async cambiarDisponibilidad(choferId, disponible) {
      const { rows } = await pool.query(
        `UPDATE perfiles_chofer SET disponible = $2, updated_at = now()
         WHERE usuario_id = $1 AND habilitado = TRUE
         RETURNING usuario_id, habilitado, disponible, updated_at`,
        [choferId, disponible],
      );
      if (!rows[0]) throw new ErrorDeDominio('CHOFER_NO_HABILITADO', 'El chofer no está habilitado.');
      return { choferId: rows[0].usuario_id, disponible: rows[0].disponible, updatedAt: rows[0].updated_at };
    },

    async registrarUbicacion(choferId, { latitud, longitud }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const perfil = await client.query(
          'SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1 AND habilitado = TRUE FOR UPDATE', [choferId],
        );
        if (!perfil.rows[0]?.disponible) throw new ErrorDeDominio('CHOFER_NO_DISPONIBLE', 'El chofer debe estar habilitado y disponible.');
        await client.query(
          `INSERT INTO ubicaciones_actuales_chofer (chofer_id, ubicacion, reportada_at)
           VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, now())
           ON CONFLICT (chofer_id) DO UPDATE SET ubicacion = EXCLUDED.ubicacion, reportada_at = EXCLUDED.reportada_at, updated_at = now()`,
          [choferId, latitud, longitud],
        );
        await client.query(
          `INSERT INTO historial_ubicaciones_chofer (chofer_id, ubicacion, reportada_at)
           VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, now())`,
          [choferId, latitud, longitud],
        );
        await client.query('COMMIT');
        return { choferId, latitud, longitud };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
  };
}

