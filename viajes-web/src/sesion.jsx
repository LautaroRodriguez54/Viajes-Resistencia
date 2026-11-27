import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet } from 'react-router';
import { eventosSesion, guardarSesion, leerSesion } from './api/cliente.js';

// La sesión vive en sessionStorage: se borra al cerrar la pestaña y no la comparten
// dos pestañas (sirve para tener al pasajero y al chofer abiertos a la vez en la demo).
const ContextoSesion = createContext(null);

export const inicioPorRol = {
  pasajero: '/pasajero/pedir',
  chofer: '/chofer',
  operador: '/operador',
  administrador: '/admin',
};

export function ProveedorSesion({ children }) {
  const [sesion, setSesion] = useState(leerSesion);
  const [vencida, setVencida] = useState(false);

  const ingresar = useCallback((nueva) => {
    guardarSesion(nueva);
    setVencida(false);
    setSesion(nueva);
  }, []);

  const salir = useCallback(() => {
    guardarSesion(null);
    setSesion(null);
  }, []);

  // El token dura 15 min y no hay refresh: ante un 401 se vuelve a Ingresar con aviso.
  useEffect(() => {
    const alVencer = () => { salir(); setVencida(true); };
    eventosSesion.addEventListener('vencida', alVencer);
    return () => eventosSesion.removeEventListener('vencida', alVencer);
  }, [salir]);

  const valor = useMemo(() => ({ usuario: sesion?.usuario ?? null, vencida, ingresar, salir }), [sesion, vencida, ingresar, salir]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function usarSesion() {
  return useContext(ContextoSesion);
}

// Guarda de ruta: sin sesión va a Ingresar; con otro rol, a la pantalla de su rol.
// Es sólo comodidad: quien autoriza de verdad es el backend en cada endpoint.
export function RutaDeRol({ rol }) {
  const { usuario } = usarSesion();
  if (!usuario) return <Navigate to="/ingresar" replace />;
  if (usuario.rol !== rol) return <Navigate to={inicioPorRol[usuario.rol] ?? '/ingresar'} replace />;
  return <Outlet />;
}
