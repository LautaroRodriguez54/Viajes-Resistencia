import jwt from 'jsonwebtoken';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { esRolValido } from '../../dominio/usuarios/roles.js';

export function crearServicioJwt(config) {
  return {
    crearTokenDeAcceso({ usuarioId, rol }) {
      if (!usuarioId || !esRolValido(rol)) throw new ErrorDeDominio('USUARIO_INVALIDO', 'Usuario o rol inválido para emitir token.');
      return jwt.sign({ rol }, config.JWT_SECRET, { subject: String(usuarioId), expiresIn: config.JWT_ACCESS_TOKEN_TTL });
    },
    verificarTokenDeAcceso(token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET);
        if (typeof payload === 'string' || !esRolValido(payload.rol) || !payload.sub) throw new Error('claims inválidos');
        return { usuarioId: payload.sub, rol: payload.rol };
      } catch {
        throw new ErrorDeDominio('TOKEN_INVALIDO', 'El token de acceso no es válido.');
      }
    },
  };
}

