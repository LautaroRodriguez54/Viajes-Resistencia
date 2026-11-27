import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearAvanzarEstadoViaje } from '../../src/aplicacion/viajes/avanzarEstadoViaje.js';
import { crearCancelarViaje } from '../../src/aplicacion/viajes/cancelarViaje.js';
import { crearRepositorioViajesEnMemoria } from '../../src/infra/memoria/repositorioViajesEnMemoria.js';
import { crearUnidadDeTrabajoViajesEnMemoria } from '../../src/infra/memoria/unidadDeTrabajoViajesEnMemoria.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

function armar() {
  const viajes = crearRepositorioViajesEnMemoria();
  const unidadDeTrabajo = crearUnidadDeTrabajoViajesEnMemoria({ viajes });
  return {
    viajes,
    avanzarEstado: crearAvanzarEstadoViaje({ unidadDeTrabajo }),
    cancelarViaje: crearCancelarViaje({ unidadDeTrabajo }),
  };
}

test('avanzarEstadoViaje permite transiciones válidas, sube version y rechaza inválidas o ajenas', async () => {
  const { viajes, avanzarEstado } = armar();
  const pasajeroId = crypto.randomUUID();
  const choferId = crypto.randomUUID();
  const viajeId = viajes.agregar({ estado: 'asignado', pasajeroId, choferId });

  const paso1 = await avanzarEstado({ viajeId, choferId, nuevoEstado: 'chofer_en_camino' });
  assert.deepEqual(paso1, { viajeId, estado: 'chofer_en_camino' });

  const paso2 = await avanzarEstado({ viajeId, choferId, nuevoEstado: 'en_curso' });
  assert.deepEqual(paso2, { viajeId, estado: 'en_curso' });

  const guardado = viajes.viajes.get(viajeId);
  assert.equal(guardado.estado, 'en_curso');
  assert.ok(guardado.iniciadoAt instanceof Date);
  assert.equal(guardado.version, 3);

  await assert.rejects(
    avanzarEstado({ viajeId, choferId, nuevoEstado: 'asignado' }),
    (error) => error.codigo === 'TRANSICION_INVALIDA',
  );
  await assert.rejects(
    avanzarEstado({ viajeId, choferId: crypto.randomUUID(), nuevoEstado: 'en_curso' }),
    (error) => error.codigo === 'RECURSO_NO_ENCONTRADO',
  );
});

test('cancelarViaje aplica reglas por rol, vence ofertas pendientes y libera chofer sólo si corresponde', async () => {
  const { viajes, cancelarViaje } = armar();
  const pasajeroId = crypto.randomUUID();
  const choferHabilitado = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: false });
  const choferDeshabilitado = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: false, disponible: false });

  // 1. Pasajero cancela en solicitado: vence ofertas pendientes.
  const viajeSolicitado = viajes.agregar({ estado: 'solicitado', pasajeroId });
  const ofertaId = viajes.agregarOferta({ viajeId: viajeSolicitado, choferId: choferHabilitado, estado: 'pendiente' });
  const resSolicitado = await cancelarViaje({ viajeId: viajeSolicitado, actorId: pasajeroId, rol: Rol.PASAJERO, motivo: 'Demora' });
  assert.equal(resSolicitado.estado, 'cancelado_pasajero');
  assert.equal(viajes.ofertas.get(ofertaId).estado, 'vencida');

  // 2. Pasajero cancela asignado: libera chofer habilitado, pero no habilita uno deshabilitado.
  const viajeAsignado = viajes.agregar({ estado: 'asignado', pasajeroId, choferId: choferHabilitado });
  await cancelarViaje({ viajeId: viajeAsignado, actorId: pasajeroId, rol: Rol.PASAJERO });
  assert.equal(viajes.choferes.get(choferHabilitado).disponible, true);

  const viajeDeshab = viajes.agregar({ estado: 'asignado', pasajeroId, choferId: choferDeshabilitado });
  await cancelarViaje({ viajeId: viajeDeshab, actorId: pasajeroId, rol: Rol.PASAJERO });
  assert.equal(viajes.choferes.get(choferDeshabilitado).disponible, false);

  // 3. Chofer cancela chofer_en_camino: queda disponible=false.
  viajes.choferes.get(choferHabilitado).disponible = false;
  const viajeChofer = viajes.agregar({ estado: 'chofer_en_camino', pasajeroId, choferId: choferHabilitado });
  const resChofer = await cancelarViaje({ viajeId: viajeChofer, actorId: choferHabilitado, rol: Rol.CHOFER, motivo: 'Pinchadura' });
  assert.equal(resChofer.estado, 'cancelado_chofer');
  assert.equal(viajes.choferes.get(choferHabilitado).disponible, false);

  // 4. Operador cancela en_curso con motivo obligatorio y libera chofer.
  const viajeCurso = viajes.agregar({ estado: 'en_curso', pasajeroId, choferId: choferHabilitado });
  await assert.rejects(
    cancelarViaje({ viajeId: viajeCurso, actorId: crypto.randomUUID(), rol: Rol.OPERADOR, motivo: 'ab' }),
    (error) => error.codigo === 'ENTRADA_INVALIDA',
  );
  const resOperador = await cancelarViaje({ viajeId: viajeCurso, actorId: crypto.randomUUID(), rol: Rol.OPERADOR, motivo: 'Incidente reportado' });
  assert.equal(resOperador.estado, 'cancelado_operador');
  assert.equal(viajes.choferes.get(choferHabilitado).disponible, true);
  assert.equal(viajes.viajes.get(viajeCurso).version, 2);
});

test('carrera en memoria: cancelarViaje vs avanzarEstado en_curso: exactamente uno gana', async () => {
  const { viajes, avanzarEstado, cancelarViaje } = armar();
  for (let ronda = 0; ronda < 10; ronda += 1) {
    const pasajeroId = crypto.randomUUID();
    const choferId = viajes.agregarChofer({ id: crypto.randomUUID(), habilitado: true, disponible: false });
    const viajeId = viajes.agregar({ estado: 'chofer_en_camino', pasajeroId, choferId });

    const resultados = await Promise.allSettled([
      cancelarViaje({ viajeId, actorId: pasajeroId, rol: Rol.PASAJERO }),
      avanzarEstado({ viajeId, choferId, nuevoEstado: 'en_curso' }),
    ]);

    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultados.find((r) => r.status === 'rejected')?.reason?.codigo, 'TRANSICION_INVALIDA');
  }
});
