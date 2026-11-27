// Para simular el movimiento del chofer de la demo sobre la ruta de OSRM. Es sólo de la web: el backend
// recibe la posición como la de cualquier chofer real (PUT /choferes/me/ubicacion) y no sabe que es simulada.
// La ruta es una lista de [lat, lng]; las distancias son aproximadas (Haversine), alcanzan para animar.

function metros([lat1, lng1], [lat2, lng2]) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function largoDeRuta(ruta) {
  let total = 0;
  for (let i = 1; i < ruta.length; i += 1) total += metros(ruta[i - 1], ruta[i]);
  return total;
}

// El punto { latitud, longitud } que está a `distancia` metros desde el principio de la ruta.
export function puntoEnRuta(ruta, distancia) {
  let falta = Math.max(0, distancia);
  for (let i = 1; i < ruta.length; i += 1) {
    const tramo = metros(ruta[i - 1], ruta[i]);
    if (falta <= tramo && tramo > 0) {
      const t = falta / tramo;
      const [lat1, lng1] = ruta[i - 1];
      const [lat2, lng2] = ruta[i];
      return { latitud: lat1 + (lat2 - lat1) * t, longitud: lng1 + (lng2 - lng1) * t };
    }
    falta -= tramo;
  }
  const [lat, lng] = ruta[ruta.length - 1];
  return { latitud: lat, longitud: lng };
}
