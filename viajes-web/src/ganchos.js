import { useCallback, useEffect, useRef, useState } from 'react';
import { nuevaClave } from './api/cliente.js';

// Consulta periódica (cada 2 s por defecto) mientras no haya SSE. Devuelve el último
// dato, el último error y `recargar` para forzar una consulta después de una acción.
// Con `consulta` null no consulta (p. ej. todavía no hay viaje). Con `detenerSi`,
// deja de consultar cuando el dato cumple la condición (p. ej. viaje finalizado).
export function usarConsultaPeriodica(consulta, intervaloMs = 2000, detenerSi = () => false) {
  const [dato, setDato] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(Boolean(consulta));
  const [detenida, setDetenida] = useState(false);
  const consultaRef = useRef(consulta);
  const detenerRef = useRef(detenerSi);
  consultaRef.current = consulta;
  detenerRef.current = detenerSi;

  const recargar = useCallback(async () => {
    if (!consultaRef.current) return;
    try {
      const nuevo = await consultaRef.current();
      setDato(nuevo);
      setError(null);
      setDetenida(detenerRef.current(nuevo));
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, []);

  const activa = Boolean(consulta) && !detenida;
  useEffect(() => {
    if (!activa) return undefined;
    recargar();
    const temporizador = setInterval(recargar, intervaloMs);
    return () => clearInterval(temporizador);
  }, [activa, intervaloMs, recargar]);

  return { dato, error, cargando, recargar };
}

// Una Idempotency-Key por intención. La clave se mantiene mientras no haya una
// respuesta definitiva: si se corta la conexión y el usuario reintenta, viaja la
// misma clave y el servidor no repite la operación. Con respuesta (éxito o 4xx)
// se renueva, así la próxima intención es otra.
export function usarClaveIdempotente() {
  const clave = useRef(null);
  return {
    actual() {
      clave.current ??= nuevaClave();
      return clave.current;
    },
    renovar() {
      clave.current = null;
    },
  };
}

// Ejecuta una acción con una clave de idempotencia y la renueva sólo si hubo respuesta.
export async function conClave(claveIdempotente, accion) {
  try {
    const resultado = await accion(claveIdempotente.actual());
    claveIdempotente.renovar();
    return resultado;
  } catch (e) {
    if (e.status !== 0) claveIdempotente.renovar();
    throw e;
  }
}
