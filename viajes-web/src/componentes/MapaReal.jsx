import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ATRIBUCION, centroResistencia, URL_MOSAICOS } from '../mapas/config.js';
import { buscarRuta } from '../mapas/rutas.js';

// Mapa real con Leaflet y OpenStreetMap. Recibe los mismos hijos que MapaSimulado (las tarjetas
// flotantes) y los puntos en el formato del backend: { latitud, longitud }.
// - origen: punto de retiro (círculo negro, como en el diseño);
// - destino: pin rojo;
// - posicion: "Vos" (el chofer en su pantalla), punto azul.
// - auto: el auto del chofer mientras se mueve (el chofer lo ve en su pantalla y el pasajero en Mi viaje).
//   No entra en el encuadre ni en las rutas: cambia cada pocos segundos, y si no el mapa se reencuadraría
//   y le pediría una ruta nueva a OSRM en cada paso. Sólo se mueve el marcador, con una transición suave.
// La ruta por calles sale de OSRM (src/mapas/rutas.js); si no responde, quedan sólo los marcadores
// (nunca una línea recta, que sería engañosa).
// tarjeta: dónde está la tarjeta que tapa el mapa, para encuadrar los puntos en la parte visible:
//   'lateral' → a la izquierda en la computadora y como hoja inferior en el celular;
//   'arriba'  → la notificación de oferta del chofer.
// alFallar: se llama si los mosaicos no cargan (sin internet); Mapa vuelve al dibujo.
const aLatLng = (p) => [p.latitud, p.longitud];

const iconos = {
  origen: L.divIcon({ className: 'marcador-origen', iconSize: [18, 18] }),
  destino: L.divIcon({ className: 'marcador-destino', iconSize: [26, 34], iconAnchor: [13, 34] }),
  posicion: L.divIcon({ className: 'marcador-vos', iconSize: [18, 18] }),
};
const titulos = { origen: 'Retiro', destino: 'Destino', posicion: 'Vos' };

// Auto visto desde arriba, en el azul del acento, con sombra para que se lea sobre las calles.
const iconoAuto = L.divIcon({
  className: 'marcador-auto',
  iconSize: [30, 30],
  html: '<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="14" fill="#FFFFFF"/>'
    + '<rect x="9.5" y="6" width="11" height="18" rx="4" fill="#3346D3"/>'
    + '<rect x="11" y="9" width="8" height="4" rx="1.5" fill="#C9D0F7"/>'
    + '<rect x="11" y="18" width="8" height="3" rx="1.5" fill="#C9D0F7"/></svg>',
});

// Líneas como en el diseño: el viaje en el azul de los mapas con un borde blanco para que se lea sobre
// las calles; el tramo del chofer hasta el retiro, punteado y oscuro.
const estilos = {
  borde: { color: '#FFFFFF', weight: 9, opacity: 0.9, interactive: false },
  viaje: { color: '#1A73E8', weight: 5, opacity: 1, interactive: false },
  alRetiro: { color: '#202124', weight: 4, opacity: 0.85, dashArray: '2 9', lineCap: 'round', interactive: false },
};

// Encuadra los puntos dejando libre lo que tapa la tarjeta. Con un solo punto, lo centra.
// Sin puntos centra Resistencia; con uno, ese punto. En los dos casos lo deja en el medio de la parte
// visible (arriba de la hoja inferior en el celular, a la derecha de la tarjeta en la computadora), no en
// el medio del mapa, que puede quedar debajo de la tarjeta.
function encuadrar(m, latlngs, tarjeta) {
  const alto = m.getSize().y;
  const celular = globalThis.matchMedia?.('(max-width: 600px)').matches;
  let margen;
  if (tarjeta === 'arriba') margen = { arriba: celular ? 280 : 320, abajo: 90, izquierda: 50, derecha: 50 };
  else if (celular) margen = { arriba: 50, abajo: Math.round(alto * 0.55), izquierda: 40, derecha: 40 };
  else margen = { arriba: 60, abajo: 60, izquierda: 440, derecha: 80 };
  if (latlngs.length < 2) {
    m.setView(latlngs[0] ?? aLatLng(centroResistencia), latlngs.length ? 15 : 14, { animate: false });
    m.panBy([(margen.derecha - margen.izquierda) / 2, (margen.abajo - margen.arriba) / 2], { animate: false });
    return;
  }
  m.fitBounds(L.latLngBounds(latlngs), {
    paddingTopLeft: [margen.izquierda, margen.arriba],
    paddingBottomRight: [margen.derecha, margen.abajo],
    maxZoom: 16,
  });
}

