import { ErrorDeDominio } from '../../dominio/errores.js';
import { contexto } from './contexto.js';

const STATUS_POR_CODIGO = new Map([
  ['ENTRADA_INVALIDA', 400],
  ['TOKEN_REQUERIDO', 401],
  ['TOKEN_INVALIDO', 401],
  ['CREDENCIALES_INVALIDAS', 401],
  ['FIRMA_WEBHOOK_INVALIDA', 401],
  ['ROL_NO_REGISTRABLE', 403],
  ['RECURSO_PROHIBIDO', 403],
  ['BILLETERA_NO_ENCONTRADA', 404],
  ['CHOFER_NO_ENCONTRADO', 404],
  ['OFERTA_NO_ENCONTRADA', 404],
  ['RECURSO_NO_ENCONTRADO', 404],
  ['EMAIL_O_PATENTE_EXISTENTE', 409],
  ['CHOFER_NO_HABILITADO', 409],
  ['CHOFER_NO_DISPONIBLE', 409],
  ['CHOFER_CON_VIAJE_ACTIVO', 409],
  ['SIN_CHOFERES_CERCANOS', 409],
  ['OFERTA_NO_DISPONIBLE', 409],
  ['SALDO_INSUFICIENTE', 409],
  ['TRANSICION_INVALIDA', 409],
  ['LIMITE_DE_PETICIONES_EXCEDIDO', 429],
]);

function clasificarError(error) {
  if (error instanceof ErrorDeDominio) {
    return { status: STATUS_POR_CODIGO.get(error.codigo) ?? 422, codigo: error.codigo };
  }
  if (error?.type === 'entity.too.large' || error?.status === 413 || error?.statusCode === 413) {
    return { status: 413, codigo: 'PAYLOAD_DEMASIADO_GRANDE' };
  }
  if (error?.type === 'charset.unsupported' || error?.type === 'encoding.unsupported' || error?.status === 415 || error?.statusCode === 415) {
    return { status: 415, codigo: 'CONTENIDO_NO_SOPORTADO' };
  }
  if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && (error.status === 400 || error.statusCode === 400))) {
    return { status: 400, codigo: 'JSON_INVALIDO' };
  }
  return { status: 500, codigo: 'ERROR_INTERNO' };
}

export function manejadorDeErrores(logger) {
  return (error, _req, res, _next) => {
    const requestId = contexto.getStore()?.requestId;
    const { status, codigo } = clasificarError(error);
    if (status >= 500) {
      logger.error({ err: error, codigo, status, requestId }, 'error no controlado');
    } else {
      logger.warn({ codigo, status, requestId }, error?.message || 'error de cliente');
    }
    res.status(status).json({ error: { codigo, requestId } });
  };
}
