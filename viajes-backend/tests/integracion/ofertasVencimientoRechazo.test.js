import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearDespachadorVencimientoOfertas } from '../../src/infra/db/despachadorVencimientoOfertas.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';
import { crearCasosDeUsoViajesPostgres } from '../ayudas/casosDeUsoViajesPostgres.js';

const loggerMudo = { info() {}, warn() {}, error() {} };

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
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

async function conApp(pool, fn) {
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
  const { avanzarEstado } = crearCasosDeUsoViajesPostgres(pool);
  const noUsado = async () => { throw new Error('no usado en este test'); };
  const app = crearApp({
    config,
    logger: loggerMudo,
    verificarDisponibilidad: async () => true,
    autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
    billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, tokens },
    viajes: {
      solicitarViaje: noUsado,
      buscarViajePropio: viajes.buscarPorIdDelPasajero,
      ofrecerAlChoferCercano: viajes.ofrecerAlChoferCercano,
      reintentarCobro: noUsado,
      tokens,
    },
    ofertas: { aceptarOferta: viajes.aceptarOferta, rechazarOferta: viajes.rechazarOferta, tokens },
    choferes: {
      cambiarDisponibilidad: noUsado,
      registrarUbicacion: noUsado,
      avanzarEstado,
      finalizarYCobrar: noUsado,
      buscarOfertaPendiente: viajes.buscarOfertaPendienteDelChofer,
      buscarViajeActual: viajes.buscarViajeActualDelChofer,
      tokens,
    },
    administracion: { establecerHabilitacion: noUsado, tokens },
    idempotencia: crearRepositorioIdempotenciaPostgres(pool),
  });
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`, tokens, viajes);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
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

async function crearChofer(pool, { disponible = true, antiguedadUbicacion = '0 seconds' } = {}) {
  const choferId = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, $3)`,
    [choferId, `VR-${crypto.randomUUID().slice(0, 8)}`, disponible],
  );
  await pool.query(
    `INSERT INTO ubicaciones_actuales_chofer (chofer_id, ubicacion, reportada_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography, now() - $2::interval)`,
    [choferId, antiguedadUbicacion],
  );
  return choferId;
}

async function crearViaje(pool, pasajeroId) {
  const { rows } = await pool.query(
    `INSERT INTO viajes (pasajero_id, estado, origen, destino, estimacion_centavos)
     VALUES (
       $1, 'solicitado',
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.9800, -27.4400), 4326)::geography,
       1500
     )
     RETURNING id`,
    [pasajeroId],
  );
  return rows[0].id;
}

test('POST /ofertas/:ofertaId/rechazar re-ofrece al siguiente chofer, soporta idempotencia y pasa a sin_choferes_disponibles al agotar candidatos', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearUsuario(pool, 'pasajero');
    const chofer1 = await crearChofer(pool);
    const chofer2 = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);

    await conApp(pool, async (baseUrl, tokens, viajes) => {
      const primeraOferta = await viajes.ofrecerAlChoferCercano(viajeId, pasajeroId);
      const primero = primeraOferta.choferId;
      const segundo = primero === chofer1 ? chofer2 : chofer1;

      const tokenPrimero = tokens.crearTokenDeAcceso({ usuarioId: primero, rol: Rol.CHOFER });
      const tokenSegundo = tokens.crearTokenDeAcceso({ usuarioId: segundo, rol: Rol.CHOFER });

      // Un tercero no puede rechazar la oferta ajena.
      const ajeno = await fetch(`${baseUrl}/ofertas/${primeraOferta.ofertaId}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenSegundo}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(ajeno.status, 403);
      assert.equal((await ajeno.json()).error?.codigo, 'RECURSO_PROHIBIDO');

      // Inexistente -> 404.
      const inexistente = await fetch(`${baseUrl}/ofertas/${crypto.randomUUID()}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenPrimero}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(inexistente.status, 404);
      assert.equal((await inexistente.json()).error?.codigo, 'OFERTA_NO_ENCONTRADA');

      const claveRechazo1 = crypto.randomUUID();
      const rechazo1 = await fetch(`${baseUrl}/ofertas/${primeraOferta.ofertaId}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenPrimero}`, 'idempotency-key': claveRechazo1 },
      });
      assert.equal(rechazo1.status, 200);
      const body1 = await rechazo1.json();
      assert.deepEqual(body1, {
        viajeId,
        ofertaId: primeraOferta.ofertaId,
        estado: 'rechazada',
        viajeEstado: 'solicitado',
        reofrecida: true,
      });

      // Replay idempotente con la misma clave no crea otra oferta.
      const replay = await fetch(`${baseUrl}/ofertas/${primeraOferta.ofertaId}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenPrimero}`, 'idempotency-key': claveRechazo1 },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.headers.get('idempotency-replayed'), 'true');
      assert.deepEqual(await replay.json(), body1);

      // Reintentar con otra clave sobre oferta ya rechazada -> 409 OFERTA_NO_DISPONIBLE.
      const repetida = await fetch(`${baseUrl}/ofertas/${primeraOferta.ofertaId}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenPrimero}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(repetida.status, 409);
      assert.equal((await repetida.json()).error?.codigo, 'OFERTA_NO_DISPONIBLE');

      // El segundo chofer ve su oferta en GET /choferes/me/ofertas (contrato intacto).
      const ofertaSegundoRes = await fetch(`${baseUrl}/choferes/me/ofertas`, {
        headers: { authorization: `Bearer ${tokenSegundo}` },
      });
      assert.equal(ofertaSegundoRes.status, 200);
      const { oferta: segundaOferta } = await ofertaSegundoRes.json();
      assert.ok(segundaOferta);
      assert.equal(segundaOferta.viajeId, viajeId);

      // El segundo chofer rechaza y no quedan candidatos (el primero queda excluido).
      const rechazo2 = await fetch(`${baseUrl}/ofertas/${segundaOferta.ofertaId}/rechazar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenSegundo}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(rechazo2.status, 200);
      assert.deepEqual(await rechazo2.json(), {
        viajeId,
        ofertaId: segundaOferta.ofertaId,
        estado: 'rechazada',
        viajeEstado: 'sin_choferes_disponibles',
        reofrecida: false,
      });

      const viajeFinal = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
      assert.equal(viajeFinal.rows[0].estado, 'sin_choferes_disponibles');
    });
  });
});

