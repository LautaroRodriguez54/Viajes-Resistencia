import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEstimarViaje } from '../../src/aplicacion/viajes/estimarViaje.js';
import { crearSolicitarViaje } from '../../src/aplicacion/viajes/solicitarViaje.js';

const parametros = { baseCentavos: 150_000, porKilometroCentavos: 90_000, porMinutoCentavos: 18_000, maximoViajeCentavos: 10_000_000, velocidadPromedioKmh: 25 };
const plaza = { latitud: -27.4514, longitud: -58.9867 };
const terminal = { latitud: -27.4562, longitud: -59.0225 };

test('la estimación previa coincide con la que se guarda al pedir el viaje y no escribe nada', async () => {
  const creados = [];
  const viajes = {
    obtenerParametrosTarifaActivos: async () => parametros,
    crearSolicitud: async (datos) => { creados.push(datos); return { id: 'v1', estimacionCentavos: datos.estimacion.importeCentavos }; },
  };
  const previa = await crearEstimarViaje({ viajes })({ origen: plaza, destino: terminal });
  assert.equal(creados.length, 0, 'estimar no crea el viaje');
  const pedido = await crearSolicitarViaje({ viajes })({ pasajeroId: 'p1', origen: plaza, destino: terminal });
  assert.equal(previa.importeCentavos, pedido.estimacionCentavos);
  assert.ok(previa.kilometros > 0 && previa.minutos >= 1);
});

test('la estimación previa respeta el máximo y la falta de tarifa (mismos errores que al pedir)', async () => {
  const sinTarifa = { obtenerParametrosTarifaActivos: async () => { const e = new Error('x'); e.codigo = 'TARIFA_NO_CONFIGURADA'; throw e; } };
  await assert.rejects(crearEstimarViaje({ viajes: sinTarifa })({ origen: plaza, destino: terminal }), { codigo: 'TARIFA_NO_CONFIGURADA' });
  const conTope = { obtenerParametrosTarifaActivos: async () => ({ ...parametros, maximoViajeCentavos: 200_000 }) };
  await assert.rejects(crearEstimarViaje({ viajes: conTope })({ origen: plaza, destino: terminal }), { codigo: 'VIAJE_SUPERA_MAXIMO' });
});
