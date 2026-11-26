import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearFinalizarViajeYCobrar } from '../../src/aplicacion/viajes/finalizarViajeYCobrar.js';
import { crearReintentarCobro } from '../../src/aplicacion/viajes/reintentarCobro.js';
import { crearRepositorioViajesEnMemoria } from '../../src/infra/memoria/repositorioViajesEnMemoria.js';
import { crearRepositorioBilleteraEnMemoria } from '../../src/infra/memoria/repositorioBilleteraEnMemoria.js';
import { crearUnidadDeTrabajoCobroEnMemoria } from '../../src/infra/memoria/unidadDeTrabajoCobroEnMemoria.js';

// Tests de aplicación del cobro con los adaptadores en memoria (bloque 2): las mismas reglas que
// tests/integracion/repositorioViajesPostgres.test.js, pero sin Postgres.
// Desde la rama 7 el cobro va en dos pasos (ADR 008): en_curso → pago_pendiente, y después,
// con el viaje bloqueado, la billetera cobra y el viaje pasa a finalizado.

function armar({ viajes = crearRepositorioViajesEnMemoria(), billetera = crearRepositorioBilleteraEnMemoria() } = {}) {
  const dependencias = { unidadDeTrabajo: crearUnidadDeTrabajoCobroEnMemoria({ viajes }), billetera };
  return {
    viajes,
    billetera,
    finalizar: crearFinalizarViajeYCobrar(dependencias),
    reintentar: crearReintentarCobro(dependencias),
  };
}

async function crearPasajero(billetera, saldoCentavos = 0) {
  const pasajeroId = crypto.randomUUID();
  billetera.crearBilletera(pasajeroId);
  if (saldoCentavos > 0) await cargar(billetera, pasajeroId, saldoCentavos);
  return pasajeroId;
}

function cargar(billetera, pasajeroId, importeCentavos) {
  return billetera.registrarCargaDesdeWebhook({ eventoExternoId: crypto.randomUUID(), pasajeroId, importeCentavos });
}

function crearViajeEnCurso(viajes, pasajeroId, estimacionCentavos = 5000) {
  const choferId = crypto.randomUUID();
  const viajeId = viajes.agregar({ estado: 'en_curso', pasajeroId, choferId, estimacionCentavos });
  return { viajeId, choferId };
}

const saldoDe = async (billetera, pasajeroId) => (await billetera.consultarSaldoPorPasajero(pasajeroId)).saldoCentavos;
const consumosDe = (billetera, pasajeroId) => billetera.billeteras.get(pasajeroId).movimientos.filter((m) => m.tipo === 'consumo');
const eventosDe = (viajes, viajeId) => viajes.eventos.filter((e) => e.viajeId === viajeId).map((e) => e.tipo);

test('finalizarViajeYCobrar con saldo suficiente finaliza y debita la estimación', async () => {
  const { viajes, billetera, finalizar } = armar();
  const pasajeroId = await crearPasajero(billetera, 8000);
  const { viajeId, choferId } = crearViajeEnCurso(viajes, pasajeroId, 5000);

  const resultado = await finalizar({ viajeId, choferId });

  assert.deepEqual(resultado, { viajeId, estado: 'finalizado', importeCentavos: 5000 });
  assert.equal(viajes.viajes.get(viajeId).estado, 'finalizado');
  assert.equal(viajes.viajes.get(viajeId).tarifaFinalCentavos, 5000);
  assert.equal(await saldoDe(billetera, pasajeroId), 3000);
  assert.deepEqual(eventosDe(viajes, viajeId), ['cobro_solicitado', 'cobro_confirmado']);
});

test('finalizarViajeYCobrar sin saldo suficiente deja pago_pendiente y no cobra parcial', async () => {
  const { viajes, billetera, finalizar } = armar();
  const pasajeroId = await crearPasajero(billetera, 4999);
  const { viajeId, choferId } = crearViajeEnCurso(viajes, pasajeroId, 5000);

  const resultado = await finalizar({ viajeId, choferId });

  assert.equal(resultado.estado, 'pago_pendiente');
  assert.equal(viajes.viajes.get(viajeId).tarifaFinalCentavos, 5000);
  assert.equal(consumosDe(billetera, pasajeroId).length, 0);
  assert.equal(await saldoDe(billetera, pasajeroId), 4999);
  assert.deepEqual(eventosDe(viajes, viajeId), ['cobro_solicitado', 'cobro_pendiente']);
  assert.equal(viajes.eventos.at(-1).datos.motivo, 'SALDO_INSUFICIENTE');
});

