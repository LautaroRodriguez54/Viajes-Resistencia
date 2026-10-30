import { ErrorDeDominio } from '../../dominio/errores.js';

export function crearIniciarSesion({ usuarios, hasheador, tokens }) {
  return async function iniciarSesion({ email, password }) {
    const usuario = await usuarios.buscarPorEmail(email.toLowerCase());
    const coincide = usuario ? await hasheador.verificar(usuario.passwordHash, password) : false;
    if (!coincide) throw new ErrorDeDominio('CREDENCIALES_INVALIDAS', 'Email o contraseña inválidos.');
    return { usuario: aUsuarioPublico(usuario), accessToken: tokens.crearTokenDeAcceso({ usuarioId: usuario.id, rol: usuario.rol }) };
  };
}

export function aUsuarioPublico(usuario) {
  return { id: usuario.id, email: usuario.email, rol: usuario.rol };
}

