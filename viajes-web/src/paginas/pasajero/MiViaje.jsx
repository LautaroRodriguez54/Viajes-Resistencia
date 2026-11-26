import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import MapaSimulado from '../../componentes/MapaSimulado.jsx';
import { api } from '../../api/cliente.js';
import { guardarViajeActual, leerViajeActual } from '../../datos/viajeActual.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 3 del diseño. Consulta GET /viajes/:viajeId cada 2 s (sin SSE todavía).
// Pendiente en el backend: patente, vehículo y minutos hasta el retiro en el viaje,
// y cancelar con motivo. Mientras tanto el botón de cancelar no se muestra.
const pasos = ['Pedido', 'Asignado', 'En camino', 'En viaje'];

const activos = {
  solicitado: { paso: 0, chip: 'Buscando chofer', titulo: 'Buscando un chofer cerca' },
  asignado: { paso: 1, chip: 'Chofer asignado', titulo: 'Un chofer aceptó tu viaje' },
  chofer_en_camino: { paso: 2, chip: 'Chofer en camino', titulo: 'Tu chofer va para el retiro' },
  en_curso: { paso: 3, chip: 'En viaje', titulo: 'Vas camino al destino' },
};

const terminales = {
  finalizado: { chip: 'Pagado', clase: 'chip--exito', titulo: 'Llegaste' },
  pago_pendiente: { chip: 'Pago pendiente', clase: 'chip--advertencia', titulo: 'Llegaste, pero falta pagar' },
  sin_choferes_disponibles: { chip: 'Sin choferes', clase: 'chip--neutro', titulo: 'No encontramos chofer' },
  cancelado_pasajero: { chip: 'Cancelado', clase: 'chip--peligro', titulo: 'Cancelaste el viaje' },
  cancelado_chofer: { chip: 'Cancelado', clase: 'chip--peligro', titulo: 'El chofer canceló el viaje' },
};

