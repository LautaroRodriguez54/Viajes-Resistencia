import { useState } from 'react';
import MapaSimulado from '../../componentes/MapaSimulado.jsx';
import PinDestino from '../../componentes/PinDestino.jsx';
import { billeteraEjemplo, estimacionEjemplo } from '../../datos/ejemplo.js';
import { formatearDistancia, formatearDuracion, formatearPesos } from '../../formato.js';

// Pantalla 2 del diseño. Al conectar: Places Autocomplete en Desde/Hasta →
// POST /viajes/estimacion (el precio lo calcula el servidor) → POST /viajes
// con Idempotency-Key. Saldo desde GET /billetera/me.
export default function PedirViaje() {
  const [desde, setDesde] = useState(estimacionEjemplo.origen.nombre);
  const [hasta, setHasta] = useState(estimacionEjemplo.destino.nombre);
  const estimacion = estimacionEjemplo;

  return (
    <MapaSimulado etiquetaDestino={hasta || estimacion.destino.nombre}>
      <section className="tarjeta tarjeta--flotante pedir montos" aria-labelledby="titulo-pedir">
        <h1 id="titulo-pedir">Pedir un viaje</h1>

        <label htmlFor="desde" className="etiqueta">Desde</label>
        <div className="input-con-icono">
          <span className="punto-origen" aria-hidden="true" />
          <input id="desde" value={desde} onChange={(e) => setDesde(e.target.value)} autoComplete="off" />
        </div>

        <label htmlFor="hasta" className="etiqueta">Hasta</label>
        <div className="input-con-icono">
          <PinDestino />
          <input id="hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} autoComplete="off" />
        </div>

        <div className="pedir__resumen">
          <span className="pedir__detalle">
            {formatearDistancia(estimacion.distanciaMetros)} · {formatearDuracion(estimacion.duracionSegundos)}
          </span>
          <span className="pedir__precio">{formatearPesos(estimacion.tarifaEstimadaCentavos)}</span>
        </div>

        <button type="button" className="boton boton--principal boton--grande" disabled={!desde || !hasta}>
          Pedir viaje
        </button>
        <p className="pedir__saldo">
          Se cobra de tu billetera al llegar. Saldo: {formatearPesos(billeteraEjemplo.saldoCentavos)}
        </p>
      </section>
    </MapaSimulado>
  );
}
