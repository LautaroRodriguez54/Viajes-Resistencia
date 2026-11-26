import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// Cobro de un viaje en pago_pendiente, compartido por finalizarViajeYCobrar y reintentarCobro.
//
// Viajes y billetera están en bases distintas (tema 12, ADR 008), así que no hay una transacción
// única. Lo que sí hay:
// - Orden de bloqueo viaje → billetera: el viaje queda bloqueado (FOR UPDATE en `viajes`) mientras
//   la billetera cobra en su propia transacción (FOR UPDATE en `billetera`). Dos cobros del mismo
//   viaje van de a uno; dos cobros del mismo pasajero también.
// - `cobrar` es idempotente por viajeId: si la billetera ya cobró pero el COMMIT de `viajes` no
//   llegó, el viaje sigue en pago_pendiente y el próximo intento lo cierra sin debitar de nuevo.
//
// `verificar(viaje)` lanza si el actor no puede cobrar ese viaje. `estricto`: el reintento del
// pasajero propaga los errores; el finalizar del chofer los deja registrados y el viaje sigue en
// pago_pendiente (el viaje terminó igual; lo que falta es el pago).
export async function cobrarViajePendiente({ unidadDeTrabajo, billetera, logger }, { viajeId, verificar, estricto }) {
  return unidadDeTrabajo.ejecutar(async ({ viajes }) => {
    const viaje = await viajes.bloquearParaCobro(viajeId);
    verificar(viaje);
    const importeCentavos = viaje.tarifaFinalCentavos;
    if (viaje.estado !== EstadoViaje.PAGO_PENDIENTE) {
      if (estricto) throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Sólo un viaje con pago pendiente puede reintentar el cobro.');
      // Otro pedido lo cobró entre el paso 1 y este: el resultado es el que dejó ese pedido.
      return { viajeId, estado: viaje.estado, importeCentavos };
    }

    let cobrado;
    try {
      ({ cobrado } = await billetera.cobrar({ pasajeroId: viaje.pasajeroId, viajeId, importeCentavos }));
    } catch (error) {
      if (estricto) throw error;
      logger.warn({ err: error, viajeId }, 'el cobro falló; el viaje queda en pago_pendiente');
      await viajes.registrarCobroPendiente(viajeId, { importeCentavos, motivo: error.codigo ?? 'ERROR_BILLETERA' });
      return { viajeId, estado: EstadoViaje.PAGO_PENDIENTE, importeCentavos };
    }

    if (!cobrado) {
      if (estricto) throw new ErrorDeDominio('SALDO_INSUFICIENTE', 'El saldo no alcanza para pagar el viaje.');
      await viajes.registrarCobroPendiente(viajeId, { importeCentavos, motivo: 'SALDO_INSUFICIENTE' });
      return { viajeId, estado: EstadoViaje.PAGO_PENDIENTE, importeCentavos };
    }
    await viajes.registrarCobroConfirmado(viajeId, { importeCentavos, reintento: estricto });
    return { viajeId, estado: EstadoViaje.FINALIZADO, importeCentavos };
  });
}
