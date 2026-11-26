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

// Por qué el dinero va en centavos enteros: en binario 0.1 y 0.2 no se representan
// exactamente, así que la suma en punto flotante acumula error. Con enteros es exacta.
test('por qué no float: 0.1 + 0.2 no da 0.3, pero 10 + 20 centavos da 30', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(0.1 + 0.2, 0.30000000000000004);
  assert.equal(10 + 20, 30);

  // Diez cargas de $0,10 en float no suman $1; en centavos sí.
  let enPesos = 0;
  let enCentavos = 0;
  for (let i = 0; i < 10; i += 1) {
    enPesos += 0.1;
    enCentavos += 10;
  }
  assert.notEqual(enPesos, 1);
  assert.equal(enCentavos, 100);

  const saldo = calcularSaldo(
    Array.from({ length: 10 }, () => ({ tipo: TipoMovimientoBilletera.CARGA, importeCentavos: 10 })),
  );
  assert.equal(saldo, 100);
});

test('validarCentavos rechaza importes con decimales, negativos y fuera del rango seguro', () => {
  for (const valor of [0.3, 12.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '100']) {
    assert.throws(() => validarCentavos(valor), (error) => error.codigo === 'IMPORTE_INVALIDO');
  }
  assert.equal(validarCentavos(0), 0);
  assert.equal(validarCentavos(150), 150);
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