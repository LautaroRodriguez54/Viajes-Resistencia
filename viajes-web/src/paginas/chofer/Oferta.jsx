import { useEffect, useState } from 'react';
import Mapa from '../../componentes/Mapa.jsx';
import { api } from '../../api/cliente.js';
import { distanciaMetros, nombreDe, posicionChoferDemo } from '../../datos/lugares.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearDistancia, formatearPesos } from '../../formato.js';

// Pantalla 5 del diseño, conectada:
// - "Disponible": PUT /choferes/me/disponibilidad y, mientras está prendido,
//   PUT /choferes/me/ubicacion cada 10 s (posición fija de la demo, junto a la plaza).
// - Oferta: GET /choferes/me/ofertas cada 2 s; la cuenta regresiva sale de venceAt
//   (el servidor decide el vencimiento). Aceptar: POST /ofertas/:id/aceptar con
//   Idempotency-Key; si otro chofer ganó la carrera llega OFERTA_NO_DISPONIBLE.
// - Viaje: GET /choferes/me/viaje-actual cada 2 s y los botones para avanzar el estado
//   y finalizar (POST .../finalizar con Idempotency-Key, que cobra de la billetera).
// - Rechazar: POST /ofertas/:id/rechazar con Idempotency-Key. El backend se lo ofrece
//   al siguiente chofer cercano y a este no se lo vuelve a ofrecer. Si la oferta ya
//   venció o la tomó otro, llega OFERTA_NO_DISPONIBLE y sólo se oculta.
// - Vencimiento: lo decide el servidor (OFERTA_TTL_SEGUNDOS). Cuando la cuenta llega a 0
//   la tarjeta se oculta; la consulta siguiente ya no devuelve la oferta.
const duracionOferta = 30;

const siguientePaso = {
  asignado: { estado: 'chofer_en_camino', boton: 'Voy en camino', titulo: 'Viaje asignado' },
  chofer_en_camino: { estado: 'en_curso', boton: 'Pasajero a bordo: iniciar viaje', titulo: 'Yendo al retiro' },
  en_curso: { estado: null, boton: 'Finalizar y cobrar', titulo: 'En viaje' },
};

function minutos(metros) {
  // A 30 km/h, como la velocidad promedio de la tarifa de desarrollo.
  return `${Math.max(1, Math.round(metros / 500))} min`;
}

