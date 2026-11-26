import { URL_OSRM } from './config.js';

// Ruta por calles entre dos puntos { latitud, longitud } con OSRM. Devuelve la lista de [lat, lng] para
// dibujar, o null si el servicio no responde (el mapa queda sólo con los marcadores).
// Se guarda en memoria por par de puntos: la consulta periódica de las pantallas (cada 2 s) no vuelve a
// pedirla, y el servidor público de OSRM pide uso moderado.
const guardadas = new Map();

const clave = (a, b) => [a.latitud, a.longitud, b.latitud, b.longitud].map((n) => n.toFixed(5)).join(',');

export async function buscarRuta(desde, hasta, { signal } = {}) {
  const k = clave(desde, hasta);
  if (guardadas.has(k)) return guardadas.get(k);
  // OSRM usa longitud,latitud. overview=full + geojson: la geometría completa, lista para dibujar.
  const url = `${URL_OSRM}${desde.longitud},${desde.latitud};${hasta.longitud},${hasta.latitud}?overview=full&geometries=geojson`;
  try {
    const respuesta = await fetch(url, { signal });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    const geometria = datos.routes?.[0]?.geometry?.coordinates;
    if (datos.code !== 'Ok' || !geometria) return null;
    const puntos = geometria.map(([lng, lat]) => [lat, lng]);
    guardadas.set(k, puntos);
    return puntos;
  } catch {
    return null; // sin red, cancelada o con error: no se dibuja la línea
  }
}
