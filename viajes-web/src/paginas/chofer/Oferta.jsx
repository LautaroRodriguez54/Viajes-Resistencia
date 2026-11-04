import { useEffect, useState } from 'react';
import MapaSimulado from '../../componentes/MapaSimulado.jsx';
import { choferEjemplo, ofertaEjemplo } from '../../datos/ejemplo.js';
import { formatearDistancia, formatearPesos } from '../../formato.js';

// Pantalla 5 del diseño: oferta de viaje con vista previa en el mapa y el
// interruptor de disponibilidad. Sólo visual: todo pasa en el navegador.
const duracionOferta = 30;

function minutos(segundos) {
  return `${Math.max(1, Math.round(segundos / 60))} min`;
}

export default function Oferta() {
  const [disponible, setDisponible] = useState(choferEjemplo.disponible);
  const [oferta, setOferta] = useState(ofertaEjemplo);
  const [segundos, setSegundos] = useState(ofertaEjemplo.segundosRestantes);
  const [carreraPerdida, setCarreraPerdida] = useState(false);

  const visible = disponible && oferta !== null;

  // Cuenta regresiva de 30 s; al llegar a 0 la oferta desaparece.
  useEffect(() => {
    if (!visible || carreraPerdida) return undefined;
    if (segundos === 0) {
      setOferta(null);
      return undefined;
    }
    const temporizador = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(temporizador);
  }, [visible, carreraPerdida, segundos]);

  // "Aceptar" muestra el aviso de la carrera: otro chofer la aceptó antes.
  function aceptar() {
    setCarreraPerdida(true);
    setTimeout(() => setOferta(null), 2500);
  }

  // Para repetir la demo: al volver a estar disponible llega de nuevo la oferta de ejemplo.
  function cambiarDisponibilidad() {
    if (!disponible) {
      setOferta(ofertaEjemplo);
      setSegundos(ofertaEjemplo.segundosRestantes);
      setCarreraPerdida(false);
    }
    setDisponible(!disponible);
  }

  const urgente = segundos <= 5;

  return (
    <MapaSimulado oferta conRuta={visible}>
      {visible && (
        <section
          role="alertdialog" aria-labelledby="oferta-titulo" aria-describedby="oferta-detalle"
          className="oferta montos"
        >
          <div className="oferta__aviso">
            <span className="oferta__icono" aria-hidden="true" />
            <span className="oferta__app">Viajes Resistencia · ahora</span>
            <span className={urgente ? 'oferta__reloj oferta__reloj--urgente' : 'oferta__reloj'}>{segundos} s</span>
          </div>
          <div className="oferta__titulo">
            <h1 id="oferta-titulo">Nuevo viaje</h1>
            <span className="oferta__monto">{formatearPesos(oferta.tarifaEstimadaCentavos)}</span>
          </div>
          <p id="oferta-detalle" className="oferta__recorrido">
            {oferta.origen.nombre} → {oferta.destino.nombre}
            <br />
            <span className="pedir__detalle">
              Retiro a {formatearDistancia(oferta.distanciaRetiroMetros)} ({minutos(oferta.duracionRetiroSegundos)})
              {' '}· viaje de {formatearDistancia(oferta.distanciaViajeMetros)} ({minutos(oferta.duracionViajeSegundos)})
            </span>
          </p>
          <div className="oferta__barra" aria-hidden="true">
            <div
              className={urgente ? 'oferta__progreso oferta__progreso--urgente' : 'oferta__progreso'}
              style={{ width: `${(segundos / duracionOferta) * 100}%` }}
            />
          </div>
          {carreraPerdida && (
            <p role="alert" className="aviso aviso--peligro">Otro chofer lo aceptó primero.</p>
          )}
          <div className="oferta__acciones">
            <button type="button" className="boton boton--secundario" disabled={carreraPerdida} onClick={() => setOferta(null)}>
              Rechazar
            </button>
            <button type="button" className="boton boton--principal" disabled={carreraPerdida} onClick={aceptar}>
              Aceptar
            </button>
          </div>
        </section>
      )}

      <div className="disponible">
        <span className="disponible__texto">
          <span className="disponible__estado">{disponible ? 'Disponible' : 'No disponible'}</span>
          <span className="disponible__detalle">
            {!disponible ? 'no recibís viajes' : oferta ? 'enviando ubicación' : 'esperando viajes'}
          </span>
        </span>
        <button
          type="button" role="switch" aria-checked={disponible} aria-label="Disponible para recibir viajes"
          className="interruptor" onClick={cambiarDisponibilidad}
        >
          <span />
        </button>
      </div>
    </MapaSimulado>
  );
}
