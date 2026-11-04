import MapaSimulado from '../../componentes/MapaSimulado.jsx';
import { viajeActualEjemplo } from '../../datos/ejemplo.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 3 del diseño. Al conectar: viaje activo del pasajero + SSE con
// Last-Event-ID (estado y posición del chofer) → cancelar con Idempotency-Key.
const pasos = ['Pedido', 'Asignado', 'En camino', 'En viaje'];

// Paso alcanzado (índice en `pasos`) y texto del chip para cada estado activo.
const estados = {
  solicitado: { paso: 0, chip: 'Buscando chofer', titulo: () => 'Buscando un chofer cerca' },
  asignado: { paso: 1, chip: 'Chofer asignado', titulo: (v) => `Llega en ${v.minutosHastaRetiro} minutos` },
  chofer_en_camino: { paso: 2, chip: 'Chofer en camino', titulo: (v) => `Llega en ${v.minutosHastaRetiro} minutos` },
  en_curso: { paso: 3, chip: 'En viaje', titulo: () => 'Vas camino al destino' },
};

export default function MiViaje() {
  const viaje = viajeActualEjemplo;
  const estado = estados[viaje.estado];
  const conChofer = estado.paso >= 1;

  return (
    <MapaSimulado
      chofer={conChofer ? { etiqueta: `${viaje.chofer.patente} · ${viaje.minutosHastaRetiro} min` } : undefined}
    >
      <section className="tarjeta tarjeta--flotante pedir mi-viaje montos" aria-labelledby="titulo-viaje">
        <span className="chip chip--exito">{estado.chip}</span>
        <h1 id="titulo-viaje">{estado.titulo(viaje)}</h1>
        {conChofer && (
          <p className="mi-viaje__vehiculo">
            {viaje.chofer.vehiculo} · <strong>{viaje.chofer.patente}</strong>
          </p>
        )}

        <ol className="progreso" aria-label="Progreso">
          {pasos.map((paso, i) => (
            <li
              key={paso}
              className={i < estado.paso ? 'hecho' : i === estado.paso ? 'actual' : undefined}
              aria-current={i === estado.paso ? 'step' : undefined}
            >
              {paso}
            </li>
          ))}
        </ol>

        <div className="mi-viaje__precio">
          <span className="pedir__detalle">Precio estimado</span>
          <span>{formatearPesos(viaje.estimacionCentavos)}</span>
        </div>

        <button type="button" className="boton boton--secundario boton--peligro">Cancelar viaje</button>
      </section>
    </MapaSimulado>
  );
}