export default function Oferta() {
  const [disponible, setDisponible] = useState(false);
  const [errorDisponible, setErrorDisponible] = useState(null);
  const [ignoradas, setIgnoradas] = useState([]);
  const [carreraPerdida, setCarreraPerdida] = useState(null);
  const [aceptando, setAceptando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [avanzando, setAvanzando] = useState(false);
  const [errorViaje, setErrorViaje] = useState(null);
  const [cobro, setCobro] = useState(null);
  const [ahora, setAhora] = useState(Date.now());
  const claveAceptar = usarClaveIdempotente();
  const claveRechazar = usarClaveIdempotente();
  const claveFinalizar = usarClaveIdempotente();

  const { dato: actual, recargar: recargarViaje } = usarConsultaPeriodica(api.viajeActualChofer);
  const viaje = actual?.viaje ?? null;
  const { dato: pendiente } = usarConsultaPeriodica(disponible && !viaje ? api.ofertaPendiente : null);
  const ofertaServidor = disponible && !viaje ? pendiente?.oferta ?? null : null;
  const vigente = ofertaServidor && !ignoradas.includes(ofertaServidor.ofertaId) ? ofertaServidor : null;
  // Si se perdió la carrera, el servidor ya no devuelve la oferta: se muestra la copia con el aviso.
  const oferta = carreraPerdida?.oferta ?? vigente;

  // Ubicación cada 10 s mientras está disponible (el límite es 60 por minuto).
  useEffect(() => {
    if (!disponible) return undefined;
    const enviar = () => api.enviarUbicacion(posicionChoferDemo).catch(() => {});
    enviar();
    const temporizador = setInterval(enviar, 10000);
    return () => clearInterval(temporizador);
  }, [disponible]);

  // Reloj de la cuenta regresiva.
  useEffect(() => {
    if (!oferta) return undefined;
    const temporizador = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(temporizador);
  }, [oferta]);

  const segundos = oferta ? Math.max(0, Math.ceil((new Date(oferta.venceAt).getTime() - ahora) / 1000)) : 0;
  const visible = Boolean(oferta) && (segundos > 0 || carreraPerdida);

  async function cambiarDisponibilidad() {
    setErrorDisponible(null);
    try {
      await api.cambiarDisponibilidad(!disponible);
      setDisponible(!disponible);
      setCobro(null);
    } catch (e) {
      setErrorDisponible(e.message);
    }
  }

  async function aceptar() {
    setAceptando(true);
    try {
      await conClave(claveAceptar, (clave) => api.aceptarOferta(oferta.ofertaId, clave));
      // Al aceptar, el backend deja al chofer no disponible hasta que termine el viaje.
      setDisponible(false);
      await recargarViaje();
    } catch (e) {
      const perdida = oferta;
      setCarreraPerdida({ oferta: perdida, texto: e.codigo === 'OFERTA_NO_DISPONIBLE' ? 'Otro chofer lo aceptó primero.' : e.message });
      setTimeout(() => {
        setCarreraPerdida(null);
        setIgnoradas((lista) => [...lista, perdida.ofertaId]);
      }, 2500);
    } finally {
      setAceptando(false);
    }
  }

  async function rechazar() {
    const rechazada = oferta;
    setRechazando(true);
    try {
      await conClave(claveRechazar, (clave) => api.rechazarOferta(rechazada.ofertaId, clave));
      // Se oculta ya: la consulta cada 2 s podría traerla una vez más antes de enterarse.
      setIgnoradas((lista) => [...lista, rechazada.ofertaId]);
    } catch (e) {
      if (e.codigo === 'OFERTA_NO_DISPONIBLE' || e.codigo === 'OFERTA_NO_ENCONTRADA') {
        // Venció o la tomó otro chofer mientras decidía: no hay nada que rechazar.
        setIgnoradas((lista) => [...lista, rechazada.ofertaId]);
      } else if (e.status !== 0) {
        setCarreraPerdida({ oferta: rechazada, texto: e.message });
        setTimeout(() => {
          setCarreraPerdida(null);
          setIgnoradas((lista) => [...lista, rechazada.ofertaId]);
        }, 2500);
      } else {
        // Sin conexión: la tarjeta sigue y el próximo "Rechazar" manda la misma clave.
        setErrorDisponible(e.message);
      }
    } finally {
      setRechazando(false);
    }
  }

  async function avanzar() {
    const paso = siguientePaso[viaje.estado];
    setAvanzando(true);
    setErrorViaje(null);
    try {
      if (paso.estado) {
        await api.avanzarEstado(viaje.id, paso.estado);
      } else {
        setCobro(await conClave(claveFinalizar, (clave) => api.finalizar(viaje.id, clave)));
      }
    } catch (e) {
      setErrorViaje(e.message);
    } finally {
      setAvanzando(false);
      recargarViaje();
    }
  }

  const urgente = segundos <= 5;

  return (
    <Mapa
      oferta conRuta={visible || Boolean(viaje)} posicion={posicionChoferDemo}
      origen={(visible ? oferta : viaje)?.origen} destino={(visible ? oferta : viaje)?.destino}
      tarjeta={visible ? 'arriba' : 'lateral'}
    >
      {visible && (
        <section
          role="alertdialog" aria-labelledby="oferta-titulo" aria-describedby="oferta-detalle"
          className="oferta montos" data-testid="oferta"
        >
          <div className="oferta__aviso">
            <span className="oferta__icono" aria-hidden="true" />
            <span className="oferta__app">Viajes Resistencia · ahora</span>
            <span className={urgente ? 'oferta__reloj oferta__reloj--urgente' : 'oferta__reloj'} data-testid="oferta-segundos">{segundos} s</span>
          </div>
          <div className="oferta__titulo">
            <h1 id="oferta-titulo">Nuevo viaje</h1>
            <span className="oferta__monto" data-testid="oferta-monto">{formatearPesos(oferta.estimacionCentavos)}</span>
          </div>
          <p id="oferta-detalle" className="oferta__recorrido">
            {nombreDe(oferta.origen)} → {nombreDe(oferta.destino)}
            <br />
            <span className="pedir__detalle">
              Retiro a {formatearDistancia(distanciaMetros(posicionChoferDemo, oferta.origen))}
              {' '}({minutos(distanciaMetros(posicionChoferDemo, oferta.origen))})
              {' '}· viaje de {formatearDistancia(distanciaMetros(oferta.origen, oferta.destino))}
              {' '}({minutos(distanciaMetros(oferta.origen, oferta.destino))})
            </span>
          </p>
          <div className="oferta__barra" aria-hidden="true">
            <div
              className={urgente ? 'oferta__progreso oferta__progreso--urgente' : 'oferta__progreso'}
              style={{ width: `${(segundos / duracionOferta) * 100}%` }}
            />
          </div>
          {carreraPerdida && (
            <p role="alert" className="aviso aviso--peligro" data-testid="oferta-carrera">{carreraPerdida.texto}</p>
          )}
          <div className="oferta__acciones">
            <button type="button" className="boton boton--secundario" disabled={Boolean(carreraPerdida) || aceptando || rechazando}
              onClick={rechazar} data-testid="oferta-rechazar">
              {rechazando ? 'Rechazando…' : 'Rechazar'}
            </button>
            <button type="button" className="boton boton--principal" disabled={Boolean(carreraPerdida) || aceptando || rechazando}
              onClick={aceptar} data-testid="oferta-aceptar">
              {aceptando ? 'Aceptando…' : 'Aceptar'}
            </button>
          </div>
        </section>
      )}

      {viaje && (
        <section className="tarjeta tarjeta--flotante pedir montos" aria-labelledby="titulo-viaje-chofer"
          data-testid="chofer-viaje" data-estado={viaje.estado}>
          <span className="chip chip--exito">{siguientePaso[viaje.estado].titulo}</span>
          <h1 id="titulo-viaje-chofer">{nombreDe(viaje.origen)} → {nombreDe(viaje.destino)}</h1>
          <div className="mi-viaje__precio">
            <span className="pedir__detalle">Tarifa estimada</span>
            <span>{formatearPesos(viaje.estimacionCentavos)}</span>
          </div>
          {errorViaje && <p role="alert" className="aviso aviso--peligro">{errorViaje}</p>}
          <button type="button" className="boton boton--principal boton--grande" onClick={avanzar} disabled={avanzando} data-testid="chofer-avanzar">
            {avanzando ? 'Enviando…' : siguientePaso[viaje.estado].boton}
          </button>
        </section>
      )}

      {!viaje && cobro && (
        <section className="tarjeta tarjeta--flotante pedir montos" data-testid="chofer-cobro" data-estado={cobro.estado}>
          {cobro.estado === 'finalizado' ? (
            <>
              <span className="chip chip--exito">Cobrado</span>
              <h1>Viaje terminado</h1>
              <p className="aviso">Se cobraron <strong>{formatearPesos(cobro.importeCentavos)}</strong> de la billetera del pasajero.</p>
            </>
          ) : (
            <>
              <span className="chip chip--advertencia">Pago pendiente</span>
              <h1>Viaje terminado</h1>
              <p className="aviso aviso--advertencia">
                El pasajero no tenía saldo para <strong>{formatearPesos(cobro.importeCentavos)}</strong>.
                {' '}No se cobró nada; el viaje queda pendiente de pago.
              </p>
            </>
          )}
          <p className="ayuda">Prendé "Disponible" para recibir otro viaje.</p>
        </section>
      )}

      {!viaje && (
        <div className="disponible">
          <span className="disponible__texto">
            <span className="disponible__estado">{disponible ? 'Disponible' : 'No disponible'}</span>
            <span className="disponible__detalle">
              {errorDisponible ?? (!disponible ? 'no recibís viajes' : oferta ? 'te ofrecieron un viaje' : 'esperando viajes')}
            </span>
          </span>
          <button
            type="button" role="switch" aria-checked={disponible} aria-label="Disponible para recibir viajes"
            className="interruptor" onClick={cambiarDisponibilidad} data-testid="chofer-disponible"
          >
            <span />
          </button>
        </div>
      )}
    </Mapa>
  );
}
