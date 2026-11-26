import crypto from 'node:crypto';

// Arma y firma una carga de saldo igual a la que mandaría el proveedor de pagos.
// Sólo la usa el script de demostración `npm run cargar-saldo`: el secreto HMAC
// se lee del .env del servidor y nunca llega al front.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTERO_POSITIVO = /^[1-9]\d*$/;
const MAXIMO_CENTAVOS = 2_000_000_000; // Mismo tope que valida rutasBilletera.js.

export function firmarCuerpoHmac(cuerpo, secreto) {
  return `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
}

export function armarCargaFirmada({ pasajeroId, importeCentavos, secreto, eventoExternoId = `demo-${crypto.randomUUID()}` }) {
  const cuerpo = JSON.stringify({ eventoExternoId, pasajeroId, importeCentavos });
  return { eventoExternoId, cuerpo, firma: firmarCuerpoHmac(cuerpo, secreto) };
}

// Uso: cargar-saldo <email|pasajeroId> <importeCentavos> [--url http://localhost:3000]
export function interpretarArgumentos(argumentos, urlPorDefecto) {
  const posicionales = [...argumentos];
  let url = urlPorDefecto;
  const posicionUrl = posicionales.indexOf('--url');
  if (posicionUrl !== -1) {
    [, url] = posicionales.splice(posicionUrl, 2);
  }

  const [destino, importe] = posicionales;
  if (posicionales.length !== 2 || !destino || !importe) {
    throw new Error('Uso: npm run cargar-saldo -- <email|pasajeroId> <importeCentavos> [--url http://localhost:3000]');
  }
  if (!EMAIL.test(destino) && !UUID.test(destino)) {
    throw new Error('El destino tiene que ser el email o el id (uuid) de un pasajero.');
  }
  if (!ENTERO_POSITIVO.test(importe) || Number(importe) > MAXIMO_CENTAVOS) {
    throw new Error(`El importe va en centavos enteros, entre 1 y ${MAXIMO_CENTAVOS} (por ejemplo, 150000 = $1500).`);
  }
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error('La URL del servidor tiene que empezar con http:// o https://.');
  }

  return {
    email: EMAIL.test(destino) ? destino : null,
    pasajeroId: UUID.test(destino) ? destino : null,
    importeCentavos: Number(importe),
    url: url.replace(/\/+$/, ''),
  };
}
