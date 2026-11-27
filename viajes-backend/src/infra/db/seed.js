import { leerConfiguracion } from '../../config/env.js';
import { crearPoolPostgres } from './postgres.js';
import { crearHasheadorArgon2 } from '../autenticacion/contrasenasArgon2.js';
import { crearRepositorioUsuariosPostgres } from './repositorioUsuariosPostgres.js';
import { crearRepositorioTarifasPostgres } from './repositorioTarifasPostgres.js';

const config = leerConfiguracion();
const pool = crearPoolPostgres(config);
try {
  // Tarifa de desarrollo 2026, calibrada con el promedio que publica Uber para UberX desde el aeropuerto de
  // Resistencia (19 min, $ 13.379): base $ 1.500, $ 900 por km (por calles) y $ 180 por minuto, a 25 km/h,
  // con un máximo de $ 100.000 por viaje. Después la cambia el administrador desde su pantalla.
  const tarifa2026 = {
    baseCentavos: 150_000, porKilometroCentavos: 90_000, porMinutoCentavos: 18_000,
    maximoViajeCentavos: 10_000_000, velocidadPromedioKmh: 25,
  };
  const tarifas = crearRepositorioTarifasPostgres(pool);
  const { rows: activas } = await pool.query(
    `SELECT base_centavos, por_kilometro_centavos, por_minuto_centavos FROM parametros_tarifa WHERE activo = TRUE`,
  );
  const activa = activas[0];
  // Sin tarifa, o con la vieja de desarrollo ($ 5 + $ 2,50 por km + $ 1 por minuto), se pone la de 2026 como
  // una fila nueva (la anterior queda en el historial). Si el admin ya la cambió, no se toca.
  const esLaVieja = activa && activa.base_centavos === 500 && activa.por_kilometro_centavos === 250 && activa.por_minuto_centavos === 100;
  if (!activa || esLaVieja) await tarifas.reemplazarActiva(tarifa2026);
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