test('finalizarViajeYCobrar con estimación 0 finaliza sin generar consumo', async () => {
  const { viajes, billetera, finalizar } = armar();
  const pasajeroId = await crearPasajero(billetera);
  const { viajeId, choferId } = crearViajeEnCurso(viajes, pasajeroId, 0);

  const resultado = await finalizar({ viajeId, choferId });

  assert.equal(resultado.estado, 'finalizado');
  assert.equal(consumosDe(billetera, pasajeroId).length, 0);
  assert.deepEqual(eventosDe(viajes, viajeId), ['cobro_solicitado', 'cobro_confirmado']);
});

// La billetera se crea por evento (rama 7) y puede no existir todavía: el viaje termina igual,
// queda en pago_pendiente con el motivo, y el pasajero recibe el error al reintentar.
test('finalizarViajeYCobrar sin billetera deja pago_pendiente con motivo BILLETERA_NO_ENCONTRADA', async () => {
  const { viajes, finalizar, reintentar } = armar();
  const pasajeroId = crypto.randomUUID();
  const { viajeId, choferId } = crearViajeEnCurso(viajes, pasajeroId, 5000);

  const resultado = await finalizar({ viajeId, choferId });

  assert.equal(resultado.estado, 'pago_pendiente');
  assert.deepEqual(eventosDe(viajes, viajeId), ['cobro_solicitado', 'cobro_pendiente']);
  assert.equal(viajes.eventos.at(-1).datos.motivo, 'BILLETERA_NO_ENCONTRADA');
  await assert.rejects(reintentar({ viajeId, pasajeroId }), (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA');
});

test('finalizarViajeYCobrar rechaza el viaje de otro chofer, uno inexistente y uno que no está en curso', async () => {
  const { viajes, billetera, finalizar } = armar();
  const pasajeroId = await crearPasajero(billetera, 10000);
  const { viajeId } = crearViajeEnCurso(viajes, pasajeroId);
  const asignado = viajes.agregar({ estado: 'asignado', pasajeroId, choferId: 'chofer-asignado', estimacionCentavos: 5000 });

  await assert.rejects(finalizar({ viajeId, choferId: crypto.randomUUID() }), (error) => error.codigo === 'RECURSO_NO_ENCONTRADO');
  await assert.rejects(finalizar({ viajeId: crypto.randomUUID(), choferId: 'x' }), (error) => error.codigo === 'RECURSO_NO_ENCONTRADO');
  await assert.rejects(finalizar({ viajeId: asignado, choferId: 'chofer-asignado' }), (error) => error.codigo === 'TRANSICION_INVALIDA');
  assert.equal(viajes.viajes.get(viajeId).estado, 'en_curso');
  assert.equal(consumosDe(billetera, pasajeroId).length, 0);
});

// El orden de bloqueo sigue siendo viaje → billetera: la billetera cobra DENTRO de la transacción
// de viajes, con el viaje bloqueado.
test('el caso de uso cobra con el viaje bloqueado: primero el viaje, después la billetera', async () => {
  const orden = [];
  let estado = 'en_curso';
  let dentroDeTransaccion = false;
  const unidadDeTrabajo = {
    async ejecutar(trabajo) {
      dentroDeTransaccion = true;
      try {
        return await trabajo({
          viajes: {
            bloquearParaCobro: async (viajeId) => {
              orden.push('bloquear viaje');
              return { id: viajeId, estado, pasajeroId: 'p', choferId: 'c', estimacionCentavos: 100, tarifaFinalCentavos: 100 };
            },
            registrarCobroSolicitado: async () => { orden.push('pago_pendiente'); estado = 'pago_pendiente'; },
            registrarCobroConfirmado: async () => { orden.push('finalizado'); },
          },
        });
      } finally {
        dentroDeTransaccion = false;
      }
    },
  };
  const billetera = { cobrar: async () => { orden.push(dentroDeTransaccion ? 'cobrar (viaje bloqueado)' : 'cobrar (sin bloqueo)'); return { cobrado: true }; } };

  await crearFinalizarViajeYCobrar({ unidadDeTrabajo, billetera })({ viajeId: 'v', choferId: 'c' });

  assert.deepEqual(orden, ['bloquear viaje', 'pago_pendiente', 'bloquear viaje', 'cobrar (viaje bloqueado)', 'finalizado']);
});

// Si la billetera cobró pero el registro en viajes falla (caída entre las dos bases), el viaje
// queda en pago_pendiente y el reintento lo cierra sin debitar otra vez: cobrar es idempotente por viaje.
test('si falla el registro del viaje después de cobrar, el reintento lo cierra sin debitar dos veces', async () => {
  const viajesReales = crearRepositorioViajesEnMemoria();
  let fallar = true;
  const viajesQueFallanUnaVez = {
    enTransaccion: (tx) => {
      const reales = viajesReales.enTransaccion(tx);
      return {
        ...reales,
        registrarCobroConfirmado: async (...args) => {
          if (fallar) { fallar = false; throw new Error('caída simulada'); }
          return reales.registrarCobroConfirmado(...args);
        },
      };
    },
  };
  const { billetera, finalizar, reintentar } = armar({ viajes: viajesQueFallanUnaVez });
  const pasajeroId = await crearPasajero(billetera, 10000);
  const { viajeId, choferId } = crearViajeEnCurso(viajesReales, pasajeroId, 5000);

  await assert.rejects(finalizar({ viajeId, choferId }), /caída simulada/);
  assert.equal(viajesReales.viajes.get(viajeId).estado, 'pago_pendiente');
  assert.equal(await saldoDe(billetera, pasajeroId), 5000);

  const resultado = await reintentar({ viajeId, pasajeroId });

  assert.equal(resultado.estado, 'finalizado');
  assert.equal(consumosDe(billetera, pasajeroId).length, 1);
  assert.equal(await saldoDe(billetera, pasajeroId), 5000);
});

// Carrera de la variante D, sin Postgres: el candado por pasajero hace de FOR UPDATE.
test('dos viajes distintos del mismo pasajero cobrados a la vez: sólo uno consume el saldo', async () => {
  const { viajes, billetera, finalizar } = armar();
  for (let intento = 0; intento < 10; intento += 1) {
    const pasajeroId = await crearPasajero(billetera, 5000);
    const a = crearViajeEnCurso(viajes, pasajeroId, 5000);
    const b = crearViajeEnCurso(viajes, pasajeroId, 5000);

    const resultados = await Promise.all([finalizar(a), finalizar(b)]);

    assert.deepEqual(resultados.map((r) => r.estado).sort(), ['finalizado', 'pago_pendiente']);
    assert.equal(consumosDe(billetera, pasajeroId).length, 1);
    assert.equal(await saldoDe(billetera, pasajeroId), 0);
  }
});

test('dos finalizaciones simultáneas del mismo viaje cobran una sola vez', async () => {
  const { viajes, billetera, finalizar } = armar();
  const pasajeroId = await crearPasajero(billetera, 10000);
  const viaje = crearViajeEnCurso(viajes, pasajeroId, 5000);

  const resultados = await Promise.allSettled([finalizar(viaje), finalizar(viaje)]);

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find((r) => r.status === 'rejected').reason.codigo, 'TRANSICION_INVALIDA');
  assert.equal(await saldoDe(billetera, pasajeroId), 5000);
});

test('reintentarCobro paga la deuda después de una carga', async () => {
  const { viajes, billetera, finalizar, reintentar } = armar();
  const pasajeroId = await crearPasajero(billetera);
  const viaje = crearViajeEnCurso(viajes, pasajeroId, 5000);
  assert.equal((await finalizar(viaje)).estado, 'pago_pendiente');
  await cargar(billetera, pasajeroId, 8000);

  const resultado = await reintentar({ viajeId: viaje.viajeId, pasajeroId });

  assert.deepEqual(resultado, { viajeId: viaje.viajeId, estado: 'finalizado', importeCentavos: 5000 });
  assert.equal(await saldoDe(billetera, pasajeroId), 3000);
  assert.deepEqual(eventosDe(viajes, viaje.viajeId), ['cobro_solicitado', 'cobro_pendiente', 'cobro_confirmado']);
  assert.equal(viajes.eventos.at(-1).datos.reintento, true);
});

test('reintentarCobro: saldo insuficiente, viaje ajeno y viaje sin deuda se rechazan sin debitar', async () => {
  const { viajes, billetera, finalizar, reintentar } = armar();
  const pasajeroId = await crearPasajero(billetera, 1000);
  const otro = await crearPasajero(billetera, 10000);
  const viaje = crearViajeEnCurso(viajes, pasajeroId, 5000);
  await finalizar(viaje);

  await assert.rejects(reintentar({ viajeId: viaje.viajeId, pasajeroId }), (error) => error.codigo === 'SALDO_INSUFICIENTE');
  assert.equal(viajes.viajes.get(viaje.viajeId).estado, 'pago_pendiente');
  await assert.rejects(reintentar({ viajeId: viaje.viajeId, pasajeroId: otro }), (error) => error.codigo === 'RECURSO_NO_ENCONTRADO');
  const enCurso = crearViajeEnCurso(viajes, otro, 5000);
  await assert.rejects(reintentar({ viajeId: enCurso.viajeId, pasajeroId: otro }), (error) => error.codigo === 'TRANSICION_INVALIDA');
  assert.equal(await saldoDe(billetera, pasajeroId), 1000);
  assert.equal(await saldoDe(billetera, otro), 10000);
});

test('dos reintentos simultáneos del mismo viaje cobran una sola vez', async () => {
  const { viajes, billetera, finalizar, reintentar } = armar();
  const pasajeroId = await crearPasajero(billetera);
  const viaje = crearViajeEnCurso(viajes, pasajeroId, 5000);
  await finalizar(viaje);
  await cargar(billetera, pasajeroId, 20000);

  const resultados = await Promise.allSettled([
    reintentar({ viajeId: viaje.viajeId, pasajeroId }),
    reintentar({ viajeId: viaje.viajeId, pasajeroId }),
  ]);

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find((r) => r.status === 'rejected').reason.codigo, 'TRANSICION_INVALIDA');
  assert.equal(consumosDe(billetera, pasajeroId).length, 1);
  assert.equal(await saldoDe(billetera, pasajeroId), 15000);
});

