import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ATRIBUCION, centroResistencia, URL_MOSAICOS } from '../mapas/config.js';

// Mapa real con Leaflet y OpenStreetMap. Recibe los mismos hijos que MapaSimulado (las tarjetas
// flotantes) y los puntos en el formato del backend: { latitud, longitud }.
// - origen: punto de retiro (círculo negro, como en el diseño);
// - destino: pin rojo;
// - posicion: "Vos" (el chofer en su pantalla), punto azul.
// No dibuja la ruta: sin un servicio de rutas (etapa 3, desde el backend) sería una línea recta engañosa.
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

export default function MapaReal({ origen, destino, posicion, tarjeta = 'lateral', chofer = false, alFallar, children }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef({});
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
    return () => { m.remove(); mapa.current = null; marcadores.current = {}; };
  }, []);

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
    const visibles = Object.values(puntos).filter(Boolean).map(aLatLng);
    if (visibles.length === 1) m.setView(visibles[0], 15);
    if (visibles.length > 1) {
      const alto = m.getSize().y;
      const celular = globalThis.matchMedia?.('(max-width: 600px)').matches;
      let margen;
      if (tarjeta === 'arriba') margen = { arriba: celular ? 280 : 320, abajo: 90, izquierda: 50, derecha: 50 };
      else if (celular) margen = { arriba: 50, abajo: Math.round(alto * 0.55), izquierda: 40, derecha: 40 };
      else margen = { arriba: 60, abajo: 60, izquierda: 440, derecha: 80 };
      m.fitBounds(L.latLngBounds(visibles), {
        paddingTopLeft: [margen.izquierda, margen.arriba],
        paddingBottomRight: [margen.derecha, margen.abajo],
        maxZoom: 16,
      });
    }
  }, [firma, tarjeta]); // `firma` resume los tres puntos

  return (
    <main className={chofer ? 'mapa mapa--chofer' : 'mapa'}>
      <div ref={contenedor} className="mapa__real" role="region" aria-label="Mapa de Resistencia" />
      {children}
    </main>
  );
}
