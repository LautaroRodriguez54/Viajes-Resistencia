import test from 'node:test';
import assert from 'node:assert/strict';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { DIRECTORIOS_MIGRACIONES, listarArchivosMigracion, verificarMigracionesAplicadas } from '../../src/infra/db/migraciones.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';

const loggerMudo = { info() {}, warn() {}, error() {} };

function crearAppReady(pools, verificarDisponibilidad) {
  const config = {
    CORS_ORIGINS: ['http://localhost:5173'],
    JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars',
    JWT_ACCESS_TOKEN_TTL: '15m',
    RATE_LIMIT_LOGIN_VENTANA_MS: 60_000, RATE_LIMIT_LOGIN_MAX: 100,
    RATE_LIMIT_WEBHOOK_VENTANA_MS: 60_000, RATE_LIMIT_WEBHOOK_MAX: 100,
    RATE_LIMIT_UBICACION_VENTANA_MS: 60_000, RATE_LIMIT_UBICACION_MAX: 100,
    IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  };
  const tokens = crearServicioJwt(config);
  const noUsado = async () => { throw new Error('no usado'); };
  return crearApp({
    config,
    logger: loggerMudo,
    verificarDisponibilidad,
    autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
    billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, listarMovimientosPorPasajero: noUsado, tokens },
    viajes: { solicitarViaje: noUsado, buscarViajePropio: noUsado, ofrecerAlChoferCercano: noUsado, reintentarCobro: noUsado, cancelarViaje: noUsado, listarHistorial: noUsado, tokens },
    ofertas: { aceptarOferta: noUsado, rechazarOferta: noUsado, tokens },
    choferes: { cambiarDisponibilidad: noUsado, registrarUbicacion: noUsado, avanzarEstado: noUsado, finalizarYCobrar: noUsado, cancelarViaje: noUsado, buscarOfertaPendiente: noUsado, buscarViajeActual: noUsado, tokens },
    administracion: { establecerHabilitacion: noUsado, tokens },
    operador: { listarViajesActivos: noUsado, cancelarViaje: noUsado, reintentarCobro: noUsado, tokens },
    idempotencia: crearRepositorioIdempotenciaPostgres(pools.viajes),
  });
}

async function conServidor(app, fn) {
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
}

test('GET /ready devuelve 200 cuando las 3 bases tienen todas sus schema_migrations aplicadas y 503 si falta una', async (t) => {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }

  const pools = crearPoolsDePrueba(urls);
  try {
    const verificar = () => Promise.all([
      verificarMigracionesAplicadas(pools.viajes, DIRECTORIOS_MIGRACIONES.viajes),
      verificarMigracionesAplicadas(pools.billetera, DIRECTORIOS_MIGRACIONES.billetera),
      verificarMigracionesAplicadas(pools.lectura, DIRECTORIOS_MIGRACIONES.lectura),
    ]);

    const esperadasLectura = await listarArchivosMigracion(DIRECTORIOS_MIGRACIONES.lectura);
    const { rows: registradasLectura } = await pools.lectura.query('SELECT nombre FROM schema_migrations ORDER BY nombre');
    assert.deepEqual(registradasLectura.map((r) => r.nombre), esperadasLectura);

    const app = crearAppReady(pools, verificar);
    await conServidor(app, async (baseUrl) => {
      const ok = await fetch(`${baseUrl}/ready`);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true });

      const ultima = esperadasLectura.at(-1);
      await pools.lectura.query('DELETE FROM schema_migrations WHERE nombre = $1', [ultima]);
      try {
        const fallo = await fetch(`${baseUrl}/ready`);
        assert.equal(fallo.status, 503);
        const body = await fallo.json();
        assert.equal(body.error?.codigo, 'SERVICIO_NO_DISPONIBLE');
        assert.ok(body.error?.requestId);
      } finally {
        await pools.lectura.query('INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [ultima]);
      }

      const recuperado = await fetch(`${baseUrl}/ready`);
      assert.equal(recuperado.status, 200);
    });
  } finally {
    await cerrarPools(pools);
  }
});

test('GET /ready devuelve 503 SERVICIO_NO_DISPONIBLE si la verificación de disponibilidad falla con error de conexión', async (t) => {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }

  const pools = crearPoolsDePrueba(urls);
  try {
    const app = crearAppReady(pools, async () => {
      throw new Error('ECONNREFUSED');
    });
    await conServidor(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/ready`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error?.codigo, 'SERVICIO_NO_DISPONIBLE');
      assert.ok(body.error?.requestId);
    });
  } finally {
    await cerrarPools(pools);
  }
});
