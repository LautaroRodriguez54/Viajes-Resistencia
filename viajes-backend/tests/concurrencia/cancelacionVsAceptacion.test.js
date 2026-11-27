import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';
import { crearCasosDeUsoViajesPostgres } from '../ayudas/casosDeUsoViajesPostgres.js';

const loggerMudo = { info() {}, warn() {}, error() {} };

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de concurrencia');
    return;
  }
  assert.equal(new URL(databaseUrl).pathname, '/viajes_test', 'Las pruebas solo pueden ejecutarse contra viajes_test');
  const pool = crearPoolPostgres({ DATABASE_URL: databaseUrl, DATABASE_SSL: false });
  try {
    await pool.query('UPDATE perfiles_chofer SET disponible = FALSE WHERE disponible = TRUE');
    await pool.query("UPDATE ofertas_viaje SET estado = 'vencida' WHERE estado = 'pendiente'");
    await ejecutar(pool);
  } finally {
    await pool.end();
  }
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)',
    [id, `${rol}-${crypto.randomUUID()}@example.com`, 'hash-de-prueba', rol],
  );
  return id;
}

async function crearChofer(pool, disponible = true) {
  const choferId = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, $3)`,
    [choferId, `CAN-${crypto.randomUUID().slice(0, 8)}`, disponible],
  );
  return choferId;
}

async function crearViaje(pool, pasajeroId, { choferId = null, estado = 'solicitado' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO viajes (pasajero_id, chofer_id, estado, origen, destino, estimacion_centavos, asignado_at)
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.9800, -27.4400), 4326)::geography,
       1500, CASE WHEN $2::uuid IS NOT NULL THEN now() ELSE NULL END
     )
     RETURNING id`,
    [pasajeroId, choferId, estado],
  );
  return rows[0].id;
}

test('carrera cancelación pasajero vs aceptación simultánea mantiene invariantes sin deadlocks', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { aceptarOferta, cancelarViaje } = crearCasosDeUsoViajesPostgres(pool);

    for (let ronda = 0; ronda < 8; ronda += 1) {
      const pasajeroId = await crearUsuario(pool, 'pasajero');
      const choferId = await crearChofer(pool, true);
      const viajeId = await crearViaje(pool, pasajeroId);
      const { rows: ofertaRows } = await pool.query(
        "INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at) VALUES ($1, $2, 'pendiente', now() + interval '5 minutes') RETURNING id",
        [viajeId, choferId],
      );
      const ofertaId = ofertaRows[0].id;

      const [resCancelar, resAceptar] = await Promise.allSettled([
        cancelarViaje({ viajeId, actorId: pasajeroId, rol: Rol.PASAJERO, motivo: 'Cambio de planes' }),
        aceptarOferta({ ofertaId, choferId }),
      ]);

      assert.equal(resCancelar.status, 'fulfilled');
      assert.equal(resCancelar.value.estado, 'cancelado_pasajero');
      if (resAceptar.status === 'rejected') {
        assert.equal(resAceptar.reason?.codigo, 'OFERTA_NO_DISPONIBLE');
      }

      const viaje = await pool.query('SELECT estado, cancelado_por_id FROM viajes WHERE id = $1', [viajeId]);
      assert.equal(viaje.rows[0].estado, 'cancelado_pasajero');
      assert.equal(viaje.rows[0].cancelado_por_id, pasajeroId);

      const pendientes = await pool.query(
        "SELECT COUNT(*)::int AS n FROM ofertas_viaje WHERE viaje_id = $1 AND estado = 'pendiente'",
        [viajeId],
      );
      assert.equal(pendientes.rows[0].n, 0);

      const perfil = await pool.query('SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1', [choferId]);
      assert.equal(perfil.rows[0].disponible, true);
    }
  });
});

test('carrera cancelación pasajero vs avanzarEstado en_curso: exactamente uno gana', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { avanzarEstado, cancelarViaje } = crearCasosDeUsoViajesPostgres(pool);

    for (let ronda = 0; ronda < 6; ronda += 1) {
      const pasajeroId = await crearUsuario(pool, 'pasajero');
      const choferId = await crearChofer(pool, false);
      const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'chofer_en_camino' });

      const resultados = await Promise.allSettled([
        cancelarViaje({ viajeId, actorId: pasajeroId, rol: Rol.PASAJERO }),
        avanzarEstado({ viajeId, choferId, nuevoEstado: 'en_curso' }),
      ]);

      assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(resultados.find((r) => r.status === 'rejected')?.reason?.codigo, 'TRANSICION_INVALIDA');
    }
  });
});

