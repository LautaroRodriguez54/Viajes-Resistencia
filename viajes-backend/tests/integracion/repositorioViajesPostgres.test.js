
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearUnidadDeTrabajoCobroPostgres } from '../../src/infra/db/unidadDeTrabajoCobroPostgres.js';
import { crearFinalizarViajeYCobrar } from '../../src/aplicacion/viajes/finalizarViajeYCobrar.js';
import { crearReintentarCobro } from '../../src/aplicacion/viajes/reintentarCobro.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearCasosDeUsoViajesPostgres } from '../ayudas/casosDeUsoViajesPostgres.js';
import { urlsDePrueba } from '../ayudas/basesDePrueba.js';

// La billetera vive en billetera_test (ADR 008): este pool lo abre conBaseDePrueba y lo usan los
// helpers que tocan tablas de la billetera.
let poolBilletera;

// El cobro ya no es un método del repositorio: son los casos de uso sobre la unidad de trabajo
// Postgres y el repositorio de la billetera. Se envuelven con la firma de antes para no reescribir los tests.
function crearCobroPostgres(pool) {
  const dependencias = { unidadDeTrabajo: crearUnidadDeTrabajoCobroPostgres(pool), billetera: crearRepositorioBilleterasPostgres(poolBilletera) };
  const finalizar = crearFinalizarViajeYCobrar(dependencias);
  const reintentar = crearReintentarCobro(dependencias);
  return {
    finalizarYCobrar: (viajeId, choferId) => finalizar({ viajeId, choferId }),
    reintentarCobro: (viajeId, pasajeroId) => reintentar({ viajeId, pasajeroId }),
  };
}

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
  poolBilletera = crearPoolPostgres({ DATABASE_URL: urlsDePrueba().billetera, DATABASE_SSL: false });

  try {
    await ejecutar(pool);
  } finally {
    await Promise.all([pool.end(), poolBilletera.end()]);
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
    const resultado = await poolBilletera.query(
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
  await poolBilletera.query(
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
    const { ofrecerAlChoferCercano } = crearCasosDeUsoViajesPostgres(pool);

    const oferta = await ofrecerAlChoferCercano({
      viajeId,
      pasajeroId,
    });

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
    const { ofrecerAlChoferCercano } = crearCasosDeUsoViajesPostgres(pool);

    await assert.rejects(
      ofrecerAlChoferCercano({ viajeId, pasajeroId }),
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
    const { aceptarOferta } = crearCasosDeUsoViajesPostgres(pool);

    const resultado = await aceptarOferta({ ofertaId, choferId });

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
    const { aceptarOferta } = crearCasosDeUsoViajesPostgres(pool);

    await assert.rejects(
      aceptarOferta({ ofertaId, choferId: otroChoferId }),
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

    const { avanzarEstado } = crearCasosDeUsoViajesPostgres(pool);

    const primera = await avanzarEstado({
      viajeId,
      choferId,
      nuevoEstado: 'chofer_en_camino',
    });

    assert.equal(primera.estado, 'chofer_en_camino');

    const segunda = await avanzarEstado({
      viajeId,
      choferId,
      nuevoEstado: 'en_curso',
    });

    assert.equal(segunda.estado, 'en_curso');

    await assert.rejects(
      avanzarEstado({ viajeId, choferId, nuevoEstado: 'asignado' }),
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

    const repositorio = crearCobroPostgres(pool);
    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'finalizado');
    assert.equal(resultado.importeCentavos, 5000);

    const saldo = await poolBilletera.query(
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

    const repositorio = crearCobroPostgres(pool);
    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'pago_pendiente');
    assert.equal(resultado.importeCentavos, 5000);

    const consumos = await poolBilletera.query(
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

    const repositorio = crearCobroPostgres(pool);

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

    const consumos = await poolBilletera.query(
      `SELECT COUNT(*)::int AS cantidad
       FROM movimientos_billetera
       WHERE viaje_id = $1 AND tipo = 'consumo'`,
      [viajeId],
    );

    assert.equal(consumos.rows[0].cantidad, 1);

    const saldo = await poolBilletera.query(
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

async function saldoDe(pool, billeteraId) {
  const { rows } = await poolBilletera.query(
    `SELECT COALESCE(SUM(
       CASE WHEN tipo = 'carga' THEN importe_centavos
            ELSE -importe_centavos END
     ), 0)::int AS centavos
     FROM movimientos_billetera
     WHERE billetera_id = $1`,
    [billeteraId],
  );
  return rows[0].centavos;
}

async function estadoDe(pool, viajeId) {
  const { rows } = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
  return rows[0].estado;
}

async function contarConsumosDelViaje(pool, viajeId) {
  const { rows } = await poolBilletera.query(
    `SELECT COUNT(*)::int AS cantidad FROM movimientos_billetera
     WHERE viaje_id = $1 AND tipo = 'consumo'`,
    [viajeId],
  );
  return rows[0].cantidad;
}

async function crearViajeEnPagoPendiente(pool, pasajeroId, importe) {
  const choferId = await crearChofer(pool);
  const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'en_curso', importe });
  const resultado = await crearCobroPostgres(pool).finalizarYCobrar(viajeId, choferId);
  assert.equal(resultado.estado, 'pago_pendiente');
  return viajeId;
}

// Carrera de la variante D: dos viajes distintos del mismo pasajero se cobran a la vez
// contra un saldo que alcanza para uno solo. El FOR UPDATE sobre la billetera serializa
// los dos cobros: el segundo ve el consumo del primero y no gasta saldo que ya no existe.
test('dos viajes distintos del mismo pasajero cobrados a la vez: sólo uno consume el saldo', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearCobroPostgres(pool);

    // Se repite con varios pasajeros para que la carrera ocurra de verdad y no por suerte del orden.
    for (let intento = 0; intento < 10; intento += 1) {
      const { pasajeroId, billeteraId } = await crearPasajero(pool);
      const choferA = await crearChofer(pool);
      const choferB = await crearChofer(pool);
      const viajeA = await crearViaje(pool, pasajeroId, { choferId: choferA, estado: 'en_curso', importe: 5000 });
      const viajeB = await crearViaje(pool, pasajeroId, { choferId: choferB, estado: 'en_curso', importe: 5000 });
      await cargarSaldo(pool, billeteraId, 5000);

      const resultados = await Promise.all([
        repositorio.finalizarYCobrar(viajeA, choferA),
        repositorio.finalizarYCobrar(viajeB, choferB),
      ]);

      assert.deepEqual(resultados.map((r) => r.estado).sort(), ['finalizado', 'pago_pendiente']);
      assert.equal(
        (await contarConsumosDelViaje(pool, viajeA)) + (await contarConsumosDelViaje(pool, viajeB)),
        1,
      );
      assert.equal(await saldoDe(pool, billeteraId), 0);
    }
  });
});

test('finalizarYCobrar con estimación 0 finaliza sin generar movimiento', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'en_curso', importe: 0 });
    const repositorio = crearCobroPostgres(pool);

    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'finalizado');
    assert.equal(resultado.importeCentavos, 0);
    assert.equal(await contarConsumosDelViaje(pool, viajeId), 0);
    assert.equal(await saldoDe(pool, billeteraId), 0);

    const evento = await pool.query(
      `SELECT COUNT(*)::int AS cantidad FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo = 'cobro_confirmado'`,
      [viajeId],
    );
    assert.equal(evento.rows[0].cantidad, 1);
  });
});

