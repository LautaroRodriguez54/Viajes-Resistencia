import { useState } from 'react';
import { useNavigate } from 'react-router';
import CampoLugar from '../../componentes/CampoLugar.jsx';
import Mapa from '../../componentes/Mapa.jsx';
import PinDestino from '../../componentes/PinDestino.jsx';
import { api } from '../../api/cliente.js';
import { lugares, recordarNombre } from '../../datos/lugares.js';
import { usarMapaReal } from '../../mapas/config.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 2 del diseño. POST /viajes (el precio lo calcula el servidor) y enseguida
// POST /viajes/:id/ofertas, cada uno con su Idempotency-Key. Saldo: GET /billetera/me.
// Origen y destino: { nombre, latitud, longitud }. Con el mapa real se eligen escribiendo la dirección
// (CampoLugar, Photon); con VITE_MAPA=simulado, de la lista fija. Al backend van sólo las coordenadas.
// Pendiente en el backend: POST /viajes/estimacion (precio antes de pedir) y la
// asignación automática; hasta entonces la web hace los dos pasos.
const porId = (id) => lugares.find((l) => l.id === id);

export default function PedirViaje() {
  const navegar = useNavigate();
  const [origen, setOrigen] = useState(() => porId('plaza'));
  const [destino, setDestino] = useState(() => porId('terminal'));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const claveViaje = usarClaveIdempotente();
  const claveOferta = usarClaveIdempotente();
  const { dato: billetera } = usarConsultaPeriodica(api.saldo, 10000);

  const mismoLugar = origen.latitud === destino.latitud && origen.longitud === destino.longitud;

  function elegir(setter) {
    return (lugar) => {
      setter(lugar);
      // Otro recorrido es otra intención: no puede reutilizar la clave del anterior.
      claveViaje.renovar();
      setError(null);
    };
  }
  const elegirDeLista = (setter) => (e) => elegir(setter)(porId(e.target.value));

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
    let busqueda = 'ofrecido';
    try {
      await conClave(claveOferta, (clave) => api.buscarChofer(viaje.id, clave));
    } catch (e) {
      busqueda = e.codigo === 'SIN_CHOFERES_CERCANOS' ? 'sin_choferes' : e.message;
    }
    // El backend guarda sólo coordenadas: el nombre elegido se recuerda en la pestaña para el historial.
    recordarNombre(origen, origen.nombre);
    recordarNombre(destino, destino.nombre);
    // El id va en la navegación y no se espera al historial, que puede ir unos cientos de ms atrasado.
    navegar('/pasajero/viaje', {
      state: { viajeId: viaje.id, origen: origen.nombre, destino: destino.nombre, origenPunto: punto(origen), destinoPunto: punto(destino), busqueda },
    });
  }

  return (
    <Mapa etiquetaDestino={destino.nombre} origen={origen} destino={destino}>
      <section className="tarjeta tarjeta--flotante pedir montos" aria-labelledby="titulo-pedir">
        <h1 id="titulo-pedir">Pedir un viaje</h1>

        {usarMapaReal ? (
          <>
            <CampoLugar
              id="desde" etiqueta="Desde" valor={origen} alElegir={elegir(setOrigen)} testId="pedir-desde"
              icono={<span className="punto-origen" aria-hidden="true" />}
            />
            <CampoLugar id="hasta" etiqueta="Hasta" valor={destino} alElegir={elegir(setDestino)} testId="pedir-hasta" icono={<PinDestino />} />
          </>
        ) : (
          <>
            <label htmlFor="desde" className="etiqueta">Desde</label>
            <div className="input-con-icono">
              <span className="punto-origen" aria-hidden="true" />
              <select id="desde" value={origen.id} onChange={elegirDeLista(setOrigen)} data-testid="pedir-desde">
                {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </div>

            <label htmlFor="hasta" className="etiqueta">Hasta</label>
            <div className="input-con-icono">
              <PinDestino />
              <select id="hasta" value={destino.id} onChange={elegirDeLista(setDestino)} data-testid="pedir-hasta">
                {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </div>
          </>
        )}

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
    </Mapa>
  );
}
