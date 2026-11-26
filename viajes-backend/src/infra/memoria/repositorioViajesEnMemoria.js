import crypto from 'node:crypto';
import { crearCandados } from './candados.js';

// Viajes en memoria, por ahora sólo con la parte que usa la unidad de trabajo del cobro
// (bloquearParaCobro y los tres registros del cobro). Ofertas, aceptación y cambios de estado
// siguen sólo en Postgres (son de Lucas).
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
        async registrarCobroSolicitado(viajeId, { tarifaFinalCentavos }) {
          tx.alConfirmar(() => {
            Object.assign(viajes.get(viajeId), { estado: 'pago_pendiente', tarifaFinalCentavos });
            eventos.push({ viajeId, tipo: 'cobro_solicitado', datos: { importeCentavos: tarifaFinalCentavos } });
          });
        },
        async registrarCobroConfirmado(viajeId, { importeCentavos, reintento }) {
          tx.alConfirmar(() => {
            viajes.get(viajeId).estado = 'finalizado';
            eventos.push({ viajeId, tipo: 'cobro_confirmado', datos: reintento ? { importeCentavos, reintento: true } : { importeCentavos } });
          });
        },
        async registrarCobroPendiente(viajeId, { importeCentavos, motivo }) {
          tx.alConfirmar(() => eventos.push({ viajeId, tipo: 'cobro_pendiente', datos: { importeCentavos, motivo } }));
        },
      };
    },
  };
}
