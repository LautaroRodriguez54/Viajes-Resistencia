import test from 'node:test';
import assert from 'node:assert/strict';
import { Rol } from '../../src/dominio/usuarios/roles.js';
import {
  EstadoViaje,
  ESTADOS_ACTIVOS_OPERADOR,
  decidirCancelacion,
} from '../../src/dominio/viajes/estadosViaje.js';

test('pasajero puede cancelar en solicitado, asignado o chofer_en_camino y libera chofer sólo si estaba asignado', () => {
  const enSolicitado = decidirCancelacion({ estadoActual: EstadoViaje.SOLICITADO, rol: Rol.PASAJERO });
  assert.deepEqual(enSolicitado, {
    nuevoEstado: EstadoViaje.CANCELADO_PASAJERO,
    motivo: null,
    liberarChofer: false,
  });

  const enCamino = decidirCancelacion({
    estadoActual: EstadoViaje.CHOFER_EN_CAMINO,
    rol: Rol.PASAJERO,
    motivo: '  Demora en la esquina  ',
  });
  assert.deepEqual(enCamino, {
    nuevoEstado: EstadoViaje.CANCELADO_PASAJERO,
    motivo: 'Demora en la esquina',
    liberarChofer: true,
  });

  for (const estado of [EstadoViaje.EN_CURSO, EstadoViaje.PAGO_PENDIENTE, EstadoViaje.FINALIZADO]) {
    assert.throws(
      () => decidirCancelacion({ estadoActual: estado, rol: Rol.PASAJERO }),
      (err) => err.codigo === 'TRANSICION_INVALIDA',
    );
  }
});

test('chofer puede cancelar en asignado o chofer_en_camino sin reactivarse automáticamente', () => {
  const enAsignado = decidirCancelacion({ estadoActual: EstadoViaje.ASIGNADO, rol: Rol.CHOFER, motivo: '' });
  assert.deepEqual(enAsignado, {
    nuevoEstado: EstadoViaje.CANCELADO_CHOFER,
    motivo: null,
    liberarChofer: false,
  });

  for (const estado of [EstadoViaje.SOLICITADO, EstadoViaje.EN_CURSO, EstadoViaje.PAGO_PENDIENTE]) {
    assert.throws(
      () => decidirCancelacion({ estadoActual: estado, rol: Rol.CHOFER }),
      (err) => err.codigo === 'TRANSICION_INVALIDA',
    );
  }
});

test('operador puede cancelar hasta en_curso, exige motivo válido y no cancela pago_pendiente', () => {
  const enCurso = decidirCancelacion({
    estadoActual: EstadoViaje.EN_CURSO,
    rol: Rol.OPERADOR,
    motivo: '  Pedido del pasajero  ',
  });
  assert.deepEqual(enCurso, {
    nuevoEstado: EstadoViaje.CANCELADO_OPERADOR,
    motivo: 'Pedido del pasajero',
    liberarChofer: true,
  });

  for (const motivoInvalido of [null, undefined, '   ', 'ab', 'x'.repeat(201)]) {
    assert.throws(
      () => decidirCancelacion({ estadoActual: EstadoViaje.ASIGNADO, rol: Rol.OPERADOR, motivo: motivoInvalido }),
      (err) => err.codigo === 'ENTRADA_INVALIDA',
    );
  }

  assert.throws(
    () => decidirCancelacion({ estadoActual: EstadoViaje.PAGO_PENDIENTE, rol: Rol.OPERADOR, motivo: 'Motivo válido' }),
    (err) => err.codigo === 'TRANSICION_INVALIDA',
  );
  assert.ok(ESTADOS_ACTIVOS_OPERADOR.includes(EstadoViaje.PAGO_PENDIENTE));
});

test('roles no autorizados reciben RECURSO_PROHIBIDO', () => {
  assert.throws(
    () => decidirCancelacion({ estadoActual: EstadoViaje.SOLICITADO, rol: Rol.ADMINISTRADOR, motivo: 'Motivo' }),
    (err) => err.codigo === 'RECURSO_PROHIBIDO',
  );
});
