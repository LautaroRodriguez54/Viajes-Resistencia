import crypto from 'node:crypto';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { calcularSaldo, decidirCobro, TipoMovimientoBilletera } from '../../dominio/billetera/billetera.js';
import { crearCandados } from './candados.js';

// Mismo contrato que repositorioBilleterasPostgres (puerto repositorioBilletera), sin base.
// - El saldo se deriva de los movimientos, igual que en Postgres: no hay campo "saldo".
// - El candado por pasajero hace el papel del FOR UPDATE sobre billeteras.
// - `enTransaccion(tx)` da la parte que usa la unidad de trabajo del cobro: el candado queda
//   retenido hasta el fin de la transacción y el consumo se escribe recién al confirmar.
export function crearRepositorioBilleteraEnMemoria() {
  const billeteras = new Map(); // pasajeroId → { id, movimientos: [{ tipo, importeCentavos, viajeId, referenciaExterna }] }
  const eventosWebhook = new Set();
  const tomarCandado = crearCandados();
  const candadoDe = (pasajeroId) => tomarCandado(`billetera:${pasajeroId}`);

  function buscar(pasajeroId) {
    const billetera = billeteras.get(pasajeroId);
    if (!billetera) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
    return billetera;
  }

  return {
    billeteras,
    // En Postgres la crea el registro del pasajero; acá la crean los tests.
    crearBilletera(pasajeroId) {
      if (!billeteras.has(pasajeroId)) billeteras.set(pasajeroId, { id: crypto.randomUUID(), movimientos: [] });
      return billeteras.get(pasajeroId).id;
    },

    async registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }) {
      const soltar = await candadoDe(pasajeroId);
      try {
        if (eventosWebhook.has(eventoExternoId)) return { procesado: false, duplicado: true, estado: 'procesado' };
        buscar(pasajeroId).movimientos.push({ tipo: TipoMovimientoBilletera.CARGA, importeCentavos, referenciaExterna: eventoExternoId });
        eventosWebhook.add(eventoExternoId);
        return { procesado: true, duplicado: false };
      } finally {
        soltar();
      }
    },

    async consultarSaldoPorPasajero(pasajeroId) {
      return { saldoCentavos: calcularSaldo(buscar(pasajeroId).movimientos) };
    },

    enTransaccion(tx) {
      return {
        async cobrar({ pasajeroId, viajeId, importeCentavos }) {
          tx.retener(await candadoDe(pasajeroId));
          const billetera = buscar(pasajeroId);
          const decision = decidirCobro({ saldoCentavos: calcularSaldo(billetera.movimientos), importeCentavos });
          if (decision.generaConsumo) {
            // Equivalente a ux_un_consumo_por_viaje.
            if (billetera.movimientos.some((m) => m.tipo === TipoMovimientoBilletera.CONSUMO && m.viajeId === viajeId)) {
              throw new Error('ux_un_consumo_por_viaje: el viaje ya tiene un consumo');
            }
            tx.alConfirmar(() => billetera.movimientos.push({ tipo: TipoMovimientoBilletera.CONSUMO, importeCentavos, viajeId }));
          }
          return { cobrado: decision.cobrado };
        },
      };
    },
  };
}
