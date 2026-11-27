import { armarCargaFirmada } from './cargaDemoWebhook.js';

// Pasarela de pagos simulada, para la demo: hace el papel de Mercado Pago o Stripe cuando el
// pasajero confirma el pago en el "checkout" de la web. No acredita nada por su cuenta: arma el
// mismo webhook firmado con HMAC que mandaría el proveedor real y se lo entrega al caso de uso del
// webhook, que verifica la firma y deduplica por eventoExternoId como con cualquier otra carga.
// El secreto queda en el servidor; el navegador nunca lo ve.
export function crearPasarelaPagosSimulada({ secreto, procesarCargaWebhook }) {
  return {
    async confirmarPago({ id, pasajeroId, importeCentavos }) {
      const { cuerpo, firma } = armarCargaFirmada({
        pasajeroId, importeCentavos, secreto, eventoExternoId: `checkout-${id}`,
      });
      return procesarCargaWebhook({ firma, cuerpoCrudo: Buffer.from(cuerpo), carga: JSON.parse(cuerpo) });
    },
  };
}
