import crypto from 'node:crypto';

export function crearVerificadorWebhookHmac(secret) {
  return {
    verificarFirma(cuerpoCrudo, firmaRecibida) {
      const firma = typeof firmaRecibida === 'string' ? firmaRecibida.replace(/^sha256=/, '') : '';
      const esperada = crypto.createHmac('sha256', secret).update(cuerpoCrudo).digest('hex');
      if (!/^[a-f0-9]{64}$/i.test(firma)) return false;
      return crypto.timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(firma, 'hex'));
    },
  };
}

