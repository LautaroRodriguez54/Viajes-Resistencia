import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import Mapa from '../../componentes/Mapa.jsx';
import Comprobante from '../../componentes/Comprobante.jsx';
import { api } from '../../api/cliente.js';
import { distanciaMetros, nombreDelPunto } from '../../datos/lugares.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 3 del diseño. Consulta GET /viajes/:viajeId cada 2 s (sin SSE todavía).
// Qué viaje se sigue: el que se acaba de pedir (llega en el estado de la navegación desde Pedir) o,
// si se entra desde el menú, el último del historial (GET /viajes?limite=1) mientras siga activo
// o deba el pago. El historial puede ir unos cientos de ms atrasado, por eso Pedir pasa el id.
// Con chofer asignado, GET /viajes/:id trae su vehículo y su última posición (sólo para este pasajero y sólo
// mientras el viaje está activo): el auto se mueve en el mapa y se estiman los minutos.
const pasos = ['Pedido', 'Asignado', 'En camino', 'En viaje'];

// El pasajero puede cancelar hasta que el chofer lo levanta (regla de dominio, decidirCancelacion).
const cancelables = new Set(['solicitado', 'asignado', 'chofer_en_camino']);

const activos = {
  solicitado: { paso: 0, chip: 'Buscando chofer', titulo: 'Buscando un chofer cerca' },
  asignado: { paso: 1, chip: 'Chofer asignado', titulo: 'Un chofer aceptó tu viaje' },
  chofer_en_camino: { paso: 2, chip: 'Chofer en camino', titulo: 'Tu chofer va para el retiro' },
  en_curso: { paso: 3, chip: 'En viaje', titulo: 'Vas camino al destino' },
};

// A 30 km/h, la velocidad promedio de la tarifa de desarrollo: 500 m por minuto.
const minutosHasta = (desde, hasta) => Math.max(1, Math.round(distanciaMetros(desde, hasta) / 500));

const terminales = {
  finalizado: { chip: 'Pagado', clase: 'chip--exito', titulo: 'Llegaste' },
  pago_pendiente: { chip: 'Pago pendiente', clase: 'chip--advertencia', titulo: 'Llegaste, pero falta pagar' },
  sin_choferes_disponibles: { chip: 'Sin choferes', clase: 'chip--neutro', titulo: 'No encontramos chofer' },
  cancelado_pasajero: { chip: 'Cancelado', clase: 'chip--peligro', titulo: 'Cancelaste el viaje' },
  cancelado_chofer: { chip: 'Cancelado', clase: 'chip--peligro', titulo: 'El chofer canceló el viaje' },
  cancelado_operador: { chip: 'Cancelado', clase: 'chip--peligro', titulo: 'El operador canceló el viaje' },
};

