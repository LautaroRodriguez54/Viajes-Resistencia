import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Mapa from '../../componentes/Mapa.jsx';
import Comprobante from '../../componentes/Comprobante.jsx';
import { api } from '../../api/cliente.js';
import { distanciaMetros, nombreDe, posicionChoferDemo } from '../../datos/lugares.js';
import { buscarRuta } from '../../mapas/rutas.js';
import { largoDeRuta, puntoEnRuta } from '../../mapas/recorrido.js';
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
// - Cancelar: POST /choferes/viajes/:id/cancelar con Idempotency-Key, sólo mientras el viaje
//   está asignado o en camino (regla de dominio, decidirCancelacion). Pide confirmación en la
//   tarjeta y un motivo opcional. Después el chofer queda no disponible hasta prender el interruptor.
const duracionOferta = 30;

const cancelablesPorChofer = new Set(['asignado', 'chofer_en_camino']);

// Movimiento simulado del chofer de la demo: con "Voy en camino" avanza por la ruta de OSRM hasta el
// retiro y, con el pasajero a bordo, hasta el destino. Cada paso se manda a PUT /choferes/me/ubicacion
// (40 por minuto; el límite es 60) y el pasajero lo ve moverse en Mi viaje. Es una demo: cada tramo dura
// unos 20 s sin importar la distancia (14 pasos cada 1,5 s), para no esperar minutos a que llegue.
const PASOS_POR_TRAMO = 14;
const INTERVALO_PASO_MS = 1500;
// Aviso sonoro de oferta nueva: dos tonos cortos con Web Audio (sin archivos). El navegador sólo deja sonar
// después de un toque del usuario, por eso el contexto se crea al tocar "Disponible".
function sonarAviso(contexto) {
  if (!contexto || contexto.state !== 'running') return;
  [0, 0.18].forEach((desfase, i) => {
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();
    oscilador.frequency.value = i === 0 ? 880 : 1175;
    volumen.gain.setValueAtTime(0.0001, contexto.currentTime + desfase);
    volumen.gain.exponentialRampToValueAtTime(0.25, contexto.currentTime + desfase + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + desfase + 0.15);
    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start(contexto.currentTime + desfase);
    oscilador.stop(contexto.currentTime + desfase + 0.16);
  });
}