test('ofrecerAlChoferCercano distingue rechazada vs vencida y limpia filas fantasma pendientes', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearUsuario(pool, 'pasajero');
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repo = crearRepositorioViajesPostgres(pool);

    const oferta1 = await repo.ofrecerAlChoferCercano(viajeId, pasajeroId);
    // Simula vencimiento antes de que corra el despachador (fila fantasma pendiente con vence_at <= now()).
    await pool.query("UPDATE ofertas_viaje SET vence_at = now() - interval '5 seconds' WHERE id = $1", [oferta1.ofertaId]);

    // Al volver a ofrecer, limpia la fila fantasma a 'vencida' y puede emitir nueva oferta al único chofer.
    const oferta2 = await repo.ofrecerAlChoferCercano(viajeId, pasajeroId);
    assert.notEqual(oferta2.ofertaId, oferta1.ofertaId);
    assert.equal(oferta2.choferId, choferId);

    const estado1 = await pool.query('SELECT estado FROM ofertas_viaje WHERE id = $1', [oferta1.ofertaId]);
    assert.equal(estado1.rows[0].estado, 'vencida');

    // Si rechaza la oferta2, no vuelve a ser candidato en ofrecerAlChoferCercano.
    await pool.query("UPDATE ofertas_viaje SET estado = 'rechazada', respondida_at = now() WHERE id = $1", [oferta2.ofertaId]);
    await assert.rejects(
      repo.ofrecerAlChoferCercano(viajeId, pasajeroId),
      (err) => err.codigo === 'SIN_CHOFERES_CERCANOS',
    );
  });
});

test('UBICACION_TTL_SEGUNDOS filtra choferes con ubicación vieja cuando está configurado', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearUsuario(pool, 'pasajero');
    const choferViejo = await crearChofer(pool, { antiguedadUbicacion: '180 seconds' });
    const viajeId = await crearViaje(pool, pasajeroId);

    const repoConTtl = crearRepositorioViajesPostgres(pool, { ubicacionTtlSegundos: 60 });
    await assert.rejects(
      repoConTtl.ofrecerAlChoferCercano(viajeId, pasajeroId),
      (err) => err.codigo === 'SIN_CHOFERES_CERCANOS',
    );

    const repoSinTtl = crearRepositorioViajesPostgres(pool);
    const oferta = await repoSinTtl.ofrecerAlChoferCercano(viajeId, pasajeroId);
    assert.equal(oferta.choferId, choferViejo);
  });
});

test('procesarOfertasVencidas y despachador automático vencen ofertas, re-ofrecen y marcan sin_choferes_disponibles', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearUsuario(pool, 'pasajero');
    const chofer1 = await crearChofer(pool);
    const chofer2 = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repo = crearRepositorioViajesPostgres(pool, { ofertaTtlSegundos: 30 });

    const oferta1 = await repo.ofrecerAlChoferCercano(viajeId, pasajeroId);
    await pool.query("UPDATE ofertas_viaje SET vence_at = now() - interval '2 seconds' WHERE id = $1", [oferta1.ofertaId]);

    const despachador = crearDespachadorVencimientoOfertas({
      procesarOfertasVencidas: repo.procesarOfertasVencidas,
      logger: loggerMudo,
      intervaloMs: 25,
    });
    despachador.iniciar();

    // Espera a que el despachador venza la primera oferta y emita la segunda al otro chofer.
    let segunda = null;
    for (let i = 0; i < 30; i += 1) {
      const { rows } = await pool.query(
        "SELECT id, chofer_id FROM ofertas_viaje WHERE viaje_id = $1 AND estado = 'pendiente' AND id <> $2",
        [viajeId, oferta1.ofertaId],
      );
      if (rows[0]) {
        segunda = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    await despachador.detener();

    assert.ok(segunda);
    assert.notEqual(segunda.chofer_id, oferta1.choferId);
    assert.ok([chofer1, chofer2].includes(segunda.chofer_id));

    // Vence la segunda oferta y verifica transición final a sin_choferes_disponibles sin re-ofrecer a los ya vencidos.
    await pool.query("UPDATE ofertas_viaje SET vence_at = now() - interval '2 seconds' WHERE id = $1", [segunda.id]);
    const procesadas = await repo.procesarOfertasVencidas();
    assert.equal(procesadas.length, 1);
    assert.equal(procesadas[0].viajeEstado, 'sin_choferes_disponibles');
    assert.equal(procesadas[0].reofrecida, false);

    const viajeRow = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
    assert.equal(viajeRow.rows[0].estado, 'sin_choferes_disponibles');

    const eventos = await pool.query(
      "SELECT tipo FROM eventos_viaje WHERE viaje_id = $1 AND tipo IN ('oferta_vencida', 'viaje_sin_choferes_disponibles') ORDER BY id",
      [viajeId],
    );
    assert.deepEqual(
      eventos.rows.map((e) => e.tipo),
      ['oferta_vencida', 'oferta_vencida', 'viaje_sin_choferes_disponibles'],
    );
  });
});
