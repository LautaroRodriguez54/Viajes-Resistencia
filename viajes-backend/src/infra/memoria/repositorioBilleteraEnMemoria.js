import crypto from 'node:crypto';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { calcularSaldo, decidirCobro, TipoMovimientoBilletera } from '../../dominio/billetera/billetera.js';
import { crearCandados } from './candados.js';

// Mismo contrato que repositorioBilleterasPostgres (puerto repositorioBilletera), sin base.
// - El saldo se deriva de los movimientos, igual que en Postgres: no hay campo "saldo".
// - El candado por pasajero hace el papel del FOR UPDATE sobre billeteras.
// - Cada operación es su propia "transacción": toma el candado, decide, escribe y lo suelta.
// - `eventos` hace de outbox_billetera (lo usan los tests de la proyección).
export function crearRepositorioBilleteraEnMemoria() {
  const billeteras = new Map(); // pasajeroId → { id, movimientos: [{ tipo, importeCentavos, viajeId, referenciaExterna }] }
  const eventosWebhook = new Set();
  const eventosConsumidos = new Set();
  const eventos = [];
  const tomarCandado = crearCandados();

  function buscar(pasajeroId) {
    const billetera = billeteras.get(pasajeroId);
    if (!billetera) throw new ErrorDeDominio('BILLETERA_NO_ENCONTRADA', 'El pasajero no tiene billetera.');
    return billetera;
  }

  async function conCandado(pasajeroId, trabajo) {
    const soltar = await tomarCandado(`billetera:${pasajeroId}`);
    try {
      return trabajo();
    } finally {
      soltar();
    }
  }

  function crear(pasajeroId) {
    if (billeteras.has(pasajeroId)) return false;
    billeteras.set(pasajeroId, { id: crypto.randomUUID(), movimientos: [] });
    eventos.push({ id: crypto.randomUUID(), tipo: 'BilleteraCreada', datos: { pasajeroId } });
    return true;
  }

  return {
    billeteras,
    eventos,
    // En Postgres la crea el evento UsuarioRegistrado; los tests la crean directo.
    crearBilletera(pasajeroId) {
      crear(pasajeroId);
      return billeteras.get(pasajeroId).id;
    },

    async registrarCargaDesdeWebhook({ eventoExternoId, pasajeroId, importeCentavos }) {
      return conCandado(pasajeroId, () => {
        if (eventosWebhook.has(eventoExternoId)) return { procesado: false, duplicado: true, estado: 'procesado' };
        buscar(pasajeroId).movimientos.push({ tipo: TipoMovimientoBilletera.CARGA, importeCentavos, referenciaExterna: eventoExternoId });
        eventosWebhook.add(eventoExternoId);
        eventos.push({ id: crypto.randomUUID(), tipo: 'MovimientoRegistrado', datos: { pasajeroId, tipo: 'carga', importeCentavos } });
        return { procesado: true, duplicado: false };
      });
    },

    async consultarSaldoPorPasajero(pasajeroId) {
      return { saldoCentavos: calcularSaldo(buscar(pasajeroId).movimientos) };
    },

    async cobrar({ pasajeroId, viajeId, importeCentavos }) {
      return conCandado(pasajeroId, () => {
        const billetera = buscar(pasajeroId);
        // Idempotente por viajeId, como ux_un_consumo_por_viaje + la consulta previa en Postgres.
        if (billetera.movimientos.some((m) => m.tipo === TipoMovimientoBilletera.CONSUMO && m.viajeId === viajeId)) {
          return { cobrado: true };
        }
        const decision = decidirCobro({ saldoCentavos: calcularSaldo(billetera.movimientos), importeCentavos });
        if (decision.generaConsumo) {
          billetera.movimientos.push({ tipo: TipoMovimientoBilletera.CONSUMO, importeCentavos, viajeId });
          eventos.push({ id: crypto.randomUUID(), tipo: 'MovimientoRegistrado', datos: { pasajeroId, tipo: 'consumo', importeCentavos, viajeId } });
        }
        return { cobrado: decision.cobrado };
      });
    },

    async crearBilleteraPorEvento({ eventoId, pasajeroId }) {
      if (eventosConsumidos.has(eventoId)) return { creada: false, duplicado: true };
      eventosConsumidos.add(eventoId);
      return { creada: crear(pasajeroId), duplicado: false };
    },
  };
}