test('endpoints HTTP de cancelación de pasajero y chofer respetan idempotencia, propiedad y disponibilidad', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const config = {
      CORS_ORIGINS: ['http://localhost:5173'],
      JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars',
      JWT_ACCESS_TOKEN_TTL: '15m',
      RATE_LIMIT_LOGIN_VENTANA_MS: 60_000,
      RATE_LIMIT_LOGIN_MAX: 100,
      RATE_LIMIT_WEBHOOK_VENTANA_MS: 60_000,
      RATE_LIMIT_WEBHOOK_MAX: 100,
      RATE_LIMIT_UBICACION_VENTANA_MS: 60_000,
      RATE_LIMIT_UBICACION_MAX: 100,
      IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
    };
    const tokens = crearServicioJwt(config);
    const viajes = crearRepositorioViajesPostgres(pool);
    const { cancelarViaje } = crearCasosDeUsoViajesPostgres(pool);
    const choferes = crearRepositorioChoferesPostgres(pool);
    const noUsado = async () => { throw new Error('no usado'); };
    const app = crearApp({
      config, logger: loggerMudo, verificarDisponibilidad: async () => true,
      autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
      billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, tokens },
      viajes: { solicitarViaje: noUsado, buscarViajePropio: viajes.buscarPorIdDelPasajero, ofrecerAlChoferCercano: noUsado, reintentarCobro: noUsado, cancelarViaje, tokens },
      ofertas: { aceptarOferta: noUsado, rechazarOferta: noUsado, tokens },
      choferes: { cambiarDisponibilidad: choferes.cambiarDisponibilidad, registrarUbicacion: noUsado, avanzarEstado: noUsado, finalizarYCobrar: noUsado, cancelarViaje, buscarOfertaPendiente: noUsado, buscarViajeActual: noUsado, tokens },
      administracion: { establecerHabilitacion: noUsado, tokens },
      idempotencia: crearRepositorioIdempotenciaPostgres(pool),
    });
    const servidor = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
    try {
      const pasajeroId = await crearUsuario(pool, 'pasajero');
      const otroPasajeroId = await crearUsuario(pool, 'pasajero');
      const choferId = await crearChofer(pool, false);
      const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'asignado' });

      const tokChofer = tokens.crearTokenDeAcceso({ usuarioId: choferId, rol: Rol.CHOFER });
      const tokOtroPasajero = tokens.crearTokenDeAcceso({ usuarioId: otroPasajeroId, rol: Rol.PASAJERO });

      const ajeno = await fetch(`${baseUrl}/viajes/${viajeId}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokOtroPasajero}`, 'idempotency-key': crypto.randomUUID() },
        body: '{}',
      });
      assert.equal(ajeno.status, 404);

      const clave = crypto.randomUUID();
      const cancelChofer = await fetch(`${baseUrl}/choferes/viajes/${viajeId}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokChofer}`, 'idempotency-key': clave },
        body: JSON.stringify({ motivo: 'Pinchadura' }),
      });
      assert.equal(cancelChofer.status, 200);
      const body = await cancelChofer.json();
      assert.equal(body.estado, 'cancelado_chofer');
      assert.equal(body.motivo, 'Pinchadura');

      const replay = await fetch(`${baseUrl}/choferes/viajes/${viajeId}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokChofer}`, 'idempotency-key': clave },
        body: JSON.stringify({ motivo: 'Pinchadura' }),
      });
      assert.equal(replay.headers.get('idempotency-replayed'), 'true');
      assert.deepEqual(await replay.json(), body);

      // El chofer quedó no disponible tras cancelar, pero ya sin viaje activo puede volver a marcarse disponible.
      const perfil = await pool.query('SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1', [choferId]);
      assert.equal(perfil.rows[0].disponible, false);
      const disponibleRes = await fetch(`${baseUrl}/choferes/me/disponibilidad`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokChofer}` },
        body: JSON.stringify({ disponible: true }),
      });
      assert.equal(disponibleRes.status, 200);
    } finally {
      await new Promise((r) => servidor.close(r));
    }
  });
});