// Rama 7: la billetera está en otra base y se crea por evento, así que puede no existir todavía.
// El viaje terminó igual: queda en pago_pendiente con el motivo, y el reintento del pasajero sí
// recibe BILLETERA_NO_ENCONTRADA.
test('finalizarYCobrar sin billetera deja el viaje en pago_pendiente con motivo BILLETERA_NO_ENCONTRADA', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool, false);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'en_curso', importe: 5000 });
    const repositorio = crearCobroPostgres(pool);

    const resultado = await repositorio.finalizarYCobrar(viajeId, choferId);

    assert.equal(resultado.estado, 'pago_pendiente');
    assert.equal(await estadoDe(pool, viajeId), 'pago_pendiente');
    const evento = await pool.query("SELECT datos FROM eventos_viaje WHERE viaje_id = $1 AND tipo = 'cobro_pendiente'", [viajeId]);
    assert.equal(evento.rows[0].datos.motivo, 'BILLETERA_NO_ENCONTRADA');
    await assert.rejects(
      repositorio.reintentarCobro(viajeId, pasajeroId),
      (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA',
    );
  });
});

test('reintentarCobro cobra un viaje en pago_pendiente después de una carga', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const viajeId = await crearViajeEnPagoPendiente(pool, pasajeroId, 5000);
    await cargarSaldo(pool, billeteraId, 8000);
    const repositorio = crearCobroPostgres(pool);

    const resultado = await repositorio.reintentarCobro(viajeId, pasajeroId);

    assert.deepEqual(resultado, { viajeId, estado: 'finalizado', importeCentavos: 5000 });
    assert.equal(await estadoDe(pool, viajeId), 'finalizado');
    assert.equal(await saldoDe(pool, billeteraId), 3000);

    const eventos = await pool.query(
      `SELECT tipo, datos FROM eventos_viaje
       WHERE viaje_id = $1 AND tipo IN ('cobro_pendiente', 'cobro_confirmado')
       ORDER BY id`,
      [viajeId],
    );
    assert.deepEqual(eventos.rows.map((fila) => fila.tipo), ['cobro_pendiente', 'cobro_confirmado']);
    assert.equal(eventos.rows[1].datos.reintento, true);
  });
});

