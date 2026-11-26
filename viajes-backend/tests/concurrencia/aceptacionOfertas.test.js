import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de concurrencia');
    return;
  }
  const url = new URL(databaseUrl);
  assert.equal(url.pathname, '/viajes_test', 'Las pruebas solo pueden ejecutarse contra viajes_test');

  const pool = crearPoolPostgres({ DATABASE_URL: databaseUrl, DATABASE_SSL: false });
  try {
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

async function crearPasajero(pool) {
  const pasajeroId = await crearUsuario(pool, 'pasajero');
  // La billetera ya no está en la base de viajes (ADR 008) y la aceptación no la necesita.
  return pasajeroId;
}

async function crearChofer(pool, disponible = true) {
  const choferId = await crearUsuario(pool, 'chofer');
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, $3)`,
    [choferId, `CON-${crypto.randomUUID().slice(0, 8)}`, disponible],
  );
  await pool.query(
    `INSERT INTO ubicaciones_actuales_chofer (chofer_id, ubicacion, reportada_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography, now())`,
    [choferId],
  );
  return choferId;
}

async function crearViaje(pool, pasajeroId, opciones = {}) {
  const { choferId = null, estado = 'solicitado', importe = 5000 } = opciones;
  const { rows } = await pool.query(
    `INSERT INTO viajes (pasajero_id, chofer_id, estado, origen, destino, estimacion_centavos, asignado_at)
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.9800, -27.4400), 4326)::geography,
       $4,
       CASE WHEN $2::uuid IS NOT NULL THEN now() ELSE NULL END
     )
     RETURNING id`,
    [pasajeroId, choferId, estado, importe],
  );
  return rows[0].id;
}

async function crearOferta(pool, viajeId, choferId, intervaloVencimiento = "5 minutes") {
  const { rows } = await pool.query(
    `INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at)
     VALUES ($1, $2, 'pendiente', now() + $3::interval)
     RETURNING id`,
    [viajeId, choferId, intervaloVencimiento],
  );
  return rows[0].id;
}

test('50 aceptaciones simultáneas sobre el mismo viaje asignan exactamente una y cierran las competidoras', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearPasajero(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    const choferes = [];
    const ofertas = [];
    for (let i = 0; i < 50; i += 1) {
      const choferId = await crearChofer(pool, true);
      const ofertaId = await crearOferta(pool, viajeId, choferId);
      choferes.push(choferId);
      ofertas.push({ ofertaId, choferId });
    }

    const resultados = await Promise.allSettled(
      ofertas.map(({ ofertaId, choferId }) => repositorio.aceptarOferta(ofertaId, choferId)),
    );

    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');

    assert.equal(exitos.length, 1);
    assert.equal(rechazos.length, 49);
    assert.equal(exitos[0].value.estado, 'asignado');
    for (const rechazo of rechazos) {
      assert.equal(rechazo.reason?.codigo, 'OFERTA_NO_DISPONIBLE');
    }

    const { rows: viajeRows } = await pool.query('SELECT estado, chofer_id, version FROM viajes WHERE id = $1', [viajeId]);
    assert.equal(viajeRows[0].estado, 'asignado');
    assert.equal(viajeRows[0].chofer_id, exitos[0].value.viajeId ? ofertas.find((o) => o.ofertaId === exitos[0].value.ofertaId).choferId : null);
    assert.equal(viajeRows[0].version, 2);

    const { rows: estadosOfertas } = await pool.query(
      'SELECT estado, COUNT(*)::int AS cantidad FROM ofertas_viaje WHERE viaje_id = $1 GROUP BY estado',
      [viajeId],
    );
    const conteo = new Map(estadosOfertas.map((r) => [r.estado, r.cantidad]));
    assert.equal(conteo.get('aceptada'), 1);
    assert.equal(conteo.get('vencida'), 49);
    assert.equal(conteo.get('pendiente') ?? 0, 0);

    const { rows: eventos } = await pool.query(
      "SELECT COUNT(*)::int AS cantidad FROM eventos_viaje WHERE viaje_id = $1 AND tipo = 'viaje_asignado'",
      [viajeId],
    );
    assert.equal(eventos[0].cantidad, 1);

    const { rows: disponibles } = await pool.query(
      'SELECT COUNT(*)::int AS cantidad FROM perfiles_chofer WHERE usuario_id = ANY($1::uuid[]) AND disponible = FALSE',
      [choferes],
    );
    assert.equal(disponibles[0].cantidad, 1);
  });
});

test('chofer con viaje activo queda bloqueado para aceptar otro viaje o marcarse disponible, pero puede reportar ubicación', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajero1 = await crearPasajero(pool);
    const pasajero2 = await crearPasajero(pool);
    const choferId = await crearChofer(pool, true);
    const repoViajes = crearRepositorioViajesPostgres(pool);
    const repoChoferes = crearRepositorioChoferesPostgres(pool);

    const viaje1 = await crearViaje(pool, pasajero1);
    const viaje2 = await crearViaje(pool, pasajero2);
    const oferta1 = await crearOferta(pool, viaje1, choferId);
    const oferta2 = await crearOferta(pool, viaje2, choferId);

    const carreras = await Promise.allSettled([
      repoViajes.aceptarOferta(oferta1, choferId),
      repoViajes.aceptarOferta(oferta2, choferId),
    ]);
    assert.equal(carreras.filter((r) => r.status === 'fulfilled').length, 1);
    const rechazo = carreras.find((r) => r.status === 'rejected');
    assert.ok(rechazo);
    assert.equal(rechazo.reason?.codigo, 'CHOFER_CON_VIAJE_ACTIVO');

    await assert.rejects(
      repoChoferes.cambiarDisponibilidad(choferId, true),
      (err) => err.codigo === 'CHOFER_CON_VIAJE_ACTIVO',
    );

    const ubicacion = await repoChoferes.registrarUbicacion(choferId, { latitud: -27.452, longitud: -58.985 });
    assert.equal(ubicacion.choferId, choferId);
  });
});

test('ofrecerAlChoferCercano evita ofertas duplicadas y respeta SKIP LOCKED ante viajes simultáneos', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    await pool.query('UPDATE perfiles_chofer SET disponible = FALSE WHERE disponible = TRUE');

    const pasajero1 = await crearPasajero(pool);
    const pasajero2 = await crearPasajero(pool);
    const chofer1 = await crearChofer(pool, true);
    const chofer2 = await crearChofer(pool, true);
    const repoViajes = crearRepositorioViajesPostgres(pool);

    const viaje1 = await crearViaje(pool, pasajero1);
    const viaje2 = await crearViaje(pool, pasajero2);

    const [res1, res2] = await Promise.all([
      repoViajes.ofrecerAlChoferCercano(viaje1, pasajero1),
      repoViajes.ofrecerAlChoferCercano(viaje2, pasajero2),
    ]);
    assert.notEqual(res1.choferId, res2.choferId);
    assert.ok([chofer1, chofer2].includes(res1.choferId));
    assert.ok([chofer1, chofer2].includes(res2.choferId));

    await assert.rejects(
      repoViajes.ofrecerAlChoferCercano(viaje1, pasajero1),
      (err) => err.codigo === 'SIN_CHOFERES_CERCANOS',
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at) VALUES ($1, $2, 'pendiente', now() + interval '1 minute')",
        [viaje1, res1.choferId],
      ),
      (err) => err.code === '23505',
    );
  });
});

test('aceptarOferta evalúa el vencimiento con now() de PostgreSQL y rechaza ofertas vencidas', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const pasajeroId = await crearPasajero(pool);
    const choferId = await crearChofer(pool, true);
    const viajeId = await crearViaje(pool, pasajeroId);
    const ofertaVencida = await crearOferta(pool, viajeId, choferId, '-5 seconds');
    const repoViajes = crearRepositorioViajesPostgres(pool);

    await assert.rejects(
      repoViajes.aceptarOferta(ofertaVencida, choferId),
      (err) => err.codigo === 'OFERTA_NO_DISPONIBLE',
    );
  });
});
