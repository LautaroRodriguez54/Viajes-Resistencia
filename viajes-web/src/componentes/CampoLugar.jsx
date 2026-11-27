import { useEffect, useId, useState } from 'react';
import { limitesResistencia, URL_PHOTON } from '../mapas/config.js';
import { lugares } from '../datos/lugares.js';

// Campo "Desde" / "Hasta" con autocompletado de direcciones (Photon, sobre datos de OpenStreetMap).
// Sólo con el mapa real; con VITE_MAPA=simulado, Pedir muestra la lista fija en un <select>.
// - Con el campo vacío ofrece los lugares frecuentes (la lista fija): la demo anda aunque Photon tarde o no responda.
// - Desde 3 letras pide sugerencias dentro del rectángulo de Resistencia (el backend busca choferes a ≤ 5 km
//   del origen), con una espera corta entre teclas y cancelando el pedido anterior (uso moderado del servidor público).
// - Entrega { nombre, latitud, longitud }. Lo que se escribe viaja a photon.komoot.io (privacidad: se avisa en el README).
// Accesible con teclado: patrón combobox (flechas, Enter, Escape).
const ESPERA_MS = 300;
const MINIMO_LETRAS = 3;
const { oeste, sur, este, norte } = limitesResistencia;

const frecuentes = lugares.map((l) => ({ clave: l.id, principal: l.nombre, secundario: 'Lugar frecuente', lugar: l }));

// Photon devuelve GeoJSON: coordenadas [longitud, latitud] y propiedades sueltas (nombre, calle, número, barrio).
function aOpcion(f) {
  const p = f.properties;
  const calle = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : null;
  const principal = p.name ?? calle ?? 'Sin nombre';
  const secundario = [p.name ? calle : null, p.district ?? p.locality, p.city].filter(Boolean).join(', ');
  const [longitud, latitud] = f.geometry.coordinates;
  return { clave: `${p.osm_type}${p.osm_id}`, principal, secundario, lugar: { nombre: principal, latitud, longitud } };
}

export default function CampoLugar({ id, etiqueta, valor, alElegir, icono, testId, placeholder }) {
  const [texto, setTexto] = useState(valor?.nombre ?? '');
  const [opciones, setOpciones] = useState(frecuentes);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [error, setError] = useState(null);
  const idLista = useId();

  useEffect(() => { setTexto(valor?.nombre ?? ''); }, [valor?.nombre]);

  useEffect(() => {
    if (!abierto) return undefined;
    const consulta = texto.trim();
    if (consulta.length < MINIMO_LETRAS || consulta === valor?.nombre) {
      setOpciones(frecuentes);
      return undefined;
    }
    const cancelar = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const url = `${URL_PHOTON}?${new URLSearchParams({
          q: consulta, limit: '6', bbox: `${oeste},${sur},${este},${norte}`, lat: '-27.4514', lon: '-58.9867',
        })}`;
        const respuesta = await fetch(url, { signal: cancelar.signal });
        if (!respuesta.ok) throw new Error(`Photon ${respuesta.status}`);
        const { features } = await respuesta.json();
        setError(null);
        setOpciones(features.length ? features.map(aOpcion) : []);
      } catch (e) {
        if (e.name !== 'AbortError') setError('No pudimos buscar direcciones. Elegí un lugar frecuente.');
      }
    }, ESPERA_MS);
    return () => { cancelar.abort(); clearTimeout(temporizador); };
  }, [texto, abierto, valor?.nombre]);

  function elegir(opcion) {
    setAbierto(false);
    setActiva(-1);
    alElegir(opcion.lugar);
  }

  function teclado(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActiva((i) => Math.min(i + 1, opciones.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && abierto && opciones[activa]) { e.preventDefault(); elegir(opciones[activa]); }
    else if (e.key === 'Escape') { setAbierto(false); setTexto(valor?.nombre ?? ''); }
  }

  const sinResultados = abierto && opciones.length === 0 && texto.trim().length >= MINIMO_LETRAS;

  return (
    <div className="campo-lugar">
      <label htmlFor={id} className="etiqueta">{etiqueta}</label>
      <div className="input-con-icono">
        {icono}
        <input
          id={id} type="text" autoComplete="off" spellCheck={false} data-testid={testId} placeholder={placeholder}
          role="combobox" aria-expanded={abierto} aria-controls={idLista} aria-autocomplete="list"
          aria-activedescendant={abierto && activa >= 0 ? `${idLista}-${activa}` : undefined}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActiva(-1); }}
          onFocus={(e) => { e.target.select(); setAbierto(true); }}
          // Al salir sin elegir vuelve el último lugar elegido. La lista evita el blur con onMouseDown.
          onBlur={() => { setAbierto(false); setTexto(valor?.nombre ?? ''); }}
          onKeyDown={teclado}
        />
      </div>
      {abierto && opciones.length > 0 && (
        <ul id={idLista} role="listbox" className="campo-lugar__lista">
          {opciones.map((o, i) => (
            <li
              key={o.clave} id={`${idLista}-${i}`} role="option" aria-selected={i === activa}
              className={i === activa ? 'campo-lugar__opcion campo-lugar__opcion--activa' : 'campo-lugar__opcion'}
              onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)}
            >
              <span>{o.principal}</span>
              {o.secundario && <span className="lista__detalle">{o.secundario}</span>}
            </li>
          ))}
        </ul>
      )}
      {sinResultados && <p className="ayuda">No encontramos esa dirección en Resistencia.</p>}
      {error && <p role="alert" className="ayuda texto-advertencia">{error}</p>}
    </div>
  );
}
