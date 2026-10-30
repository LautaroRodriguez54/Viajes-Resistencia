import { ErrorDeDominio } from '../errores.js';

// Se representa dinero en centavos enteros: nunca en punto flotante.
export function validarCentavos(valor) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ErrorDeDominio('IMPORTE_INVALIDO', 'El importe debe ser un entero no negativo en centavos.');
  }
  return valor;
}

