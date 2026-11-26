// Mapas con OpenStreetMap: gratis, sin cuenta, sin tarjeta y sin clave (Google Maps pide tarjeta para
// habilitar la facturación aunque no se gaste; ver ADR 011).
// - Mapa: Leaflet con los mosaicos de tile.openstreetmap.org (atribución "© OpenStreetMap" obligatoria).
// - Autocompletado: Photon (photon.komoot.io), buscador sobre datos de OSM que sí admite buscar mientras
//   se escribe (Nominatim, el oficial, lo prohíbe en su política de uso).
// Los dos servidores públicos son para uso moderado: alcanza para el TP; un producto real usaría un
// servidor propio o un proveedor pago.
//
// VITE_MAPA=simulado fuerza el mapa dibujado y la lista fija (sin red: E2E, CI o una demo sin internet).
// Sin esa variable se usa el mapa real, y si los mosaicos no cargan se vuelve solo al dibujo.
// `?.`: fuera de Vite (scripts de verificación en Node) no existe import.meta.env.
const entorno = import.meta.env ?? {};

export const usarMapaReal = entorno.VITE_MAPA !== 'simulado';

export const URL_MOSAICOS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ATRIBUCION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const URL_PHOTON = 'https://photon.komoot.io/api/';

// Centro de la demo (Plaza 25 de Mayo) y rectángulo de Resistencia y alrededores para las búsquedas:
// el backend busca choferes a ≤ 5 km del origen, así que no tiene sentido sugerir lugares lejos.
export const centroResistencia = { latitud: -27.4514, longitud: -58.9867 };
export const limitesResistencia = { norte: -27.39, sur: -27.51, este: -58.92, oeste: -59.06 };
