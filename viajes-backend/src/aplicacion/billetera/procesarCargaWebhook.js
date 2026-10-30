import { ErrorDeDominio } from '../../dominio/errores.js';

export function crearProcesarCargaWebhook({ verificadorFirma, billeteras }) {
  return async function procesarCargaWebhook({ firma, cuerpoCrudo, carga }) {
    if (!verificadorFirma.verificarFirma(cuerpoCrudo, firma)) {
      throw new ErrorDeDominio('FIRMA_WEBHOOK_INVALIDA', 'La firma del webhook es inválida.');
    }
    return billeteras.registrarCargaDesdeWebhook(carga, cuerpoCrudo);
  };
}

