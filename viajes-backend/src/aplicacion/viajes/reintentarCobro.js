import { ErrorDeDominio } from '../../dominio/errores.js';
import { EstadoViaje } from '../../dominio/viajes/estadosViaje.js';

// Salida de pago_pendiente: el pasajero, después de cargar saldo, paga la deuda del viaje.
// Mismo orden de bloqueo que finalizarViajeYCobrar (viaje → billetera) para no generar interbloqueos.
export function crearReintentarCobro({ unidadDeTrabajo }) {
  return function reintentarCobro({ viajeId, pasajeroId }) {
    return unidadDeTrabajo.ejecutar(async ({ viajes, billetera }) => {
      const viaje = await viajes.bloquearParaCobro(viajeId);
      if (!viaje || viaje.pasajeroId !== pasajeroId) {
        throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
      }
      if (viaje.estado !== EstadoViaje.PAGO_PENDIENTE) {
        throw new ErrorDeDominio('TRANSICION_INVALIDA', 'Sólo un viaje con pago pendiente puede reintentar el cobro.');
      }

      const importeCentavos = viaje.tarifaFinalCentavos;
      const { cobrado } = await billetera.cobrar({ pasajeroId, viajeId, importeCentavos });
      if (!cobrado) throw new ErrorDeDominio('SALDO_INSUFICIENTE', 'El saldo no alcanza para pagar el viaje.');
      await viajes.registrarPagoDeDeuda(viajeId, { importeCentavos });
      return { viajeId, estado: EstadoViaje.FINALIZADO, importeCentavos };
    });
  };
}
