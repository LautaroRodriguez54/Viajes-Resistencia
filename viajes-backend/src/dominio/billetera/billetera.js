import { ErrorDeDominio } from '../errores.js';
import { validarCentavos } from './dinero.js';

export const TipoMovimientoBilletera = Object.freeze({ CARGA: 'carga', CONSUMO: 'consumo' });

// El saldo se deriva de movimientos confirmados; no es un campo mutable del dominio.
export function calcularSaldo(movimientos) {
  return movimientos.reduce((saldo, movimiento) => {
    const importe = validarCentavos(movimiento.importeCentavos);
    if (movimiento.tipo === TipoMovimientoBilletera.CARGA) return saldo + importe;
    if (movimiento.tipo === TipoMovimientoBilletera.CONSUMO) return saldo - importe;
    throw new ErrorDeDominio('MOVIMIENTO_INVALIDO', 'Tipo de movimiento de billetera desconocido.');
  }, 0);
}

// Regla del cobro, la misma para todos los adaptadores de la billetera:
// - nunca parcial: si el saldo no alcanza, no se debita nada;
// - importe 0 (viaje gratis): se da por cobrado sin consumo, porque un movimiento de 0 no tiene sentido
//   (y la base lo rechaza con CHECK importe_centavos > 0).
export function decidirCobro({ saldoCentavos, importeCentavos }) {
  const importe = validarCentavos(importeCentavos);
  if (importe === 0) return { cobrado: true, generaConsumo: false };
  if (saldoCentavos < importe) return { cobrado: false, generaConsumo: false };
  return { cobrado: true, generaConsumo: true };
}

