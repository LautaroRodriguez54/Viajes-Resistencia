import { useState } from 'react';
import { usarMapaReal } from '../mapas/config.js';
import MapaReal from './MapaReal.jsx';
import MapaSimulado from './MapaSimulado.jsx';

// Elige el mapa: el real (Leaflet + OpenStreetMap) salvo que VITE_MAPA=simulado, o que los mosaicos no
// carguen (sin internet). En ese caso la pantalla sigue andando con el dibujo del diseño en lugar de
// quedar en gris.
// Props: las de MapaSimulado (conRuta, etiquetaDestino, chofer, oferta) y las del mapa real
// (origen, destino, posicion, auto, tarjeta). Cada mapa usa las suyas.
export default function Mapa({ origen, destino, posicion, auto, tarjeta, ...props }) {
  const [sinRed, setSinRed] = useState(false);
  if (!usarMapaReal || sinRed) return <MapaSimulado {...props} />;
  return (
    <MapaReal
      origen={origen} destino={destino} posicion={posicion} auto={auto} tarjeta={tarjeta}
      chofer={Boolean(props.oferta)} alFallar={() => setSinRed(true)}
    >
      {props.children}
    </MapaReal>
  );
}