export default function MiViaje() {
  const navegar = useNavigate();
  const { state } = useLocation();
  const delPedido = state?.viajeId ? state : null;
  // Al entrar desde el menú se pregunta cada 2 s hasta encontrar un viaje que seguir: el historial
  // puede ir unos cientos de ms atrasado (si se acaba de pedir) y también se entera de un viaje pedido
  // en otra pestaña. Con uno encontrado deja de preguntar y sigue ese viaje por GET /viajes/:id.
  const esSeguible = (v) => Boolean(v && (activos[v.estado] || v.estado === 'pago_pendiente'));
  const { dato: ultimos, error: errorUltimo } = usarConsultaPeriodica(delPedido ? null : () => api.historial(1), 2000, (lista) => esSeguible(lista?.[0]));
  const ultimo = ultimos?.[0];
  const seguible = esSeguible(ultimo);
  const guardado = delPedido
    ?? (seguible ? {
      viajeId: ultimo.viajeId,
      origen: nombreDelPunto(ultimo.origen),
      destino: nombreDelPunto(ultimo.destino),
      origenPunto: ultimo.origen,
      destinoPunto: ultimo.destino,
    } : null);
  const [busqueda, setBusqueda] = useState(state?.busqueda ?? null);
  const [buscando, setBuscando] = useState(false);
  const claveOferta = usarClaveIdempotente();
  const claveCancelar = usarClaveIdempotente();
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState(null);

  // Deja de consultar cuando el viaje llega a un estado terminal.
  const { dato: viaje, error, recargar } = usarConsultaPeriodica(
    guardado ? () => api.viaje(guardado.viajeId) : null,
    2000,
    (dato) => Boolean(terminales[dato?.estado]),
  );

  function pedirOtro() {
    navegar('/pasajero/pedir');
  }

  // Sin el paso de confirmación, un toque de más cancelaría el viaje. Si el chofer ya lo
  // levantó (en_curso), el backend responde TRANSICION_INVALIDA y se muestra el mensaje.
  async function cancelar() {
    setCancelando(true);
    setErrorCancelar(null);
    try {
      await conClave(claveCancelar, (clave) => api.cancelarViaje(guardado.viajeId, clave));
      setConfirmandoCancelar(false);
    } catch (e) {
      setErrorCancelar(e.message);
    } finally {
      setCancelando(false);
      recargar();
    }
  }

  // Sólo cuando el viaje está solicitado y no tiene una oferta vigente (`tieneOfertaVigente`,
  // #34): el primer POST /viajes/:id/ofertas no encontró chofer, o se entró desde el menú
  // después de eso. Si la oferta vence o el chofer la rechaza, el backend se la ofrece solo
  // al siguiente; si no queda ninguno, el viaje pasa a sin_choferes_disponibles (terminal)
  // y se ofrece "Pedir otro viaje". Por eso, con una oferta en curso el botón no aparece:
  // crearía una segunda oferta en paralelo.
  async function buscarDeNuevo() {
    setBuscando(true);
    try {
      await conClave(claveOferta, (clave) => api.buscarChofer(guardado.viajeId, clave));
      setBusqueda('ofrecido');
    } catch (e) {
      setBusqueda(e.codigo === 'SIN_CHOFERES_CERCANOS' ? 'sin_choferes' : e.message);
    } finally {
      setBuscando(false);
    }
  }

  if (!delPedido && !ultimos && !errorUltimo) {
    return <div className="columna"><section className="tarjeta"><p className="pedir__detalle">Buscando tu último viaje…</p></section></div>;
  }

  if (!guardado || error?.codigo === 'RECURSO_NO_ENCONTRADO') {
    return (
      <div className="columna">
        <section className="tarjeta tarjeta--vacia" data-testid="mi-viaje-vacio">
          <h1>No tenés un viaje activo</h1>
          <p className="pedir__detalle">Pedí uno desde la pantalla Pedir. Los anteriores están en Billetera, en "Mis viajes".</p>
          {errorUltimo && <p role="alert" className="aviso aviso--peligro">{errorUltimo.message}</p>}
          <Link to="/pasajero/pedir" className="boton boton--principal boton--grande">Pedir un viaje</Link>
        </section>
      </div>
    );
  }

  const activo = viaje && activos[viaje.estado];
  const terminal = viaje && terminales[viaje.estado];
  const conChofer = activo && activo.paso >= 1;
  // La oferta en curso la informa el servidor. 'ofrecido' cubre los 2 s hasta la próxima consulta
  // después de pedir, y el hueco entre que una oferta vence y el backend se la ofrece al siguiente.
  const ofertaEnCurso = Boolean(viaje?.tieneOfertaVigente) || busqueda === 'ofrecido';
  // Los nombres los guarda el backend desde la migración 007; si no, los que pasó Pedir.
  const nombreOrigen = viaje?.origen ? nombreDelPunto(viaje.origen) : guardado.origen;
  const nombreDestino = viaje?.destino ? nombreDelPunto(viaje.destino) : guardado.destino;
  const chofer = conChofer ? viaje.chofer : null;
  const ubicacionChofer = chofer?.ubicacion ?? null;
  const origenPunto = viaje?.origen ?? guardado.origenPunto;
  const destinoPunto = viaje?.destino ?? guardado.destinoPunto;

  return (
    <Mapa
      etiquetaDestino={nombreDestino} chofer={conChofer ? { etiqueta: 'Tu chofer' } : undefined}
      origen={origenPunto} destino={destinoPunto} auto={ubicacionChofer}
      consumir={viaje?.estado === 'en_curso' ? 'viaje' : null}
    >
      <section
        className="tarjeta tarjeta--flotante pedir mi-viaje montos" aria-labelledby="titulo-viaje"
        data-testid="mi-viaje" data-estado={viaje?.estado ?? 'cargando'}
      >
        {!viaje && !error && (
          <div className="cargando__texto" aria-busy="true" aria-label="Cargando tu viaje">
            <span className="esqueleto esqueleto--linea esqueleto--corta" />
            <span className="esqueleto esqueleto--linea" />
            <span className="esqueleto esqueleto--linea" />
          </div>
        )}
        {error && <p role="alert" className="aviso aviso--peligro">{error.message} Reintentamos solos cada 2 s.</p>}

        {activo && (
          <>
            <span className={activo.paso === 0 ? 'chip chip--acento' : 'chip chip--exito'} data-testid="mi-viaje-chip">{activo.chip}</span>
            <h1 id="titulo-viaje">{activo.titulo}</h1>
            <p className="pedir__detalle">{nombreOrigen} → {nombreDestino}</p>
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
            {chofer && (
              <div className="mi-viaje__chofer" data-testid="mi-viaje-chofer">
                <span className="mi-viaje__auto" aria-hidden="true" />
                <span className="lista__texto">
                  <span>{chofer.vehiculo.marca} {chofer.vehiculo.modelo}</span>
                  <span className="lista__detalle">
                    {ubicacionChofer
                      ? viaje.estado === 'en_curso'
                        ? `Llegan en unos ${minutosHasta(ubicacionChofer, destinoPunto)} min`
                        : `Está a unos ${minutosHasta(ubicacionChofer, origenPunto)} min del retiro`
                      : 'Ubicando al chofer…'}
                  </span>
                </span>
                <span className="patente" data-testid="mi-viaje-patente">{chofer.vehiculo.patente}</span>
              </div>
            )}
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
                {ofertaEnCurso ? (
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
            {cancelables.has(viaje.estado) && (
              confirmandoCancelar ? (
                <div className="confirmar" role="group" aria-label="Confirmar cancelación">
                  <p className="pedir__detalle">
                    ¿Cancelar el viaje? No se cobra nada{conChofer ? ' y el chofer queda libre' : ''}.
                  </p>
                  <div className="confirmar__acciones">
                    <button type="button" className="boton boton--secundario" onClick={() => setConfirmandoCancelar(false)} disabled={cancelando}>
                      No, seguir
                    </button>
                    <button type="button" className="boton boton--peligro-lleno" onClick={cancelar} disabled={cancelando} data-testid="mi-viaje-cancelar-confirmar">
                      {cancelando ? 'Cancelando…' : 'Sí, cancelar'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="boton boton--secundario boton--peligro" onClick={() => { setErrorCancelar(null); setConfirmandoCancelar(true); }} data-testid="mi-viaje-cancelar">
                  Cancelar viaje
                </button>
              )
            )}
            {errorCancelar && <p role="alert" className="aviso aviso--peligro" data-testid="mi-viaje-cancelar-error">{errorCancelar}</p>}
          </>
        )}

        {terminal && (
          <>
            <span className={`chip ${terminal.clase}`} data-testid="mi-viaje-chip">{terminal.chip}</span>
            <h1 id="titulo-viaje">{terminal.titulo}</h1>
            <p className="pedir__detalle">{nombreOrigen} → {nombreDestino}</p>
            {viaje.estado === 'finalizado' && (
              <>
                <p className="aviso" data-testid="mi-viaje-cobro">
                  Se cobraron <strong>{formatearPesos(viaje.tarifaFinalCentavos ?? viaje.estimacionCentavos)}</strong> de tu billetera.
                </p>
                <Comprobante viaje={viaje} />
              </>
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
    </Mapa>
  );
}
