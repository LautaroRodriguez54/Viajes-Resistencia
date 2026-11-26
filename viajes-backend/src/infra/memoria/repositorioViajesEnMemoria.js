import crypto from 'node:crypto';
import { crearCandados } from './candados.js';

// Viajes en memoria, por ahora sólo con la parte que usa la unidad de trabajo del cobro
// (bloquearParaCobro, registrarFinalizacion, registrarPagoDeDeuda). Ofertas, aceptación y
// cambios de estado siguen sólo en Postgres (son de Lucas).
export function crearRepositorioViajesEnMemoria() {
  const viajes = new Map(); // viajeId → { id, estado, pasajeroId, choferId, estimacionCentavos, tarifaFinalCentavos }
  const eventos = []; // equivalente a eventos_viaje: { viajeId, tipo, datos }
  const tomarCandado = crearCandados();

  return {
    viajes,
    eventos,
    agregar(viaje) {
      const nuevo = { id: crypto.randomUUID(), estado: 'solicitado', choferId: null, estimacionCentavos: 0, tarifaFinalCentavos: null, ...viaje };
      viajes.set(nuevo.id, nuevo);
      return nuevo.id;
    },

    enTransaccion(tx) {
      return {
        async bloquearParaCobro(viajeId) {
          tx.retener(await tomarCandado(`viaje:${viajeId}`));
          const viaje = viajes.get(viajeId);
          return viaje ? { ...viaje } : null;
        },
        async registrarFinalizacion(viajeId, { estado, tarifaFinalCentavos }) {
          const tipo = estado === 'finalizado' ? 'cobro_confirmado' : 'cobro_pendiente';
          tx.alConfirmar(() => {
            Object.assign(viajes.get(viajeId), { estado, tarifaFinalCentavos });
            eventos.push({ viajeId, tipo, datos: { importeCentavos: tarifaFinalCentavos } });
          });
        },
        async registrarPagoDeDeuda(viajeId, { importeCentavos }) {
          tx.alConfirmar(() => {
            viajes.get(viajeId).estado = 'finalizado';
            eventos.push({ viajeId, tipo: 'cobro_confirmado', datos: { importeCentavos, reintento: true } });
          });
        },
      };
    },
  };
}
