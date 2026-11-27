import { leerConfiguracion } from '../../config/env.js';
import { crearPoolPostgres } from './postgres.js';
import { crearHasheadorArgon2 } from '../autenticacion/contrasenasArgon2.js';
import { crearRepositorioUsuariosPostgres } from './repositorioUsuariosPostgres.js';

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
  const hasheador = crearHasheadorArgon2(config);
  const hashAdmin = await hasheador.hashear('AdminDemo123!');
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, rol) VALUES ('admin@demo.local', $1, 'administrador')
     ON CONFLICT DO NOTHING`, [hashAdmin],
  );
  const hashOperador = await hasheador.hashear('OperadorDemo123!');
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, rol) VALUES ('operador@demo.local', $1, 'operador')
     ON CONFLICT DO NOTHING`, [hashOperador],
  );
  // Pasajero y chofer de demo, con los mismos accesos que figuran en el README de la raíz.
  // Se crean con el repositorio real: el pasajero deja su `UsuarioRegistrado` en el outbox
  // (la billetera aparece cuando el servidor lo procesa) y el chofer queda con su perfil.
  const usuarios = crearRepositorioUsuariosPostgres(pool);
  const demo = [
    { email: 'pasajero@demo.local', password: 'PasajeroDemo123!', rol: 'pasajero' },
    {
      email: 'chofer@demo.local',
      password: 'ChoferDemo123!',
      rol: 'chofer',
      vehiculo: { patente: 'DEMO001', marca: 'Fiat', modelo: 'Cronos' },
    },
  ];
  for (const { email, password, rol, vehiculo } of demo) {
    if (await usuarios.buscarPorEmail(email)) continue;
    const passwordHash = await hasheador.hashear(password);
    await usuarios.crear({ email, passwordHash, rol, vehiculo });
  }
  // El chofer de demo arranca habilitado, así la demo no depende de pasar antes por el admin.
  await pool.query(
    `UPDATE perfiles_chofer SET habilitado = TRUE, updated_at = now()
     WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'chofer@demo.local') AND habilitado = FALSE`,
  );
  console.log('Parámetros de tarifa y usuarios de desarrollo cargados.');
} finally {
  await pool.end();
}