test('repositorioBilleteraEnMemoria: un webhook repetido acredita una sola vez', async () => {
  const billetera = crearRepositorioBilleteraEnMemoria();
  const pasajeroId = await crearPasajero(billetera);
  const carga = { eventoExternoId: 'evt-1', pasajeroId, importeCentavos: 1500 };

  assert.deepEqual(await billetera.registrarCargaDesdeWebhook(carga), { procesado: true, duplicado: false });
  assert.equal((await billetera.registrarCargaDesdeWebhook(carga)).duplicado, true);
  assert.equal(await saldoDe(billetera, pasajeroId), 1500);
  await assert.rejects(billetera.consultarSaldoPorPasajero('sin-billetera'), (error) => error.codigo === 'BILLETERA_NO_ENCONTRADA');
});

test('repositorioBilleteraEnMemoria: el evento UsuarioRegistrado repetido crea una sola billetera', async () => {
  const billetera = crearRepositorioBilleteraEnMemoria();
  const pasajeroId = crypto.randomUUID();

  assert.deepEqual(await billetera.crearBilleteraPorEvento({ eventoId: 'e1', pasajeroId }), { creada: true, duplicado: false });
  assert.deepEqual(await billetera.crearBilleteraPorEvento({ eventoId: 'e1', pasajeroId }), { creada: false, duplicado: true });
  assert.equal(billetera.eventos.filter((e) => e.tipo === 'BilleteraCreada').length, 1);
});