const tramoDe = (viaje) => (viaje?.estado === 'chofer_en_camino' ? 'retiro' : viaje?.estado === 'en_curso' ? 'destino' : null);
const motivosChofer = ['El pasajero no se presentó', 'Problema con el vehículo', 'No llego al punto de retiro'];

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
  const claveCancelar = usarClaveIdempotente();
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [cancelado, setCancelado] = useState(false);

  const { dato: actual, recargar: recargarViaje } = usarConsultaPeriodica(api.viajeActualChofer);
  const viaje = actual?.viaje ?? null;
  const { dato: pendiente } = usarConsultaPeriodica(disponible && !viaje ? api.ofertaPendiente : null);
  const ofertaServidor = disponible && !viaje ? pendiente?.oferta ?? null : null;
  const vigente = ofertaServidor && !ignoradas.includes(ofertaServidor.ofertaId) ? ofertaServidor : null;
  // Si se perdió la carrera, el servidor ya no devuelve la oferta: se muestra la copia con el aviso.
  const oferta = carreraPerdida?.oferta ?? vigente;

  // Dónde está el chofer: arranca junto a la plaza y se mueve durante el viaje. Termina donde dejó al
  // pasajero (como un chofer real), que sigue dentro del radio de 5 km de la demo.
  const [posicion, setPosicion] = useState(posicionChoferDemo);
  const posicionRef = useRef(posicionChoferDemo);
  const [inicioTramo, setInicioTramo] = useState(null);
  const viajeRef = useRef(null);
  viajeRef.current = viaje;
  const tramo = tramoDe(viaje);

  // Ubicación cada 10 s mientras está disponible o tiene un viaje quieto (asignado): así el pasajero
  // ve dónde está antes de que arranque. Mientras se mueve, la manda el efecto de abajo en cada paso.
  const quieto = disponible || viaje?.estado === 'asignado';
  useEffect(() => {
    if (!quieto) return undefined;
    const enviar = () => api.enviarUbicacion(posicionRef.current).catch(() => {});
    enviar();
    const temporizador = setInterval(enviar, 10000);
    return () => clearInterval(temporizador);
  }, [quieto]);

  // Avanza por la ruta del tramo actual. Depende del id y del tramo (no del objeto, que cambia cada 2 s).
  const viajeId = viaje?.id;
  useEffect(() => {
    if (!tramo) return undefined;
    const actual = viajeRef.current;
    const desde = tramo === 'retiro' ? posicionRef.current : actual.origen;
    const hasta = tramo === 'retiro' ? actual.origen : actual.destino;
    setInicioTramo(tramo === 'retiro' ? desde : null);
    let cancelado = false;
    let temporizador;
    (async () => {
      // Sin OSRM (sin red), en línea recta: es sólo la animación, no se dibuja como ruta.
      const ruta = (await buscarRuta(desde, hasta)) ?? [[desde.latitud, desde.longitud], [hasta.latitud, hasta.longitud]];
      const total = largoDeRuta(ruta);
      let recorrido = 0;
      const paso = () => {
        if (cancelado) return;
        recorrido = Math.min(total, recorrido + Math.max(30, total / PASOS_POR_TRAMO));
        const punto = puntoEnRuta(ruta, recorrido);
        posicionRef.current = punto;
        setPosicion(punto);
        api.enviarUbicacion(punto).catch(() => {});
        if (recorrido < total) temporizador = setTimeout(paso, INTERVALO_PASO_MS);
      };
      if (!cancelado) temporizador = setTimeout(paso, INTERVALO_PASO_MS);
    })();
    return () => { cancelado = true; clearTimeout(temporizador); };
  }, [viajeId, tramo]);

  // Al terminar o cancelar el viaje deja de dibujarse el tramo al retiro.
  useEffect(() => {
    if (!viajeId) setInicioTramo(null);
  }, [viajeId]);

  // Reloj de la cuenta regresiva. Sólo corre mientras hay oferta, así que al llegar una nueva `ahora`
  // tiene la hora de la oferta anterior (o de cuando se abrió la página). Si se dibujara con esa hora,
  // la cuenta daría mucho más de 30 s y la barra saldría más ancha que la pantalla antes de acomodarse.
  // useLayoutEffect lo pone en hora antes de que el navegador pinte la oferta nueva.
  // Depende del id (no del objeto), porque la consulta cada 2 s trae un objeto nuevo de la misma oferta.
  const ofertaId = oferta?.ofertaId;
  useLayoutEffect(() => {
    if (!ofertaId) return undefined;
    setAhora(Date.now());
    const temporizador = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(temporizador);
  }, [ofertaId]);

  const segundos = oferta ? Math.max(0, Math.ceil((new Date(oferta.venceAt).getTime() - ahora) / 1000)) : 0;
  const visible = Boolean(oferta) && (segundos > 0 || carreraPerdida);

  // Oferta nueva: suena, vibra (en el celular) y el título de la pestaña parpadea con el monto mientras
  // sigue vigente, por si el chofer está mirando otra pestaña. Al irse la oferta vuelve el título.
  const audio = useRef(null);
  const nuevaId = vigente?.ofertaId;
  const nuevoMonto = vigente?.estimacionCentavos;
  useEffect(() => {
    if (!nuevaId) return undefined;
    sonarAviso(audio.current);
    globalThis.navigator?.vibrate?.([120, 80, 120]);
    const original = document.title;
    let alterna = false;
    const temporizador = setInterval(() => {
      alterna = !alterna;
      document.title = alterna ? `🚗 Nuevo viaje · ${formatearPesos(nuevoMonto)}` : original;
    }, 1000);
    return () => { clearInterval(temporizador); document.title = original; };
  }, [nuevaId, nuevoMonto]);

  async function cambiarDisponibilidad() {
    setErrorDisponible(null);
    // Este toque habilita el sonido del aviso de ofertas (los navegadores lo exigen).
    if (!audio.current && globalThis.AudioContext) audio.current = new AudioContext();
    audio.current?.resume?.().catch(() => {});
    try {
      await api.cambiarDisponibilidad(!disponible);
      setDisponible(!disponible);
      setCobro(null);
      setCancelado(false);
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
        // Se guarda una copia del viaje para el comprobante: después de finalizar ya no es el viaje actual.
        const terminado = { ...viaje, solicitadoAt: new Date().toISOString() };
        const respuesta = await conClave(claveFinalizar, (clave) => api.finalizar(viaje.id, clave));
        setCobro({ ...respuesta, viaje: terminado });
      }
    } catch (e) {
      setErrorViaje(e.message);
    } finally {
      setAvanzando(false);
      recargarViaje();
    }
  }

  // Sin el paso de confirmación, un toque de más cancelaría el viaje. Si el pasajero subió
  // justo antes (en_curso), el servidor responde TRANSICION_INVALIDA y se muestra el mensaje.
  async function cancelar() {
    setCancelando(true);
    setErrorViaje(null);
    try {
      await conClave(claveCancelar, (clave) => api.cancelarComoChofer(viaje.id, motivoCancelar, clave));
      setConfirmandoCancelar(false);
      setMotivoCancelar('');
      setCobro(null);
      setCancelado(true);
    } catch (e) {
      setErrorViaje(e.message);
    } finally {
      setCancelando(false);
      recargarViaje();
    }
  }

  const urgente = segundos <= 5;

  return (
    <Mapa
      oferta conRuta={visible || Boolean(viaje)}
      // Sin viaje: "Vos". Yendo al retiro: el punto de partida (fijo, para el tramo punteado) y el auto
      // que avanza. Con el pasajero a bordo: sólo el auto sobre la ruta del viaje.
      posicion={!viaje ? posicion : viaje.estado === 'en_curso' ? null : (inicioTramo ?? posicion)}
      auto={tramo ? posicion : null}
      consumir={tramo === 'destino' ? 'viaje' : tramo === 'retiro' ? 'retiro' : null}
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
              Retiro a {formatearDistancia(distanciaMetros(posicion, oferta.origen))}
              {' '}({minutos(distanciaMetros(posicion, oferta.origen))})
              {' '}· viaje de {formatearDistancia(distanciaMetros(oferta.origen, oferta.destino))}
              {' '}({minutos(distanciaMetros(oferta.origen, oferta.destino))})
            </span>
          </p>
          <div className="oferta__barra" aria-hidden="true">
            <div
              className={urgente ? 'oferta__progreso oferta__progreso--urgente' : 'oferta__progreso'}
              // Entre 0 y 100 %: si el reloj de la PC está atrasado respecto del servidor, la cuenta puede dar más de 30 s.
              style={{ width: `${Math.min(100, Math.max(0, (segundos / duracionOferta) * 100))}%` }}
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
          {confirmandoCancelar ? (
            <div className="confirmar" role="group" aria-label="Confirmar cancelación">
              <p className="pedir__detalle">¿Cancelar el viaje? Al pasajero no se le cobra nada.</p>
              <label htmlFor="motivo-chofer" className="etiqueta">Motivo (opcional)</label>
              <select
                id="motivo-chofer" className="input" value={motivoCancelar}
                onChange={(e) => setMotivoCancelar(e.target.value)} data-testid="chofer-cancelar-motivo"
              >
                <option value="">Sin motivo</option>
                {motivosChofer.map((m) => <option key={m}>{m}</option>)}
              </select>
              <div className="confirmar__acciones">
                <button type="button" className="boton boton--secundario" onClick={() => setConfirmandoCancelar(false)} disabled={cancelando}>
                  Volver
                </button>
                <button type="button" className="boton boton--peligro-lleno" onClick={cancelar} disabled={cancelando} data-testid="chofer-cancelar-confirmar">
                  {cancelando ? 'Cancelando…' : 'Sí, cancelar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="boton boton--principal boton--grande" onClick={avanzar} disabled={avanzando} data-testid="chofer-avanzar">
                {avanzando ? 'Enviando…' : siguientePaso[viaje.estado].boton}
              </button>
              {cancelablesPorChofer.has(viaje.estado) && (
                <button type="button" className="boton boton--secundario boton--peligro" disabled={avanzando}
                  onClick={() => { setErrorViaje(null); setConfirmandoCancelar(true); }} data-testid="chofer-cancelar">
                  Cancelar viaje
                </button>
              )}
            </>
          )}
        </section>
      )}

      {!viaje && cancelado && !cobro && (
        <section className="tarjeta tarjeta--flotante pedir" data-testid="chofer-cancelado">
          <span className="chip chip--peligro">Cancelado</span>
          <h1>Cancelaste el viaje</h1>
          <p className="aviso">Al pasajero no se le cobró nada.</p>
          <p className="ayuda">Prendé "Disponible" para recibir otro viaje.</p>
        </section>
      )}

      {!viaje && cobro && (
        <section className="tarjeta tarjeta--flotante pedir montos" data-testid="chofer-cobro" data-estado={cobro.estado}>
          {cobro.estado === 'finalizado' ? (
            <>
              <h1>Viaje terminado</h1>
              <p className="aviso">Se cobraron <strong>{formatearPesos(cobro.importeCentavos)}</strong> de la billetera del pasajero.</p>
              <Comprobante viaje={{ ...cobro.viaje, tarifaFinalCentavos: cobro.importeCentavos }} para="chofer" imprimible={false} />
            </>
          ) : (
            <>
              <h1>Viaje terminado</h1>
              <p className="aviso aviso--advertencia">
                El pasajero no tenía saldo para <strong>{formatearPesos(cobro.importeCentavos)}</strong>.
                {' '}No se cobró nada; el viaje queda pendiente de pago.
              </p>
              <Comprobante viaje={{ ...cobro.viaje, tarifaFinalCentavos: cobro.importeCentavos }} pagado={false} para="chofer" imprimible={false} />
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
