import { ErrorDeDominio } from '../../dominio/errores.js';
import { validarCentavos } from '../../dominio/billetera/dinero.js';

// Límites de una carga desde la web: de $ 100 a $ 500.000.
export const CARGA_MINIMA_CENTAVOS = 10_000;
export const CARGA_MAXIMA_CENTAVOS = 50_000_000;

// Paso 1: el pasajero elige el importe. Queda una intención pendiente; no se mueve plata.
export function crearIniciarCargaDeSaldo({ billeteras }) {
  return async function iniciarCargaDeSaldo({ pasajeroId, importeCentavos }) {
    validarCentavos(importeCentavos);
    if (importeCentavos < CARGA_MINIMA_CENTAVOS || importeCentavos > CARGA_MAXIMA_CENTAVOS) {
      throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La carga tiene que ser de $ 100 a $ 500.000.');
    }
    return billeteras.crearIntencionCarga({ pasajeroId, importeCentavos });
  };
}

// Paso 2: el pasajero confirma en el checkout. La pasarela manda el webhook firmado, que es el
// único que acredita. Repetirlo no acredita dos veces (intención bloqueada + dedupe del webhook).
export function crearConfirmarCargaDeSaldo({ billeteras, pasarela }) {
  return async function confirmarCargaDeSaldo({ intencionId, pasajeroId }) {
    return billeteras.pagarIntencionCarga({ intencionId, pasajeroId }, (intencion) => pasarela.confirmarPago(intencion));
  };
}
