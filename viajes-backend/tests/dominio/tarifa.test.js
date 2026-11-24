import test from 'node:test';
import assert from 'node:assert/strict';
import { estimarTarifa } from '../../src/dominio/viajes/tarifa.js';

const parametros = { baseCentavos: 500, porKilometroCentavos: 250, porMinutoCentavos: 100, maximoViajeCentavos: 100000, velocidadPromedioKmh: 30 };
test('la tarifa se calcula en servidor incluso para distancia cero', () => {
  const estimacion = estimarTarifa({ latitud: -27.45, longitud: -58.98 }, { latitud: -27.45, longitud: -58.98 }, parametros);
  assert.equal(estimacion.importeCentavos, 600);
  assert.equal(estimacion.minutos, 1);
});

import { ErrorDeDominio } from '../../src/dominio/errores.js';

test('rechaza una tarifa que supera el máximo permitido', () => {
  const parametrosLimitados = {
    ...parametros,
    maximoViajeCentavos: 599
  };

  assert.throws(
    () => estimarTarifa(
      { latitud: -27.45, longitud: -58.98 },
      { latitud: -27.45, longitud: -58.98 },
      parametrosLimitados
    ),
    (error) => {
      assert.ok(error instanceof ErrorDeDominio);
      assert.equal(error.codigo, 'VIAJE_SUPERA_MAXIMO');
      return true;
    }
  );
});

test('acepta una tarifa exactamente igual al máximo permitido', () => {
  const parametrosExactos = {
    ...parametros,
    maximoViajeCentavos: 600
  };

  const estimacion = estimarTarifa(
    { latitud: -27.45, longitud: -58.98 },
    { latitud: -27.45, longitud: -58.98 },
    parametrosExactos
  );

  assert.equal(estimacion.importeCentavos, 600);
});

test('acepta una tarifa inferior al máximo permitido', () => {
  const parametrosSuperiores = {
    ...parametros,
    maximoViajeCentavos: 601
  };

  const estimacion = estimarTarifa(
    { latitud: -27.45, longitud: -58.98 },
    { latitud: -27.45, longitud: -58.98 },
    parametrosSuperiores
  );

  assert.equal(estimacion.importeCentavos, 600);
});