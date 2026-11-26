// Carga saldo de demostración en la billetera de un pasajero.
// Simula al proveedor de pagos: firma el cuerpo con WEBHOOK_HMAC_SECRET y llama
// al mismo webhook que usaría el proveedor real (POST /billetera/webhooks/cargas).
// No agrega ningún endpoint al servidor, así que no abre superficie de ataque.
//
// Uso: npm run cargar-saldo -- <email|pasajeroId> <importeCentavos> [--url http://localhost:3000]
import { leerConfiguracion } from '../src/config/env.js';
import { crearPoolPostgres } from '../src/infra/db/postgres.js';
import { crearRepositorioUsuariosPostgres } from '../src/infra/db/repositorioUsuariosPostgres.js';
import { armarCargaFirmada, interpretarArgumentos } from '../src/infra/externos/cargaDemoWebhook.js';

async function resolverPasajeroId(config, email) {
  const pool = crearPoolPostgres(config);
  try {
    const usuario = await crearRepositorioUsuariosPostgres(pool).buscarPorEmail(email);
    if (!usuario) throw new Error(`No existe un usuario con el email ${email}.`);
    if (usuario.rol !== 'pasajero') throw new Error(`${email} no es pasajero (rol: ${usuario.rol}).`);
    return usuario.id;
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = leerConfiguracion();
  if (config.NODE_ENV === 'production') {
    throw new Error('cargar-saldo es sólo para desarrollo y demos: no se usa con NODE_ENV=production.');
  }

  const argumentos = interpretarArgumentos(process.argv.slice(2), `http://localhost:${config.PORT}`);
  const pasajeroId = argumentos.pasajeroId ?? await resolverPasajeroId(config, argumentos.email);
  const { eventoExternoId, cuerpo, firma } = armarCargaFirmada({
    pasajeroId,
    importeCentavos: argumentos.importeCentavos,
    secreto: config.WEBHOOK_HMAC_SECRET,
  });

  const respuesta = await fetch(`${argumentos.url}/billetera/webhooks/cargas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': firma },
    body: cuerpo,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(`El servidor respondió ${respuesta.status}: ${JSON.stringify(datos)}`);
  }

  console.log(`Carga acreditada (${respuesta.status}): ${argumentos.importeCentavos} centavos al pasajero ${pasajeroId}.`);
  console.log(`eventoExternoId: ${eventoExternoId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
