// Deja la base de desarrollo como recién instalada, para mostrar la demo prolija: borra las tres bases
// (viajes, billetera y lectura) y corre `npm run setup`, que las vuelve a crear con las migraciones, la tarifa
// y los 4 usuarios de demo. Después, con el servidor levantado, se carga saldo con `npm run cargar-saldo`.
//
// Es destructivo a propósito, así que tiene tres frenos: sólo con --confirmar, nunca con NODE_ENV=production
// y sólo contra un Postgres local. Las bases *_test no se tocan.
//
//   npm run demo:reiniciar -- --confirmar
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { leerConfiguracion } from '../src/config/env.js';

const config = leerConfiguracion();
if (!process.argv.includes('--confirmar')) {
  console.error('Borra las bases de desarrollo (viajes, billetera, lectura). Para hacerlo: npm run demo:reiniciar -- --confirmar');
  process.exit(1);
}
if (config.NODE_ENV === 'production') {
  console.error('No se reinicia nada con NODE_ENV=production.');
  process.exit(1);
}
const urls = [config.DATABASE_URL, config.BILLETERA_DATABASE_URL, config.LECTURA_DATABASE_URL].map((u) => new URL(u));
if (!config.ADMIN_DATABASE_URL || ![...urls, new URL(config.ADMIN_DATABASE_URL)].every((u) => ['localhost', '127.0.0.1'].includes(u.hostname))) {
  console.error('Sólo contra un Postgres local y con ADMIN_DATABASE_URL definida.');
  process.exit(1);
}

// Los nombres van dentro del SQL (DROP DATABASE no admite parámetros): sólo letras, números y guion bajo,
// y nunca una base de pruebas.
const bases = urls.map((u) => u.pathname.slice(1));
for (const base of bases) {
  if (!/^[a-z_][a-z0-9_]*$/.test(base) || base.endsWith('_test')) {
    console.error(`Nombre de base no permitido: ${base}`);
    process.exit(1);
  }
}

const admin = new pg.Client({ connectionString: config.ADMIN_DATABASE_URL });
await admin.connect();
try {
  for (const base of bases) {
    // WITH (FORCE) corta las conexiones abiertas (por ejemplo, el servidor de desarrollo); su pool lo registra
    // y se reconecta solo cuando la base vuelve.
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    console.log(`Base ${base} borrada.`);
  }
} finally {
  await admin.end();
}

execFileSync(process.execPath, ['src/infra/db/migrate.js'], { stdio: 'inherit' });
execFileSync(process.execPath, ['src/infra/db/seed.js'], { stdio: 'inherit' });
console.log('\nListo: bases nuevas con los 4 usuarios de demo y la tarifa 2026.');
console.log('Con el servidor levantado (reinicialo si estaba corriendo), cargá saldo:');
console.log('  npm run cargar-saldo -- pasajero@demo.local 5000000');
