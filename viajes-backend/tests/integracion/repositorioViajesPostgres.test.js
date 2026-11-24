
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }

  const url = new URL(databaseUrl);

  assert.equal(
    url.pathname,
    '/viajes_test',
    'Las pruebas solo pueden ejecutarse contra viajes_test',
  );

  const pool = crearPoolPostgres({
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: false,
  });

  try {
    await ejecutar(pool);
  } finally {
    await pool.end();
  }
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  const email = `${rol}-${crypto.randomUUID()}@example.com`;

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, rol)
     VALUES ($1, $2, $3, $4)`,
    [id, email, 'hash-de-prueba', rol],
  );

  return id;
}

async function crearPasajero(pool, conBilletera = true) {
  const pasajeroId = await crearUsuario(pool, 'pasajero');
  let billeteraId = null;

  if (conBilletera) {
    const resultado = await pool.query(
      'INSERT INTO billeteras (pasajero_id) VALUES ($1) RETURNING id',
      [pasajeroId],
    );

    billeteraId = resultado.rows[0].id;
  }

  return { pasajeroId, billeteraId };
}

async function crearChofer(pool, disponible = true) {
  const choferId = await crearUsuario(pool, 'chofer');

  await pool.query(
    `INSERT INTO perfiles_chofer
       (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
     VALUES ($1, $2, 'Toyota', 'Corolla', TRUE, $3)`,
    [choferId, `TEST-${crypto.randomUUID().slice(0, 8)}`, disponible],
  );

  await pool.query(
    `INSERT INTO ubicaciones_actuales_chofer
       (chofer_id, ubicacion, reportada_at)
     VALUES (
       $1,
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       now()
     )`,
    [choferId],
  );

  return choferId;
}

async function crearViaje(pool, pasajeroId, opciones = {}) {
  const {
    choferId = null,
    estado = 'solicitado',
    importe = 5000,
  } = opciones;

  const resultado = await pool.query(
    `INSERT INTO viajes (
       pasajero_id, chofer_id, estado, origen, destino,
       estimacion_centavos, asignado_at, iniciado_at
     )
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography,
       ST_SetSRID(ST_MakePoint(-58.9800, -27.4400), 4326)::geography,
       $4,
       CASE WHEN $2::uuid IS NOT NULL THEN now() ELSE NULL END,
       CASE WHEN $3 = 'en_curso' THEN now() ELSE NULL END
     )
     RETURNING id`,
    [pasajeroId, choferId, estado, importe],
  );

  return resultado.rows[0].id;
}

async function crearOferta(pool, viajeId, choferId) {
  const resultado = await pool.query(
    `INSERT INTO ofertas_viaje (viaje_id, chofer_id, estado, vence_at)
     VALUES ($1, $2, 'pendiente', now() + interval '5 minutes')
     RETURNING id`,
    [viajeId, choferId],
  );

  return resultado.rows[0].id;
}

async function cargarSaldo(pool, billeteraId, importe) {
  await pool.query(
    `INSERT INTO movimientos_billetera (billetera_id, tipo, importe_centavos)
     VALUES ($1, 'carga', $2)`,
    [billeteraId, importe],
  );
}

test('crearSolicitud registra el viaje y su evento', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const repositorio = crearRepositorioViajesPostgres(pool);

    const viaje = await repositorio.crearSolicitud({
      pasajeroId,
      origen: { latitud: -27.4514, longitud: -58.9867 },
      destino: { latitud: -27.4400, longitud: -58.9800 },
      estimacion: { importeCentavos: 5000 },
    });

    assert.ok(viaje.id);
    assert.equal(viaje.estado, 'solicitado');
    assert.equal(viaje.pasajeroId, pasajeroId);
    assert.equal(viaje.estimacionCentavos, 5000);

    const eventos = await pool.query(
      `SELECT tipo, datos
       FROM eventos_viaje
       WHERE viaje_id = $1`,
      [viaje.id],
    );

    assert.equal(eventos.rows.length, 1);
    assert.equal(eventos.rows[0].tipo, 'viaje_solicitado');
    assert.equal(eventos.rows[0].datos.estimacionCentavos, 5000);
  });
});

test('buscarPorIdDelPasajero respeta la propiedad del viaje', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const otroPasajeroId = await crearUsuario(pool, 'pasajero');
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    const encontrado = await repositorio.buscarPorIdDelPasajero(
      viajeId,
      pasajeroId,
    );

    const ajeno = await repositorio.buscarPorIdDelPasajero(
      viajeId,
      otroPasajeroId,
    );

    assert.equal(encontrado.id, viajeId);
    assert.equal(ajeno, null);
  });
});

test('ofrecerAlChoferCercano selecciona un chofer disponible y registra la oferta', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
  await pool.query(`
    UPDATE perfiles_chofer
    SET disponible = FALSE
    WHERE disponible = TRUE
  `);

    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    const oferta = await repositorio.ofrecerAlChoferCercano(
      viajeId,
      pasajeroId,
    );

    assert.ok(oferta.ofertaId);
    assert.equal(oferta.choferId, choferId);

    const eventos = await pool.query(
      `SELECT tipo
       FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo = 'oferta_creada'`,
      [viajeId],
    );

    assert.equal(eventos.rows.length, 1);
  });
});

test('ofrecerAlChoferCercano no modifica el viaje si no hay choferes disponibles', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    await pool.query(`
      UPDATE perfiles_chofer
      SET disponible = FALSE
      WHERE disponible = TRUE
    `);

    const { pasajeroId } = await crearPasajero(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    await assert.rejects(
      repositorio.ofrecerAlChoferCercano(viajeId, pasajeroId),
    );

    const viaje = await pool.query(
      'SELECT estado FROM viajes WHERE id = $1',
      [viajeId],
    );

    const ofertas = await pool.query(
      'SELECT COUNT(*)::int AS cantidad FROM ofertas_viaje WHERE viaje_id = $1',
      [viajeId],
    );

    assert.equal(viaje.rows[0].estado, 'solicitado');
    assert.equal(ofertas.rows[0].cantidad, 0);
  });
});

test('aceptarOferta asigna el viaje, ocupa al chofer y registra el evento', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const ofertaId = await crearOferta(pool, viajeId, choferId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    const resultado = await repositorio.aceptarOferta(ofertaId, choferId);

    assert.deepEqual(resultado, {
      viajeId,
      ofertaId,
      estado: 'asignado',
    });

    const viaje = await pool.query(
      'SELECT estado, chofer_id, version FROM viajes WHERE id = $1',
      [viajeId],
    );

    assert.equal(viaje.rows[0].estado, 'asignado');
    assert.equal(viaje.rows[0].chofer_id, choferId);
    assert.equal(viaje.rows[0].version, 2);

    const chofer = await pool.query(
      'SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1',
      [choferId],
    );

    assert.equal(chofer.rows[0].disponible, false);

    const evento = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo = 'viaje_asignado'`,
      [viajeId],
    );

    assert.equal(evento.rows[0].cantidad, 1);
  });
});

