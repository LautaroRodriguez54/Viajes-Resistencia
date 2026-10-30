import { ErrorDeDominio } from '../../dominio/errores.js';

function mapearUsuario(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, passwordHash: row.password_hash, rol: row.rol, createdAt: row.created_at };
}

export function crearRepositorioUsuariosPostgres(pool) {
  return {
    async crear({ email, passwordHash, rol, vehiculo }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO usuarios (email, password_hash, rol)
           VALUES ($1, $2, $3)
           RETURNING id, email, password_hash, rol, created_at`,
          [email, passwordHash, rol],
        );
        const usuario = mapearUsuario(rows[0]);
        if (rol === 'chofer') {
          await client.query(
            `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo)
             VALUES ($1, $2, $3, $4)`,
            [usuario.id, vehiculo.patente, vehiculo.marca, vehiculo.modelo],
          );
        }
        if (rol === 'pasajero') {
          await client.query('INSERT INTO billeteras (pasajero_id) VALUES ($1)', [usuario.id]);
        }
        await client.query('COMMIT');
        return { id: usuario.id, email: usuario.email, rol: usuario.rol };
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new ErrorDeDominio('EMAIL_O_PATENTE_EXISTENTE', 'El email o la patente ya están registrados.');
        throw error;
      } finally {
        client.release();
      }
    },

    async buscarPorEmail(email) {
      const { rows } = await pool.query(
        `SELECT id, email, password_hash, rol, created_at
         FROM usuarios WHERE lower(email) = lower($1)`,
        [email],
      );
      return mapearUsuario(rows[0]);
    },

    async buscarPorId(id) {
      const { rows } = await pool.query(
        `SELECT id, email, password_hash, rol, created_at
         FROM usuarios WHERE id = $1`,
        [id],
      );
      return mapearUsuario(rows[0]);
    },
  };
}

