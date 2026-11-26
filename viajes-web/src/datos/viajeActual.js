// El backend todavía no tiene GET /viajes (historial del pasajero, tema 13), así que
// la web recuerda el último viaje pedido en esta pestaña. Se borra al salir.
const CLAVE = 'viajes.viajeActual';

export function leerViajeActual() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE));
  } catch {
    return null;
  }
}

// { id, origen, destino }: el recorrido se guarda para mostrar los nombres,
// porque GET /viajes/:viajeId todavía no devuelve origen ni destino.
export function guardarViajeActual(viaje) {
  if (viaje) sessionStorage.setItem(CLAVE, JSON.stringify(viaje));
  else sessionStorage.removeItem(CLAVE);
}
