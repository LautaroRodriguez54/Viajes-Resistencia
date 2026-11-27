import { URL_PHOTON_INVERSA, usarMapaReal } from '../mapas/config.js';

// Lugares de Resistencia: los frecuentes del autocompletado y la lista fija cuando el mapa es el simulado.
// Están todos a menos de 5 km de la plaza: el backend busca choferes a ≤ 5 km del origen.
// El cliente manda sólo coordenadas; la tarifa la calcula siempre el servidor.
// Coordenadas de OpenStreetMap (verificadas con Photon el 26/11/2026; las anteriores eran aproximadas
// y con el mapa real se veía, por ejemplo, la terminal sobre un club de golf).
export const lugares = [
  { id: 'plaza', nombre: 'Plaza 25 de Mayo', latitud: -27.4514, longitud: -58.9867 },
  { id: 'terminal', nombre: 'Terminal de Ómnibus', latitud: -27.4562, longitud: -59.0225 },
  { id: 'utn', nombre: 'UTN Facultad Regional Resistencia', latitud: -27.4512, longitud: -58.9791 },
  { id: 'shopping', nombre: 'Sarmiento Shopping', latitud: -27.4316, longitud: -58.9631 },
  { id: 'hospital', nombre: 'Hospital Perrando', latitud: -27.4581, longitud: -58.9757 },
  { id: 'domo', nombre: 'Domo del Centenario', latitud: -27.4369, longitud: -58.9808 },
];

// Donde se ubica el chofer de la demo: junto a la plaza, así queda dentro del radio.
export const posicionChoferDemo = { latitud: -27.4520, longitud: -58.9860 };

export function lugarMasCercano(punto) {
  let mejor = null;
  let menor = Infinity;
  for (const lugar of lugares) {
    const d = (lugar.latitud - punto.latitud) ** 2 + (lugar.longitud - punto.longitud) ** 2;
    if (d < menor) { menor = d; mejor = lugar; }
  }
  return menor < 1e-6 ? mejor : null;
}

// Desde la migración 007 el backend guarda el nombre que eligió el pasajero y lo devuelve en cada punto
// (`punto.nombre`): es lo primero que se usa. Para los viajes anteriores (nombre null) quedan dos respaldos:
// - lo que este pasajero eligió en esta pestaña (sessionStorage: no queda en el equipo al cerrarla);
// - la dirección aproximada que devuelve Photon para esas coordenadas, pedida en segundo plano una sola vez
//   por punto. Como las pantallas consultan cada 2 a 5 s, el nombre aparece solo en la consulta siguiente.
// La clave es la coordenada redondeada a 5 decimales (~1 m), porque la base la devuelve con otra precisión.
const CLAVE_NOMBRES = 'viajes.nombresDeLugares';

function claveDe(punto) {
  return `${punto.latitud.toFixed(5)},${punto.longitud.toFixed(5)}`;
}

function nombresRecordados() {
  try {
    return JSON.parse(globalThis.sessionStorage?.getItem(CLAVE_NOMBRES) ?? '{}');
  } catch {
    return {};
  }
}

export function recordarNombre(punto, nombre) {
  if (!punto || !nombre) return;
  const nombres = nombresRecordados();
  nombres[claveDe(punto)] = nombre;
  globalThis.sessionStorage?.setItem(CLAVE_NOMBRES, JSON.stringify(nombres));
}

// Nombre conocido del punto (el del backend, recordado o de la lista fija), o null si no se conoce.
export function nombreConocido(punto) {
  if (!punto) return null;
  return punto.nombre ?? nombresRecordados()[claveDe(punto)] ?? lugarMasCercano(punto)?.nombre ?? null;
}

// Dirección aproximada con Photon (búsqueda inversa). Sólo con el mapa real (con el simulado no hay red)
// y una vez por punto: el servidor público pide uso moderado.
const pedidos = new Set();
function pedirDireccion(punto) {
  if (!usarMapaReal || typeof fetch !== 'function') return;
  const clave = claveDe(punto);
  if (pedidos.has(clave)) return;
  pedidos.add(clave);
  const url = `${URL_PHOTON_INVERSA}?${new URLSearchParams({ lat: String(punto.latitud), lon: String(punto.longitud), limit: '1' })}`;
  fetch(url)
    .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
    .then((datos) => {
      const p = datos?.features?.[0]?.properties;
      if (!p) return;
      const calle = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : null;
      const nombre = p.name ?? calle;
      if (nombre) recordarNombre(punto, nombre);
    })
    .catch(() => {}); // sin red: quedan las coordenadas
}

export function coordenadasComoTexto(punto) {
  return `${punto.latitud.toFixed(4)}, ${punto.longitud.toFixed(4)}`;
}

export function nombreDelPunto(punto) {
  if (!punto) return '…';
  const conocido = nombreConocido(punto);
  if (conocido) return conocido;
  pedirDireccion(punto);
  return coordenadasComoTexto(punto);
}

// Distancia en línea recta, sólo para mostrar (la tarifa la calcula el servidor).
export function distanciaMetros(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLon = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

export function nombreDe(punto) {
  return nombreDelPunto(punto);
}
