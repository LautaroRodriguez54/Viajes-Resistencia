import { useState } from 'react';
import { api } from '../../api/cliente.js';
import { nombreDelPunto } from '../../datos/lugares.js';
import { formatearFecha, formatearPesos } from '../../formato.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';

// Pantalla 6 del diseño: viajes activos del operador (#26).
// - GET /operador/viajes?estado=activos cada 5 s (sin SSE, como el resto de la web: ADR 011).
// - Al tocar un viaje se despliega su acción: cancelar con motivo obligatorio (solicitado, asignado,
//   en camino o en viaje) o reintentar el cobro (pago_pendiente, que el operador no puede cancelar).
// - Las dos acciones mandan Idempotency-Key: un doble toque no cancela ni cobra dos veces.
const chips = {
  solicitado: { texto: 'Pedido', clase: 'chip--acento' },
  asignado: { texto: 'Asignado', clase: 'chip--exito' },
  chofer_en_camino: { texto: 'En camino', clase: 'chip--exito' },
  en_curso: { texto: 'En viaje', clase: 'chip--neutro' },
  pago_pendiente: { texto: 'Pago pendiente', clase: 'chip--advertencia' },
};

// El backend pide entre 3 y 200 caracteres; la lista fija evita texto libre en la demo.
const motivos = ['Sin choferes en la zona', 'Pedido del pasajero', 'Problema con el vehículo', 'Otro'];

function detalle(viaje) {
  const cuando = `pedido ${formatearFecha(viaje.solicitadoAt).toLowerCase()}`;
  if (viaje.estado === 'pago_pendiente') {
    return `${viaje.patente ?? 'Sin patente'} · ${formatearPesos(viaje.tarifaFinalCentavos ?? viaje.estimacionCentavos)} sin pagar`;
  }
  return viaje.patente ? `${viaje.patente} · ${cuando}` : `Buscando chofer · ${cuando}`;
}

export default function ViajesActivos() {
  const { dato: viajes, error, recargar } = usarConsultaPeriodica(api.viajesActivos, 5000);
  const [seleccionado, setSeleccionado] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { tipo: 'exito' | 'error', texto }
  const claveCancelar = usarClaveIdempotente();
  const claveCobro = usarClaveIdempotente();

  function seleccionar(id) {
    setSeleccionado(seleccionado === id ? null : id);
    setMotivo('');
    setResultado(null);
  }

  async function ejecutar(accion, textoExito) {
    setEnviando(true);
    setResultado(null);
    try {
      await accion();
      setResultado({ tipo: 'exito', texto: textoExito });
      setSeleccionado(null);
      setMotivo('');
    } catch (e) {
      setResultado({ tipo: 'error', texto: e.message });
    } finally {
      setEnviando(false);
      recargar();
    }
  }

  function cancelar(evento) {
    evento.preventDefault();
    const id = seleccionado;
    ejecutar(() => conClave(claveCancelar, (clave) => api.cancelarComoOperador(id, motivo, clave)), 'Viaje cancelado. Si tenía chofer, quedó libre.');
  }

  function reintentarCobro(id) {
    ejecutar(async () => {
      try {
        await conClave(claveCobro, (clave) => api.reintentarCobroOperador(id, clave));
      } catch (e) {
        // El mensaje general ("cargá saldo") le habla al pasajero; acá lo lee el operador.
        if (e.codigo === 'SALDO_INSUFICIENTE') throw new Error('El saldo del pasajero sigue sin alcanzar. No se cobró nada.');
        throw e;
      }
    }, 'Cobro hecho: el viaje quedó finalizado.');
  }

  return (
    <div className="columna columna--ancha montos">
      {resultado && (
        <p role="status" className={resultado.tipo === 'exito' ? 'aviso aviso--exito' : 'aviso aviso--peligro'} data-testid="operador-resultado">
          {resultado.texto}
        </p>
      )}
      {error && <p role="alert" className="aviso aviso--peligro">{error.message} Reintentamos solos cada 5 s.</p>}
      <section className="tarjeta lista" aria-labelledby="titulo-activos" data-testid="operador-viajes">
        <h1 id="titulo-activos">Viajes activos {viajes && <span className="lista__cantidad">· {viajes.length}</span>}</h1>
        {!viajes && !error && <p className="pedir__detalle">Cargando…</p>}
        {viajes?.length === 0 && <p className="pedir__detalle">No hay viajes activos.</p>}
        {viajes?.length > 0 && (
          <ul>
            {viajes.map((viaje) => {
              const chip = chips[viaje.estado] ?? { texto: viaje.estado, clase: 'chip--neutro' };
              const abierto = viaje.id === seleccionado;
              return (
                <li key={viaje.id} className="operador__viaje" data-testid="operador-viaje" data-estado={viaje.estado}>
                  <button
                    type="button" className="operador__fila" aria-expanded={abierto}
                    onClick={() => seleccionar(viaje.id)}
                  >
                    <span className="lista__texto">
                      <span>{nombreDelPunto(viaje.origen)} → {nombreDelPunto(viaje.destino)}</span>
                      <span className="lista__detalle">{detalle(viaje)}</span>
                    </span>
                    <span className={`chip ${chip.clase}`}>{chip.texto}</span>
                  </button>
                  {abierto && viaje.estado === 'pago_pendiente' && (
                    <div className="operador__cancelar">
                      <span className="pedir__detalle">El pasajero no tenía saldo. Si ya cargó, se cobra completo; si no, no se cobra nada.</span>
                      <button type="button" className="boton boton--principal" disabled={enviando} onClick={() => reintentarCobro(viaje.id)} data-testid="operador-reintentar">
                        {enviando ? 'Cobrando…' : 'Reintentar cobro'}
                      </button>
                    </div>
                  )}
                  {abierto && viaje.estado !== 'pago_pendiente' && (
                    <form className="operador__cancelar" onSubmit={cancelar}>
                      <label htmlFor={`motivo-${viaje.id}`} className="etiqueta">Motivo</label>
                      <select
                        id={`motivo-${viaje.id}`} className="input operador__motivo" required
                        value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="operador-motivo"
                      >
                        <option value="" disabled>Elegí un motivo</option>
                        {motivos.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <button type="submit" className="boton boton--peligro-lleno" disabled={enviando || !motivo} data-testid="operador-cancelar">
                        {enviando ? 'Cancelando…' : 'Cancelar viaje'}
                      </button>
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
