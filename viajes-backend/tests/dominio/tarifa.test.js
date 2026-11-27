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
// Tarifa de demo 2026 (seed): calibrada con el promedio que publica Uber para UberX desde el aeropuerto de
// Resistencia (19 min, $ 13.379). Ver docs/modelo.md, "Tarifa".
const tarifa2026 = {
  baseCentavos: 150_000, porKilometroCentavos: 90_000, porMinutoCentavos: 18_000,
  maximoViajeCentavos: 10_000_000, velocidadPromedioKmh: 25,
};
const plaza = { latitud: -27.4514, longitud: -58.9867 };
const aeropuerto = { latitud: -27.4500, longitud: -59.0561 };

test('calibración: aeropuerto → plaza queda a menos del 10 % del promedio de UberX ($ 13.379)', () => {
  const { importeCentavos, kilometros, minutos } = estimarTarifa(aeropuerto, plaza, tarifa2026);
  assert.ok(Math.abs(importeCentavos - 1_337_900) / 1_337_900 < 0.10, `estimó ${importeCentavos / 100}`);
  assert.ok(kilometros > 8 && kilometros < 10, 'la distancia por calles es mayor que la línea recta (~6,9 km)');
  assert.ok(minutos >= 19 && minutos <= 23);
});

test('la distancia se estima por calles (línea recta × 1,3) y los kilómetros se cobran con decimales', () => {
  const sinTiempo = { ...tarifa2026, porMinutoCentavos: 0 };
  // ~1 km en línea recta hacia el este.
  const destino = { latitud: -27.4514, longitud: -58.9766 };
  const { importeCentavos, kilometros } = estimarTarifa(plaza, destino, sinTiempo);
  assert.ok(kilometros > 1.25 && kilometros < 1.35, `kilómetros: ${kilometros}`);
  // Con decimales: base + 1,3 km × $ 900 ≈ $ 2.670 (antes, redondeando para arriba, se cobraban 2 km).
  assert.ok(importeCentavos > 260_000 && importeCentavos < 272_000, `importe: ${importeCentavos}`);
  assert.ok(Number.isInteger(importeCentavos), 'siempre centavos enteros');
});

test('a más distancia, más caro (y nunca menos que la base)', () => {
  const cerca = estimarTarifa(plaza, { latitud: -27.4560, longitud: -58.9867 }, tarifa2026).importeCentavos;
  const lejos = estimarTarifa(plaza, { latitud: -27.4800, longitud: -58.9867 }, tarifa2026).importeCentavos;
  assert.ok(cerca >= tarifa2026.baseCentavos);
  assert.ok(lejos > cerca);
});

test('el total se redondea a pesos enteros (múltiplo de 100 centavos)', () => {
  const { importeCentavos } = estimarTarifa(plaza, { latitud: -27.4562, longitud: -59.0225 }, tarifa2026);
  assert.equal(importeCentavos % 100, 0);
});