export default function MapaReal({ origen, destino, posicion, auto, tarjeta = 'lateral', chofer = false, alFallar, children }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef({});
  const lineas = useRef(null);
  const marcadorAuto = useRef(null);
  // Última posición del auto, para sumarla a los encuadres (al aparecer y cuando llega la ruta).
  const autoRef = useRef(null);
  autoRef.current = auto?.latitud == null ? null : [auto.latitud, auto.longitud];
  const atribucion = useRef(null);
  const alFallarRef = useRef(alFallar);
  alFallarRef.current = alFallar;

  // Se crea una sola vez. Si los primeros mosaicos fallan y ninguno carga, no hay red: se avisa.
  useEffect(() => {
    const m = L.map(contenedor.current, { zoomControl: false, attributionControl: false })
      .setView(aLatLng(centroResistencia), 14);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    atribucion.current = L.control.attribution({ prefix: false }).addTo(m);
    let cargados = 0;
    let fallidos = 0;
    L.tileLayer(URL_MOSAICOS, { maxZoom: 19, attribution: ATRIBUCION })
      .on('tileload', () => { cargados += 1; })
      .on('tileerror', () => {
        fallidos += 1;
        if (fallidos >= 4 && cargados === 0) alFallarRef.current?.();
      })
      .addTo(m);
    mapa.current = m;
    return () => { m.remove(); mapa.current = null; marcadores.current = {}; lineas.current = null; marcadorAuto.current = null; };
  }, []);

  // El auto: se crea, se mueve o se saca. No reencuadra.
  const autoLat = auto?.latitud;
  const autoLng = auto?.longitud;
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (autoLat === undefined || autoLat === null) {
      marcadorAuto.current?.remove();
      marcadorAuto.current = null;
    } else if (marcadorAuto.current) {
      marcadorAuto.current.setLatLng([autoLat, autoLng]);
    } else {
      marcadorAuto.current = L.marker([autoLat, autoLng], { icon: iconoAuto, title: 'Chofer', keyboard: false, zIndexOffset: 500 }).addTo(m);
      // Al aparecer, el auto entra en el encuadre (si no, podía quedar en el borde o afuera del mapa).
      encuadrar(m, [...[origen, destino, posicion].filter(Boolean).map(aLatLng), [autoLat, autoLng]], tarjeta);
    }
  }, [autoLat, autoLng]);

  // La atribución de OSM es obligatoria y tiene que verse: va en la esquina que la tarjeta no tapa
  // (con la hoja inferior del celular, arriba; con la notificación de oferta del chofer, abajo).
  useEffect(() => {
    atribucion.current?.setPosition(tarjeta === 'arriba' ? 'bottomright' : 'topright');
  }, [tarjeta]);

  // Marcadores y encuadre. Dependen de las coordenadas (no del objeto): el objeto cambia en cada
  // consulta periódica aunque el punto sea el mismo, y el mapa se reencuadraría cada 2 s.
  const puntos = { origen, destino, posicion };
  const firma = JSON.stringify([origen, destino, posicion].map((p) => (p ? aLatLng(p) : null)));
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const tipo of Object.keys(iconos)) {
      const punto = puntos[tipo];
      const actual = marcadores.current[tipo];
      if (!punto) {
        actual?.remove();
        delete marcadores.current[tipo];
      } else if (actual) {
        actual.setLatLng(aLatLng(punto));
      } else {
        marcadores.current[tipo] = L.marker(aLatLng(punto), { icon: iconos[tipo], title: titulos[tipo], keyboard: false }).addTo(m);
      }
    }
    encuadrar(m, [...Object.values(puntos).filter(Boolean).map(aLatLng), ...(autoRef.current ? [autoRef.current] : [])], tarjeta);
  }, [firma, tarjeta]); // `firma` resume los tres puntos

  // Rutas por calles (OSRM): la del viaje (origen → destino) en azul y, en la pantalla del chofer,
  // el tramo hasta el retiro (posicion → origen) punteado. Si OSRM no responde, no se dibuja nada.
  // Al llegar, el mapa se reencuadra para que entre la ruta completa (puede salirse del rectángulo de los marcadores).
  useEffect(() => {
    const m = mapa.current;
    if (!m) return undefined;
    lineas.current?.remove();
    lineas.current = L.layerGroup().addTo(m);
    const cancelar = new AbortController();
    (async () => {
      const [alRetiro, viaje] = await Promise.all([
        posicion && origen ? buscarRuta(posicion, origen, { signal: cancelar.signal }) : null,
        origen && destino ? buscarRuta(origen, destino, { signal: cancelar.signal }) : null,
      ]);
      if (cancelar.signal.aborted || !lineas.current) return;
      if (alRetiro) L.polyline(alRetiro, estilos.alRetiro).addTo(lineas.current);
      if (viaje) {
        L.polyline(viaje, estilos.borde).addTo(lineas.current);
        L.polyline(viaje, estilos.viaje).addTo(lineas.current);
      }
      const todos = [...(alRetiro ?? []), ...(viaje ?? []), ...[posicion, origen, destino].filter(Boolean).map(aLatLng), ...(autoRef.current ? [autoRef.current] : [])];
      if (alRetiro || viaje) encuadrar(m, todos, tarjeta);
    })();
    return () => cancelar.abort();
  }, [firma, tarjeta]);

  return (
    <main className={chofer ? 'mapa mapa--chofer' : 'mapa'}>
      <div ref={contenedor} className="mapa__real" role="region" aria-label="Mapa de Resistencia" />
      {children}
    </main>
  );
}
