import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularSaldo, TipoMovimientoBilletera } from '../../src/dominio/billetera/billetera.js';
import { validarCentavos } from '../../src/dominio/billetera/dinero.js';

test('el saldo se deriva de cargas y consumos expresados en centavos', () => {
  const saldo = calcularSaldo([
    { tipo: TipoMovimientoBilletera.CARGA, importeCentavos: 1_000 },
    { tipo: TipoMovimientoBilletera.CONSUMO, importeCentavos: 250 },
  ]);

  assert.equal(saldo, 750);
});

test('los importes de dinero no aceptan punto flotante', () => {
  assert.throws(
    () => validarCentavos(0.1),
    (error) => error.codigo === 'IMPORTE_INVALIDO',
  );
});

// Nuevos tests

test('una billetera sin movimientos tiene saldo cero', () => {
  const saldo = calcularSaldo([]);

  assert.equal(saldo, 0);
});

test('calcula correctamente el saldo con múltiples movimientos', () => {
  const saldo = calcularSaldo([
    { tipo: TipoMovimientoBilletera.CARGA, importeCentavos: 1_000 },
    { tipo: TipoMovimientoBilletera.CARGA, importeCentavos: 500 },
    { tipo: TipoMovimientoBilletera.CONSUMO, importeCentavos: 300 },
    { tipo: TipoMovimientoBilletera.CONSUMO, importeCentavos: 200 },
    { tipo: TipoMovimientoBilletera.CARGA, importeCentavos: 250 },
  ]);

  assert.equal(saldo, 1_250);
});

test('rechaza un tipo de movimiento desconocido', () => {
  assert.throws(
    () => calcularSaldo([
      { tipo: 'transferencia', importeCentavos: 500 },
    ]),
    (error) => error.codigo === 'MOVIMIENTO_INVALIDO',
  );
});

test('rechaza un movimiento con importe negativo', () => {
  assert.throws(
    () => calcularSaldo([
      { tipo: TipoMovimientoBilletera.CARGA, importeCentavos: -100 },
    ]),
    (error) => error.codigo === 'IMPORTE_INVALIDO',
  );
});