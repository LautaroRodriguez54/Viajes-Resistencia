import { leerConfiguracion } from '../../config/env.js';
import { crearPoolPostgres } from './postgres.js';
import { crearHasheadorArgon2 } from '../autenticacion/contrasenasArgon2.js';

const config = leerConfiguracion();
const pool = crearPoolPostgres(config);
try {
  // Valores exclusivamente de desarrollo: luego los administrará el módulo correspondiente.
  await pool.query(
    `INSERT INTO parametros_tarifa
       (base_centavos, por_kilometro_centavos, por_minuto_centavos, maximo_viaje_centavos, velocidad_promedio_kmh)
     VALUES (500, 250, 100, 100000, 30)
     ON CONFLICT DO NOTHING`,
  );
  const hash = await crearHasheadorArgon2(config).hashear('AdminDemo123!');
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, rol) VALUES ('admin@demo.local', $1, 'administrador')
     ON CONFLICT DO NOTHING`, [hash],
  );
  console.log('Parámetros de tarifa de desarrollo cargados.');
} finally {
  await pool.end();
}

