import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';

export function crearRegistrarUsuario({ usuarios, hasheador, tokens }) {
  return async function registrarUsuario(datos) {
    if (![Rol.PASAJERO, Rol.CHOFER].includes(datos.rol)) {
      throw new ErrorDeDominio('ROL_NO_REGISTRABLE', 'El rol indicado no puede registrarse públicamente.');
    }

    const passwordHash = await hasheador.hashear(datos.password);
    const usuario = await usuarios.crear({ ...datos, email: datos.email.toLowerCase(), passwordHash });
    return { usuario, accessToken: tokens.crearTokenDeAcceso({ usuarioId: usuario.id, rol: usuario.rol }) };
  };
}

