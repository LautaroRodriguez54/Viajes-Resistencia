import crypto from 'node:crypto';
import { ErrorDeDominio } from '../../dominio/errores.js';

// ASCII imprimible sin espacios; un UUID por intención es lo recomendado.
const PATRON_CLAVE = /^[\x21-\x7e]{8,255}$/;

// Ordena las claves de los objetos para que {a,b} y {b,a} den la misma huella.
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') {
    const entradas = Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entradas.map(([clave, interno]) => [clave, canonico(interno)]));
  }
  return valor;
}

// Huella del pedido: método, ruta con sus parámetros (el viajeId u ofertaId) y
// cuerpo. La misma clave sobre otro viaje u otro cuerpo da otra huella → 422.
export function huellaDelPedido(req) {
  const ruta = (req.originalUrl ?? req.url ?? '').split('?')[0];
  const contenido = JSON.stringify({ metodo: req.method, ruta, cuerpo: canonico(req.body ?? null) });
  return crypto.createHash('sha256').update(contenido).digest('hex');
}

// Devuelve `idempotente(ambito)`, un middleware que va después de
// requiereAutenticacion (necesita el actor del JWT).
export function crearIdempotencia({ repositorio, ttlSegundos, logger }) {
  if (!repositorio) throw new Error('Falta el repositorio de idempotencia.');
  if (!Number.isInteger(ttlSegundos) || ttlSegundos <= 0) throw new Error('TTL de idempotencia inválido.');

  return function idempotente(ambito) {
    return async (req, res, next) => {
      const clave = req.get('idempotency-key');
      if (clave === undefined) throw new ErrorDeDominio('CLAVE_IDEMPOTENCIA_REQUERIDA', 'Falta el header Idempotency-Key.');
      if (!PATRON_CLAVE.test(clave)) throw new ErrorDeDominio('CLAVE_IDEMPOTENCIA_INVALIDA', 'Idempotency-Key debe tener entre 8 y 255 caracteres ASCII visibles.');

      const requestSha256 = huellaDelPedido(req);
      const reserva = await repositorio.reservar({
        actorId: req.autenticacion.usuarioId, ambito, clave, requestSha256, ttlSegundos,
      });

      if (!reserva.nueva) {
        if (reserva.requestSha256 !== requestSha256) {
          throw new ErrorDeDominio('CLAVE_IDEMPOTENCIA_REUTILIZADA', 'La Idempotency-Key ya se usó con otro pedido.');
        }
        if (reserva.estado !== 'completada') {
          throw new ErrorDeDominio('PEDIDO_EN_CURSO', 'Hay un pedido con la misma Idempotency-Key en curso.');
        }
        res.set('idempotency-replayed', 'true');
        return res.status(reserva.respuestaStatus).json(reserva.respuestaCuerpo);
      }

      // Primera vez: se ejecuta la ruta y se intercepta su respuesta (también la
      // del manejador de errores) para guardarla antes de mandarla.
      const jsonOriginal = res.json.bind(res);
      res.json = (cuerpo) => {
        res.json = jsonOriginal;
        const status = res.statusCode;
        const persistir = status >= 500
          ? repositorio.liberar(reserva.id)
          : repositorio.completar(reserva.id, { status, cuerpo });
        persistir
          .catch((error) => {
            // La operación ya se hizo: se responde igual. La clave queda en
            // `procesando` (409 a los reintentos) hasta que venza el TTL, que es
            // preferible a liberarla y arriesgar una segunda ejecución.
            logger?.error({ err: error, ambito }, 'no se pudo guardar la respuesta idempotente');
          })
          .finally(() => jsonOriginal(cuerpo));
        return res;
      };
      return next();
    };
  };
}
