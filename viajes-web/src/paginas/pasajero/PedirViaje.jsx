import { useState } from 'react';
import { useNavigate } from 'react-router';
import MapaSimulado from '../../componentes/MapaSimulado.jsx';
import PinDestino from '../../componentes/PinDestino.jsx';
import { api } from '../../api/cliente.js';
import { guardarViajeActual } from '../../datos/viajeActual.js';
import { lugares } from '../../datos/lugares.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 2 del diseño. POST /viajes (el precio lo calcula el servidor) y enseguida
// POST /viajes/:id/ofertas, cada uno con su Idempotency-Key. Saldo: GET /billetera/me.
// Pendiente en el backend: POST /viajes/estimacion (precio antes de pedir) y la
// asignación automática; hasta entonces la web hace los dos pasos.
export default function PedirViaje() {
  const navegar = useNavigate();
  const [desde, setDesde] = useState('plaza');
  const [hasta, setHasta] = useState('terminal');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const claveViaje = usarClaveIdempotente();
  const claveOferta = usarClaveIdempotente();
  const { dato: billetera } = usarConsultaPeriodica(api.saldo, 10000);

  const origen = lugares.find((l) => l.id === desde);
  const destino = lugares.find((l) => l.id === hasta);
  const mismoLugar = desde === hasta;

  function elegir(setter) {
    return (e) => {
      setter(e.target.value);
      // Otro recorrido es otra intención: no puede reutilizar la clave del anterior.
      claveViaje.renovar();
      setError(null);
    };
  }

  async function pedirViaje() {
    setEnviando(true);
    setError(null);
    const punto = ({ latitud, longitud }) => ({ latitud, longitud });
    let viaje;
    try {
      viaje = await conClave(claveViaje, (clave) => api.solicitarViaje(punto(origen), punto(destino), clave));
    } catch (e) {
      setError(e.message);
      setEnviando(false);
      return;
    }
    guardarViajeActual({ id: viaje.id, origen: origen.nombre, destino: destino.nombre });

    let busqueda = 'ofrecido';
    try {
      await conClave(claveOferta, (clave) => api.buscarChofer(viaje.id, clave));
    } catch (e) {
      busqueda = e.codigo === 'SIN_CHOFERES_CERCANOS' ? 'sin_choferes' : e.message;
    }
    navegar('/pasajero/viaje', { state: { busqueda } });
  }

  return (
    <MapaSimulado etiquetaDestino={destino.nombre}>
      <section className="tarjeta tarjeta--flotante pedir montos" aria-labelledby="titulo-pedir">
        <h1 id="titulo-pedir">Pedir un viaje</h1>

        <label htmlFor="desde" className="etiqueta">Desde</label>
        <div className="input-con-icono">
          <span className="punto-origen" aria-hidden="true" />
          <select id="desde" value={desde} onChange={elegir(setDesde)} data-testid="pedir-desde">
            {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>

        <label htmlFor="hasta" className="etiqueta">Hasta</label>
        <div className="input-con-icono">
          <PinDestino />
          <select id="hasta" value={hasta} onChange={elegir(setHasta)} data-testid="pedir-hasta">
            {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>

        <div className="pedir__resumen">
          <span className="pedir__detalle">El precio lo calcula el servidor al pedir.</span>
        </div>

        {mismoLugar && <p role="alert" className="aviso aviso--advertencia">Elegí un destino distinto del origen.</p>}
        {error && <p role="alert" className="aviso aviso--peligro" data-testid="pedir-error">{error}</p>}

        <button
          type="button" className="boton boton--principal boton--grande"
          disabled={mismoLugar || enviando} onClick={pedirViaje} data-testid="pedir-enviar"
        >
          {enviando ? 'Pidiendo…' : 'Pedir viaje'}
        </button>
        <p className="pedir__saldo" data-testid="pedir-saldo">
          Se cobra de tu billetera al llegar.
          {billetera && <> Saldo: {formatearPesos(billetera.saldoCentavos)}</>}
        </p>
      </section>
    </MapaSimulado>
  );
}
