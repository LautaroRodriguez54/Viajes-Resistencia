import { useState } from 'react';
import { viajesActivosEjemplo } from '../../datos/ejemplo.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 6 del diseño: viajes activos. Al tocar uno se despliega el
// motivo (obligatorio) y "Cancelar viaje". Sólo visual.
const chips = {
  solicitado: { texto: 'Pedido', clase: 'chip--acento' },
  asignado: { texto: 'Asignado', clase: 'chip--exito' },
  chofer_en_camino: { texto: 'En camino', clase: 'chip--exito' },
  en_curso: { texto: 'En viaje', clase: 'chip--neutro' },
  pago_pendiente: { texto: 'Pago pendiente', clase: 'chip--advertencia' },
};

const motivos = ['Sin choferes en la zona', 'Pedido del pasajero', 'Otro'];

function detalle(viaje) {
  if (viaje.estado === 'pago_pendiente') return `${viaje.patente} · ${formatearPesos(viaje.importeCentavos)} sin pagar`;
  return viaje.patente ? `${viaje.patente} · ${viaje.detalle}` : viaje.detalle;
}

export default function ViajesActivos() {
  const [viajes, setViajes] = useState(viajesActivosEjemplo);
  const [seleccionado, setSeleccionado] = useState(viajesActivosEjemplo[0]?.id ?? null);
  const [motivo, setMotivo] = useState('');

  function seleccionar(id) {
    setSeleccionado(seleccionado === id ? null : id);
    setMotivo('');
  }

  function cancelar(evento) {
    evento.preventDefault();
    setViajes(viajes.filter((viaje) => viaje.id !== seleccionado));
    setSeleccionado(null);
    setMotivo('');
  }

  return (
    <div className="columna columna--ancha montos">
      <section className="tarjeta lista" aria-labelledby="titulo-activos">
        <h1 id="titulo-activos">Viajes activos <span className="lista__cantidad">· {viajes.length}</span></h1>
        {viajes.length === 0 ? (
          <p className="pedir__detalle">No hay viajes activos.</p>
        ) : (
          <ul>
            {viajes.map((viaje) => {
              const chip = chips[viaje.estado];
              const abierto = viaje.id === seleccionado;
              return (
                <li key={viaje.id} className="operador__viaje">
                  <button
                    type="button" className="operador__fila" aria-expanded={abierto}
                    onClick={() => seleccionar(viaje.id)}
                  >
                    <span className="lista__texto">
                      <span>{viaje.recorrido}</span>
                      <span className="lista__detalle">{detalle(viaje)}</span>
                    </span>
                    <span className={`chip ${chip.clase}`}>{chip.texto}</span>
                  </button>
                  {abierto && (
                    <form className="operador__cancelar" onSubmit={cancelar}>
                      <label htmlFor={`motivo-${viaje.id}`} className="etiqueta">Motivo</label>
                      <select
                        id={`motivo-${viaje.id}`} className="input operador__motivo" required
                        value={motivo} onChange={(e) => setMotivo(e.target.value)}
                      >
                        <option value="" disabled>Elegí un motivo</option>
                        {motivos.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <button type="submit" className="boton boton--peligro-lleno">Cancelar viaje</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
