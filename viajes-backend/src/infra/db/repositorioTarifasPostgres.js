import { ErrorDeDominio } from '../../dominio/errores.js';

function mapearTarifa(row) {
  return {
    id: row.id,
    baseCentavos: row.base_centavos,
    porKilometroCentavos: row.por_kilometro_centavos,
    porMinutoCentavos: row.por_minuto_centavos,
    maximoViajeCentavos: row.maximo_viaje_centavos,
    velocidadPromedioKmh: row.velocidad_promedio_kmh,
    vigenteDesde: row.created_at,
  };
}

const COLUMNAS = `id, base_centavos, por_kilometro_centavos, por_minuto_centavos,
  maximo_viaje_centavos, velocidad_promedio_kmh, created_at`;

// La tarifa nunca se edita: cambiarla es insertar una fila nueva activa y desactivar la anterior,
// así queda el historial de tarifas y cada viaje sigue teniendo la estimación con la que se pidió.
export function crearRepositorioTarifasPostgres(pool) {
  return {
    async obtenerActiva() {
      const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM parametros_tarifa WHERE activo = TRUE`);
      if (!rows[0]) throw new ErrorDeDominio('TARIFA_NO_CONFIGURADA', 'No hay parámetros de tarifa activos.');
      return mapearTarifa(rows[0]);
    },

    async reemplazarActiva({ baseCentavos, porKilometroCentavos, porMinutoCentavos, maximoViajeCentavos, velocidadPromedioKmh }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Dos administradores guardando a la vez: sin este candado, los dos desactivarían la misma fila
        // y el segundo INSERT chocaría con ux_parametros_tarifa_activo (500). EXCLUSIVE deja leer la
        // tarifa (las estimaciones no se frenan) pero pone en fila a los que la cambian.
        await client.query('LOCK TABLE parametros_tarifa IN EXCLUSIVE MODE');
        const anterior = await client.query(
          'UPDATE parametros_tarifa SET activo = FALSE WHERE activo = TRUE RETURNING velocidad_promedio_kmh',
        );
        const velocidad = velocidadPromedioKmh ?? anterior.rows[0]?.velocidad_promedio_kmh ?? 30;
        const { rows } = await client.query(
          `INSERT INTO parametros_tarifa
             (base_centavos, por_kilometro_centavos, por_minuto_centavos, maximo_viaje_centavos, velocidad_promedio_kmh)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${COLUMNAS}`,
          [baseCentavos, porKilometroCentavos, porMinutoCentavos, maximoViajeCentavos, velocidad],
        );
        await client.query('COMMIT');
        return mapearTarifa(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
