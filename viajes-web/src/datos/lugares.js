// Lugares de Resistencia para elegir origen y destino hasta tener Places Autocomplete.
// Están todos a menos de 5 km de la plaza: el backend busca choferes a ≤ 5 km del origen.
// El cliente manda sólo coordenadas; la tarifa la calcula siempre el servidor.
export const lugares = [
  { id: 'plaza', nombre: 'Plaza 25 de Mayo', latitud: -27.4514, longitud: -58.9867 },
  { id: 'terminal', nombre: 'Terminal de Ómnibus', latitud: -27.4691, longitud: -58.9581 },
  { id: 'utn', nombre: 'UTN Facultad Regional Resistencia', latitud: -27.4498, longitud: -58.9794 },
  { id: 'shopping', nombre: 'Sarmiento Shopping', latitud: -27.4392, longitud: -58.9733 },
  { id: 'hospital', nombre: 'Hospital Perrando', latitud: -27.4563, longitud: -58.9902 },
  { id: 'domo', nombre: 'Domo del Centenario', latitud: -27.4639, longitud: -58.9789 },
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

// El backend guarda coordenadas, no nombres: el historial muestra el lugar de la lista que coincide.
export function nombreDelPunto(punto) {
  if (!punto) return '…';
  return lugarMasCercano(punto)?.nombre ?? `${punto.latitud.toFixed(4)}, ${punto.longitud.toFixed(4)}`;
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
  return lugarMasCercano(punto)?.nombre ?? `${punto.latitud.toFixed(4)}, ${punto.longitud.toFixed(4)}`;
}
