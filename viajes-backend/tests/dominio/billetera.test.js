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

