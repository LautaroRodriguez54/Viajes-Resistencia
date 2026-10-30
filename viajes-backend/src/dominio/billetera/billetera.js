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

