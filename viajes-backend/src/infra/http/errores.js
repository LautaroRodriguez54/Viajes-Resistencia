import { ErrorDeDominio } from '../../dominio/errores.js';
import { contexto } from './contexto.js';

export function manejadorDeErrores(logger) {
  return (error, _req, res, _next) => {
    const requestId = contexto.getStore()?.requestId;
    const statusPorCodigo = {
      ENTRADA_INVALIDA: 400,
      TOKEN_REQUERIDO: 401,
      TOKEN_INVALIDO: 401,
      CREDENCIALES_INVALIDAS: 401,
      FIRMA_WEBHOOK_INVALIDA: 401,
      EMAIL_O_PATENTE_EXISTENTE: 409,
      ROL_NO_REGISTRABLE: 403,
      RECURSO_PROHIBIDO: 403,
      BILLETERA_NO_ENCONTRADA: 404,
      RECURSO_NO_ENCONTRADO: 404,
      CHOFER_NO_HABILITADO: 409,
      CHOFER_NO_DISPONIBLE: 409,
      SIN_CHOFERES_CERCANOS: 409,
      OFERTA_NO_ENCONTRADA: 404,
      OFERTA_NO_DISPONIBLE: 409,
    };
    const status = error instanceof ErrorDeDominio ? (statusPorCodigo[error.codigo] ?? 422) : 500;
    logger.error({ err: error, requestId }, 'error no controlado');
    res.status(status).json({ error: { codigo: error instanceof ErrorDeDominio ? error.codigo : 'ERROR_INTERNO', requestId } });
  };
}

