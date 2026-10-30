export const Rol = Object.freeze({
  PASAJERO: 'pasajero',
  CHOFER: 'chofer',
  OPERADOR: 'operador',
  ADMINISTRADOR: 'administrador',
});

export function esRolValido(rol) {
  return Object.values(Rol).includes(rol);
}