export default function MiViaje() {
  const navegar = useNavigate();
  const { state } = useLocation();
  const guardado = leerViajeActual();
  const [busqueda, setBusqueda] = useState(state?.busqueda ?? null);
  const [buscando, setBuscando] = useState(false);
  const claveOferta = usarClaveIdempotente();

  // Deja de consultar cuando el viaje llega a un estado terminal.
  const { dato: viaje, error } = usarConsultaPeriodica(
    guardado ? () => api.viaje(guardado.id) : null,
    2000,
    (dato) => Boolean(terminales[dato?.estado]),
  );

  function pedirOtro() {
    guardarViajeActual(null);
    navegar('/pasajero/pedir');
  }

  // Sólo cuando el primer POST /viajes/:id/ofertas no encontró chofer (el viaje sigue
  // solicitado y sin oferta). Si la oferta vence o el chofer la rechaza, el backend se
  // la ofrece solo al siguiente; si no queda ninguno, el viaje pasa a
  // sin_choferes_disponibles (terminal) y se ofrece "Pedir otro viaje".
  async function buscarDeNuevo() {
    setBuscando(true);
    try {
      await conClave(claveOferta, (clave) => api.buscarChofer(guardado.id, clave));
      setBusqueda('ofrecido');
    } catch (e) {
      setBusqueda(e.codigo === 'SIN_CHOFERES_CERCANOS' ? 'sin_choferes' : e.message);
    } finally {
      setBuscando(false);
    }
  }

  if (!guardado || error?.codigo === 'RECURSO_NO_ENCONTRADO') {
    return (
      <div className="columna">
        <section className="tarjeta" data-testid="mi-viaje-vacio">
          <h1>No tenés un viaje activo</h1>
          <p className="pedir__detalle">Pedí uno desde la pantalla Pedir.</p>
          <Link to="/pasajero/pedir" className="boton boton--principal">Pedir un viaje</Link>
        </section>
      </div>
    );
  }

  const activo = viaje && activos[viaje.estado];
  const terminal = viaje && terminales[viaje.estado];
  const conChofer = activo && activo.paso >= 1;

  return (
    <MapaSimulado etiquetaDestino={guardado.destino} chofer={conChofer ? { etiqueta: 'Tu chofer' } : undefined}>
      <section
        className="tarjeta tarjeta--flotante pedir mi-viaje montos" aria-labelledby="titulo-viaje"
        data-testid="mi-viaje" data-estado={viaje?.estado ?? 'cargando'}
      >
        {!viaje && !error && <p className="pedir__detalle">Cargando tu viaje…</p>}
        {error && <p role="alert" className="aviso aviso--peligro">{error.message} Reintentamos solos cada 2 s.</p>}

        {activo && (
          <>
            <span className={activo.paso === 0 ? 'chip chip--acento' : 'chip chip--exito'} data-testid="mi-viaje-chip">{activo.chip}</span>
            <h1 id="titulo-viaje">{activo.titulo}</h1>
            <p className="pedir__detalle">{guardado.origen} → {guardado.destino}</p>
            <ol className="progreso" aria-label="Progreso">
              {pasos.map((paso, i) => (
                <li
                  key={paso}
                  className={i < activo.paso ? 'hecho' : i === activo.paso ? 'actual' : undefined}
                  aria-current={i === activo.paso ? 'step' : undefined}
                >
                  {paso}
                </li>
              ))}
            </ol>
            <div className="mi-viaje__precio">
              <span className="pedir__detalle">Precio estimado</span>
              <span data-testid="mi-viaje-precio">{formatearPesos(viaje.estimacionCentavos)}</span>
            </div>
            {activo.paso === 0 && (
              <>
                {busqueda === 'sin_choferes' && (
                  <p role="alert" className="aviso aviso--advertencia" data-testid="mi-viaje-sin-choferes">
                    No hay choferes disponibles cerca en este momento.
                  </p>
                )}
                {busqueda && busqueda !== 'sin_choferes' && busqueda !== 'ofrecido' && (
                  <p role="alert" className="aviso aviso--peligro">{busqueda}</p>
                )}
                {busqueda === 'ofrecido' ? (
                  <p className="ayuda" data-testid="mi-viaje-ofrecido">
                    Le ofrecimos el viaje al chofer más cercano. Si no acepta en 30 s o lo rechaza,
                    {' '}se lo ofrecemos al siguiente.
                  </p>
                ) : (
                  <button type="button" className="boton boton--secundario" onClick={buscarDeNuevo} disabled={buscando} data-testid="mi-viaje-buscar">
                    {buscando ? 'Buscando…' : 'Buscar chofer de nuevo'}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {terminal && (
          <>
            <span className={`chip ${terminal.clase}`} data-testid="mi-viaje-chip">{terminal.chip}</span>
            <h1 id="titulo-viaje">{terminal.titulo}</h1>
            <p className="pedir__detalle">{guardado.origen} → {guardado.destino}</p>
            {viaje.estado === 'finalizado' && (
              <p className="aviso" data-testid="mi-viaje-cobro">
                Se cobraron <strong>{formatearPesos(viaje.tarifaFinalCentavos ?? viaje.estimacionCentavos)}</strong> de tu billetera.
              </p>
            )}
            {viaje.estado === 'sin_choferes_disponibles' && (
              <p className="aviso aviso--advertencia" data-testid="mi-viaje-sin-choferes-final">
                Se lo ofrecimos a los choferes cercanos y ninguno lo aceptó. No se cobró nada.
              </p>
            )}
            {viaje.estado === 'pago_pendiente' && (
              <>
                <p role="alert" className="aviso aviso--advertencia" data-testid="mi-viaje-pago-pendiente">
                  Tu saldo no alcanzó para pagar <strong>{formatearPesos(viaje.tarifaFinalCentavos)}</strong>.
                  {' '}No se cobró nada: el cobro nunca es parcial.
                </p>
                <Link to="/pasajero/billetera" className="boton boton--principal" data-testid="mi-viaje-ir-billetera">Ir a la billetera</Link>
              </>
            )}
            {viaje.estado !== 'pago_pendiente' && (
              <button type="button" className="boton boton--principal" onClick={pedirOtro} data-testid="mi-viaje-pedir-otro">Pedir otro viaje</button>
            )}
          </>
        )}
      </section>
    </MapaSimulado>
  );
}
