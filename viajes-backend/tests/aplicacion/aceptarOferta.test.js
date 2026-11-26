import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearAceptarOferta } from '../../src/aplicacion/viajes/aceptarOferta.js';
import { crearCancelarViaje } from '../../src/aplicacion/viajes/cancelarViaje.js';
import { crearRepositorioViajesEnMemoria } from '../../src/infra/memoria/repositorioViajesEnMemoria.js';
import { crearUnidadDeTrabajoViajesEnMemoria } from '../../src/infra/memoria/unidadDeTrabajoViajesEnMemoria.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

function armar() {
  const viajes = crearRepositorioViajesEnMemoria();
  const unidadDeTrabajo = crearUnidadDeTrabajoViajesEnMemoria({ viajes });
  return {
    viajes,
    aceptarOferta: crearAceptarOferta({ unidadDeTrabajo }),
    cancelarViaje: crearCancelarViaje({ unidadDeTrabajo }),
  };
}

test('aceptarOferta asigna el viaje, cierra competidoras, ocupa al chofer y sube version', async () => {
  const { viajes, aceptarOferta } = armar();
  const pasajeroId = crypto.randomUUID();
  const chofer1 = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
  const chofer2 = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });
  const oferta1 = viajes.agregarOferta({ viajeId, choferId: chofer1 });
  const oferta2 = viajes.agregarOferta({ viajeId, choferId: chofer2 });

  const resultado = await aceptarOferta({ ofertaId: oferta1, choferId: chofer1 });
  assert.deepEqual(resultado, { viajeId, ofertaId: oferta1, estado: 'asignado' });
  assert.equal(viajes.viajes.get(viajeId).estado, 'asignado');
  assert.equal(viajes.viajes.get(viajeId).choferId, chofer1);
  assert.equal(viajes.viajes.get(viajeId).version, 2);
  assert.equal(viajes.ofertas.get(oferta1).estado, 'aceptada');
  assert.equal(viajes.ofertas.get(oferta2).estado, 'vencida');
  assert.equal(viajes.choferes.get(chofer1).disponible, false);
  assert.equal(viajes.eventos.filter((e) => e.viajeId === viajeId && e.tipo === 'viaje_asignado').length, 1);
});

test('aceptarOferta valida oferta inexistente, ajena, vencida y chofer no elegible', async () => {
  const { viajes, aceptarOferta } = armar();
  const pasajeroId = crypto.randomUUID();
  const chofer1 = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
  const choferDeshab = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: false, disponible: true });
  const choferOcupado = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: false });
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });
  const ofertaVigente = viajes.agregarOferta({ viajeId, choferId: chofer1 });
  const ofertaVencida = viajes.agregarOferta({ viajeId, choferId: chofer1, venceAt: new Date(Date.now() - 5_000) });
  const ofertaDeshab = viajes.agregarOferta({ viajeId, choferId: choferDeshab });
  const ofertaOcupado = viajes.agregarOferta({ viajeId, choferId: choferOcupado });

  await assert.rejects(
    aceptarOferta({ ofertaId: crypto.randomUUID(), choferId: chofer1 }),
    (err) => err.codigo === 'OFERTA_NO_ENCONTRADA',
  );
  await assert.rejects(
    aceptarOferta({ ofertaId: ofertaVigente, choferId: crypto.randomUUID() }),
    (err) => err.codigo === 'RECURSO_PROHIBIDO',
  );
  await assert.rejects(
    aceptarOferta({ ofertaId: ofertaVencida, choferId: chofer1 }),
    (err) => err.codigo === 'OFERTA_NO_DISPONIBLE',
  );
  await assert.rejects(
    aceptarOferta({ ofertaId: ofertaDeshab, choferId: choferDeshab }),
    (err) => err.codigo === 'CHOFER_NO_HABILITADO',
  );
  await assert.rejects(
    aceptarOferta({ ofertaId: ofertaOcupado, choferId: choferOcupado }),
    (err) => err.codigo === 'CHOFER_NO_DISPONIBLE',
  );
});

test('50 aceptaciones simultáneas en memoria sobre el mismo viaje asignan exactamente una', async () => {
  const { viajes, aceptarOferta } = armar();
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId: crypto.randomUUID() });
  const ofertas = Array.from({ length: 50 }, () => {
    const choferId = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
    const ofertaId = viajes.agregarOferta({ viajeId, choferId });
    return { ofertaId, choferId };
  });

  const resultados = await Promise.allSettled(
    ofertas.map(({ ofertaId, choferId }) => aceptarOferta({ ofertaId, choferId })),
  );

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  const rechazos = resultados.filter((r) => r.status === 'rejected');
  assert.equal(rechazos.length, 49);
  for (const rechazo of rechazos) {
    assert.equal(rechazo.reason?.codigo, 'OFERTA_NO_DISPONIBLE');
  }
  assert.equal([...viajes.ofertas.values()].filter((o) => o.estado === 'aceptada').length, 1);
  assert.equal([...viajes.ofertas.values()].filter((o) => o.estado === 'vencida').length, 49);
});

test('mismo chofer aceptando dos ofertas en paralelo en memoria: sólo una gana', async () => {
  const { viajes, aceptarOferta } = armar();
  const choferId = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
  const viaje1 = viajes.agregar({ estado: 'solicitado', pasajeroId: crypto.randomUUID() });
  const viaje2 = viajes.agregar({ estado: 'solicitado', pasajeroId: crypto.randomUUID() });
  const oferta1 = viajes.agregarOferta({ viajeId: viaje1, choferId });
  const oferta2 = viajes.agregarOferta({ viajeId: viaje2, choferId });

  const resultados = await Promise.allSettled([
    aceptarOferta({ ofertaId: oferta1, choferId }),
    aceptarOferta({ ofertaId: oferta2, choferId }),
  ]);

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find((r) => r.status === 'rejected')?.reason?.codigo, 'CHOFER_CON_VIAJE_ACTIVO');
});

test('carrera en memoria: cancelación de pasajero vs aceptación simultánea mantiene invariantes', async () => {
  const { viajes, aceptarOferta, cancelarViaje } = armar();
  for (let ronda = 0; ronda < 8; ronda += 1) {
    const pasajeroId = crypto.randomUUID();
    const choferId = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: true });
    const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });
    const ofertaId = viajes.agregarOferta({ viajeId, choferId });

    const [resCancelar, resAceptar] = await Promise.allSettled([
      cancelarViaje({ viajeId, actorId: pasajeroId, rol: Rol.PASAJERO, motivo: 'Cambio de planes' }),
      aceptarOferta({ ofertaId, choferId }),
    ]);

    assert.equal(resCancelar.status, 'fulfilled');
    if (resAceptar.status === 'rejected') {
      assert.equal(resAceptar.reason?.codigo, 'OFERTA_NO_DISPONIBLE');
    }
    assert.equal(viajes.viajes.get(viajeId).estado, 'cancelado_pasajero');
    assert.equal(viajes.choferes.get(choferId).disponible, true);
  }
});
