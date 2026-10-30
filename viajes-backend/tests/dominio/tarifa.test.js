import test from 'node:test';
import assert from 'node:assert/strict';
import { estimarTarifa } from '../../src/dominio/viajes/tarifa.js';

const parametros = { baseCentavos: 500, porKilometroCentavos: 250, porMinutoCentavos: 100, maximoViajeCentavos: 100000, velocidadPromedioKmh: 30 };
test('la tarifa se calcula en servidor incluso para distancia cero', () => {
  const estimacion = estimarTarifa({ latitud: -27.45, longitud: -58.98 }, { latitud: -27.45, longitud: -58.98 }, parametros);
  assert.equal(estimacion.importeCentavos, 600);
  assert.equal(estimacion.minutos, 1);
});