test('aceptarOferta rechaza una oferta perteneciente a otro chofer', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const otroChoferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const ofertaId = await crearOferta(pool, viajeId, choferId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    await assert.rejects(
      repositorio.aceptarOferta(ofertaId, otroChoferId),
    );

    const oferta = await pool.query(
      'SELECT estado FROM ofertas_viaje WHERE id = $1',
      [ofertaId],
    );

    assert.equal(oferta.rows[0].estado, 'pendiente');
  });
});

test('avanzarEstado permite transiciones válidas y rechaza transiciones inválidas', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, {
      choferId,
      estado: 'asignado',
    });

    const repositorio = crearRepositorioViajesPostgres(pool);

    const primera = await repositorio.avanzarEstado(
      viajeId,
      choferId,
      'chofer_en_camino',
    );

    assert.equal(primera.estado, 'chofer_en_camino');

    const segunda = await repositorio.avanzarEstado(
      viajeId,
      choferId,
      'en_curso',
    );

    assert.equal(segunda.estado, 'en_curso');

    await assert.rejects(
      repositorio.avanzarEstado(viajeId, choferId, 'asignado'),
    );

    const viaje = await pool.query(
      'SELECT estado, iniciado_at, version FROM viajes WHERE id = $1',
      [viajeId],
    );

    assert.equal(viaje.rows[0].estado, 'en_curso');
    assert.ok(viaje.rows[0].iniciado_at);
    assert.equal(viaje.rows[0].version, 3);
  });
});

test('finalizarYCobrar descuenta el saldo cuando hay fondos suficientes', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, {
      choferId,
      estado: 'en_curso',
      importe: 5000,
    });

    await cargarSaldo(pool, billeteraId, 10000);

    const repositorio = crearRepositorioViajesPostgres(pool);
    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'finalizado');
    assert.equal(resultado.importeCentavos, 5000);

    const saldo = await pool.query(
      `SELECT SUM(
         CASE WHEN tipo = 'carga' THEN importe_centavos
              ELSE -importe_centavos END
       )::int AS centavos
       FROM movimientos_billetera
       WHERE billetera_id = $1`,
      [billeteraId],
    );

    assert.equal(saldo.rows[0].centavos, 5000);

    const evento = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo = 'cobro_confirmado'`,
      [viajeId],
    );

    assert.equal(evento.rows[0].cantidad, 1);
  });
});

test('finalizarYCobrar deja el viaje pendiente si el saldo es insuficiente', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, {
      choferId,
      estado: 'en_curso',
      importe: 5000,
    });

    await cargarSaldo(pool, billeteraId, 2000);

    const repositorio = crearRepositorioViajesPostgres(pool);
    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'pago_pendiente');
    assert.equal(resultado.importeCentavos, 5000);

    const consumos = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM movimientos_billetera
       WHERE viaje_id = $1 AND tipo = 'consumo'`,
      [viajeId],
    );

    assert.equal(consumos.rows[0].cantidad, 0);

    const evento = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo = 'cobro_pendiente'`,
      [viajeId],
    );

    assert.equal(evento.rows[0].cantidad, 1);
  });
});

test('dos finalizaciones simultáneas no generan dos cobros', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, {
      choferId,
      estado: 'en_curso',
      importe: 5000,
    });

    await cargarSaldo(pool, billeteraId, 10000);

    const repositorio = crearRepositorioViajesPostgres(pool);

    const resultados = await Promise.allSettled([
      repositorio.finalizarYCobrar(viajeId, choferId),
      repositorio.finalizarYCobrar(viajeId, choferId),
    ]);

    assert.equal(
      resultados.filter((resultado) => resultado.status === 'fulfilled').length,
      1,
    );

    assert.equal(
      resultados.filter((resultado) => resultado.status === 'rejected').length,
      1,
    );

    const consumos = await pool.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM movimientos_billetera
       WHERE viaje_id = $1 AND tipo = 'consumo'`,
      [viajeId],
    );

    assert.equal(consumos.rows[0].cantidad, 1);

    const saldo = await pool.query(
      `SELECT SUM(
         CASE WHEN tipo = 'carga' THEN importe_centavos
              ELSE -importe_centavos END
       )::int AS centavos
       FROM movimientos_billetera
       WHERE billetera_id = $1`,
      [billeteraId],
    );

    assert.equal(saldo.rows[0].centavos, 5000);
  });
});