test('reintentarCobro con saldo insuficiente no debita y el viaje sigue en pago_pendiente', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const viajeId = await crearViajeEnPagoPendiente(pool, pasajeroId, 5000);
    await cargarSaldo(pool, billeteraId, 4999);
    const repositorio = crearCobroPostgres(pool);

    await assert.rejects(
      repositorio.reintentarCobro(viajeId, pasajeroId),
      (error) => error.codigo === 'SALDO_INSUFICIENTE',
    );
    assert.equal(await estadoDe(pool, viajeId), 'pago_pendiente');
    assert.equal(await saldoDe(pool, billeteraId), 4999);
  });
});

test('reintentarCobro no cobra el viaje de otro pasajero ni un viaje sin deuda', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const otro = await crearPasajero(pool);
    const viajeId = await crearViajeEnPagoPendiente(pool, pasajeroId, 5000);
    await cargarSaldo(pool, otro.billeteraId, 10000);
    const repositorio = crearCobroPostgres(pool);

    await assert.rejects(
      repositorio.reintentarCobro(viajeId, otro.pasajeroId),
      (error) => error.codigo === 'RECURSO_NO_ENCONTRADO',
    );
    assert.equal(await saldoDe(pool, otro.billeteraId), 10000);

    const enCurso = await crearViaje(pool, pasajeroId, { choferId: await crearChofer(pool), estado: 'en_curso' });
    await cargarSaldo(pool, billeteraId, 10000);
    await assert.rejects(
      repositorio.reintentarCobro(enCurso, pasajeroId),
      (error) => error.codigo === 'TRANSICION_INVALIDA',
    );
    assert.equal(await contarConsumosDelViaje(pool, enCurso), 0);
  });
});

