import { formatearPesos } from '../formato.js';
import { nombreDelPunto } from '../datos/lugares.js';

// Comprobante de un viaje terminado (también suma al RF-8.4 del TP integrador). Lo usan Mi viaje, la
// billetera (al tocar un viaje) y el chofer al finalizar. "Imprimir" usa el diálogo del navegador, que
// también permite guardarlo como PDF: con @media print sólo se imprime el comprobante.
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : null);
const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function Comprobante({ viaje, pagado = true, para = 'pasajero', imprimible = true }) {
  const importe = viaje.tarifaFinalCentavos ?? viaje.estimacionCentavos;
  const inicio = hora(viaje.iniciadoAt);
  const fin = hora(viaje.finalizadoAt);
  const minutos = viaje.iniciadoAt && viaje.finalizadoAt
    ? Math.max(1, Math.round((new Date(viaje.finalizadoAt) - new Date(viaje.iniciadoAt)) / 60000))
    : null;
  const id = viaje.viajeId ?? viaje.id;
  return (
    <article className="comprobante" aria-label="Comprobante del viaje" data-testid="comprobante">
      <header className="comprobante__encabezado">
        <span className="marca">Viajes Resistencia</span>
        <span className={pagado ? 'chip chip--exito' : 'chip chip--advertencia'}>
          {pagado ? (para === 'chofer' ? 'Cobrado' : 'Pagado') : 'Pago pendiente'}
        </span>
      </header>
      <ol className="comprobante__recorrido">
        <li><span className="comprobante__punto comprobante__punto--origen" aria-hidden="true" />{nombreDelPunto(viaje.origen)}</li>
        <li><span className="comprobante__punto comprobante__punto--destino" aria-hidden="true" />{nombreDelPunto(viaje.destino)}</li>
      </ol>
      <dl className="comprobante__datos">
        <div><dt>Fecha</dt><dd>{fecha(viaje.solicitadoAt)}</dd></div>
        {inicio && fin && <div><dt>Horario</dt><dd>{inicio} a {fin}{minutos ? ` (${minutos} min)` : ''}</dd></div>}
        <div><dt>Medio de pago</dt><dd>Billetera</dd></div>
        <div><dt>Viaje</dt><dd className="comprobante__id">{id.slice(0, 8).toUpperCase()}</dd></div>
      </dl>
      <div className="comprobante__total">
        <span>{pagado ? 'Total' : 'A pagar'}</span>
        <strong data-testid="comprobante-total">{formatearPesos(importe)}</strong>
      </div>
      {!pagado && <p className="ayuda">No se cobró nada: el cobro nunca es parcial. Se paga completo cuando haya saldo.</p>}
      {imprimible && (
        <button type="button" className="boton boton--secundario comprobante__imprimir" onClick={() => globalThis.print?.()}>
          Imprimir o guardar en PDF
        </button>
      )}
    </article>
  );
}
