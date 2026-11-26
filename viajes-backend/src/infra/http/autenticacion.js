import { ErrorDeDominio } from '../../dominio/errores.js';

export function requiereAutenticacion(tokens) {
  return (req, _res, next) => {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) return next(new ErrorDeDominio('TOKEN_REQUERIDO', 'Se requiere un token Bearer.'));
    try {
      req.autenticacion = tokens.verificarTokenDeAcceso(token);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requiereRol(rolesPermitidos, mensaje = 'No tenés permisos para realizar esta operación.') {
  const permitidos = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];
  return (req, _res, next) => {
    if (!req.autenticacion || !permitidos.includes(req.autenticacion.rol)) {
      return next(new ErrorDeDominio('RECURSO_PROHIBIDO', mensaje));
    }
    return next();
  };
}