test('dos reintentos de cobro simultáneos del mismo viaje cobran una sola vez', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId, billeteraId } = await crearPasajero(pool);
    const viajeId = await crearViajeEnPagoPendiente(pool, pasajeroId, 5000);
    await cargarSaldo(pool, billeteraId, 20000);
    const repositorio = crearCobroPostgres(pool);

    const resultados = await Promise.allSettled([
      repositorio.reintentarCobro(viajeId, pasajeroId),
      repositorio.reintentarCobro(viajeId, pasajeroId),
    ]);

    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultados.find((r) => r.status === 'rejected').reason.codigo, 'TRANSICION_INVALIDA');
    assert.equal(await contarConsumosDelViaje(pool, viajeId), 1);
    assert.equal(await saldoDe(pool, billeteraId), 15000);
  });
});

test('buscarOfertaPendienteDelChofer devuelve sólo la oferta vigente del propio chofer', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const otroChoferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    assert.equal(await repositorio.buscarOfertaPendienteDelChofer(choferId), null);

    const ofertaId = await crearOferta(pool, viajeId, choferId);
    const oferta = await repositorio.buscarOfertaPendienteDelChofer(choferId);
    assert.equal(oferta.ofertaId, ofertaId);
    assert.equal(oferta.viajeId, viajeId);
    assert.equal(oferta.estimacionCentavos, 5000);
    assert.ok(Math.abs(oferta.origen.latitud - -27.4514) < 1e-6);
    assert.ok(Math.abs(oferta.origen.longitud - -58.9867) < 1e-6);
    assert.ok(Math.abs(oferta.destino.latitud - -27.44) < 1e-6);
    assert.equal(await repositorio.buscarOfertaPendienteDelChofer(otroChoferId), null);

    // Vencida: ya no se muestra aunque siga en estado 'pendiente'.
    await pool.query("UPDATE ofertas_viaje SET vence_at = now() - interval '1 second' WHERE id = $1", [ofertaId]);
    assert.equal(await repositorio.buscarOfertaPendienteDelChofer(choferId), null);
  });
});

test('buscarViajeActualDelChofer devuelve el viaje activo y null al finalizar', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool, false);
    const repositorio = crearRepositorioViajesPostgres(pool);

    assert.equal(await repositorio.buscarViajeActualDelChofer(choferId), null);

    const viajeId = await crearViaje(pool, pasajeroId, { choferId, estado: 'en_curso', importe: 0 });
    const viaje = await repositorio.buscarViajeActualDelChofer(choferId);
    assert.equal(viaje.id, viajeId);
    assert.equal(viaje.estado, 'en_curso');
    assert.equal(viaje.estimacionCentavos, 0);
    assert.ok(Math.abs(viaje.destino.longitud - -58.98) < 1e-6);

    await crearCobroPostgres(pool).finalizarYCobrar(viajeId, choferId);
    assert.equal(await repositorio.buscarViajeActualDelChofer(choferId), null);
  });
});

test('buscarPorIdDelPasajero informa tieneOfertaVigente según ofertas pendientes no vencidas', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const { pasajeroId } = await crearPasajero(pool);
    const choferId = await crearChofer(pool);
    const viajeId = await crearViaje(pool, pasajeroId);
    const repositorio = crearRepositorioViajesPostgres(pool);

    assert.equal((await repositorio.buscarPorIdDelPasajero(viajeId, pasajeroId)).tieneOfertaVigente, false);

    const ofertaId = await crearOferta(pool, viajeId, choferId);
    assert.equal((await repositorio.buscarPorIdDelPasajero(viajeId, pasajeroId)).tieneOfertaVigente, true);

    await pool.query("UPDATE ofertas_viaje SET vence_at = now() - interval '1 second' WHERE id = $1", [ofertaId]);
    assert.equal((await repositorio.buscarPorIdDelPasajero(viajeId, pasajeroId)).tieneOfertaVigente, false);

    await pool.query("UPDATE ofertas_viaje SET estado = 'rechazada', vence_at = now() + interval '1 minute' WHERE id = $1", [ofertaId]);
    assert.equal((await repositorio.buscarPorIdDelPasajero(viajeId, pasajeroId)).tieneOfertaVigente, false);
  });
});
