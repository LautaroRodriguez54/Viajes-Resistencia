import { useState } from 'react';
import { api } from '../../api/cliente.js';
import { nombreDelPunto } from '../../datos/lugares.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearFecha, formatearPesos } from '../../formato.js';

// Pantalla 4 del diseño. Cada 5 s consulta:
// - GET /billetera/me (saldo, desde la proyección): así se ve la carga del webhook sin recargar;
// - GET /viajes?limite=50 (historial, desde la proyección historial_viajes): "Mis viajes" y la deuda.
//   En "Mis viajes" sólo van los viajes que se hicieron de punta a punta (finalizado o
//   pago_pendiente): los cancelados o sin chofer no movieron plata y no son de la billetera;
//   se siguen viendo en Mi viaje mientras están activos;
// - GET /billetera/me/movimientos (desde la base billetera, sin atraso): "Movimientos".
// Si hay un viaje en pago_pendiente, "Pagar ahora" llama a POST /viajes/:viajeId/reintentar-cobro
// con Idempotency-Key.
const estados = {
  finalizado: { texto: 'pagado' },
  pago_pendiente: { texto: 'sin pagar', clase: 'texto-advertencia' },
};

const recorrido = (viaje) => `${nombreDelPunto(viaje.origen)} → ${nombreDelPunto(viaje.destino)}`;
// Viajes completos: lo cobrado o lo que se debe. Son los únicos con monto.
const completo = (viaje) => viaje.estado === 'finalizado' || viaje.estado === 'pago_pendiente';
const historialCompleto = () => api.historial(50);

export default function Billetera() {
  const { dato: billetera, error: errorSaldo, recargar: recargarSaldo } = usarConsultaPeriodica(api.saldo, 5000);
  const { dato: viajes, error: errorViajes, recargar: recargarViajes } = usarConsultaPeriodica(historialCompleto, 5000);
  const { dato: movimientos, error: errorMovimientos, recargar: recargarMovimientos } = usarConsultaPeriodica(api.movimientos, 5000);
  const [pagando, setPagando] = useState(false);
  const [resultado, setResultado] = useState(null);
  // El historial puede tardar unos cientos de ms en enterarse del pago: mientras tanto, se oculta la deuda pagada.
  const [pagados, setPagados] = useState(() => new Set());
  const clavePago = usarClaveIdempotente();

  const deudas = (viajes ?? []).filter((v) => v.estado === 'pago_pendiente' && !pagados.has(v.viajeId));
  const deuda = deudas[0];
  const porId = new Map((viajes ?? []).map((v) => [v.viajeId, v]));
  const completos = viajes?.filter(completo);

  async function pagar() {
    setPagando(true);
    setResultado(null);
    try {
      const cobro = await conClave(clavePago, (clave) => api.reintentarCobro(deuda.viajeId, clave));
      setResultado({ tipo: 'exito', texto: `Listo: se cobraron ${formatearPesos(cobro.importeCentavos)}.` });
      setPagados((previos) => new Set(previos).add(deuda.viajeId));
    } catch (e) {
      setResultado({ tipo: 'error', texto: e.message });
    } finally {
      setPagando(false);
      recargarSaldo();
      recargarViajes();
      recargarMovimientos();
    }
  }

  return (
    <div className="columna montos">
      <section className="tarjeta billetera__saldo">
        <span className="pedir__detalle">Tu saldo</span>
        <span className="billetera__monto" data-testid="billetera-saldo">
          {billetera ? formatearPesos(billetera.saldoCentavos) : '…'}
        </span>
        {errorSaldo && <p role="alert" className="aviso aviso--peligro">{errorSaldo.message}</p>}
        <p className="ayuda">
          La carga la acredita el proveedor de pagos con un webhook firmado. En la demo:
          {' '}<code>npm run cargar-saldo -- &lt;email&gt; &lt;centavos&gt;</code> en el backend.
        </p>

        {deuda && (
          <>
            <p role="alert" className="aviso aviso--advertencia" data-testid="billetera-deuda">
              {deudas.length > 1 ? `Tenés ${deudas.length} viajes sin pagar. El más reciente es` : 'Tenés un viaje sin pagar de'}
              {' '}<strong>{formatearPesos(deuda.tarifaFinalCentavos)}</strong> ({recorrido(deuda)}).
              {' '}No se cobró nada: cuando tengas saldo lo cobramos completo.
            </p>
            <button type="button" className="boton boton--principal" style={{ minHeight: 48 }}
              onClick={pagar} disabled={pagando} data-testid="billetera-pagar">
              {pagando ? 'Cobrando…' : 'Pagar ahora'}
            </button>
          </>
        )}
        {resultado && (
          <p role="alert" data-testid="billetera-resultado"
            className={resultado.tipo === 'exito' ? 'aviso texto-exito' : 'aviso aviso--peligro'}>
            {resultado.texto}
          </p>
        )}
      </section>

      <section className="tarjeta lista" aria-labelledby="titulo-viajes" data-testid="billetera-viajes">
        <h2 id="titulo-viajes">Mis viajes</h2>
        {errorViajes && <p role="alert" className="aviso aviso--peligro">{errorViajes.message}</p>}
        {completos?.length === 0 && <p className="pedir__detalle">Todavía no completaste ningún viaje.</p>}
        {completos?.length > 0 && (
          <ul>
            {completos.map((viaje) => {
              const estado = estados[viaje.estado];
              const pagado = pagados.has(viaje.viajeId) && viaje.estado === 'pago_pendiente';
              return (
                <li key={viaje.viajeId} data-testid="billetera-viaje" data-estado={viaje.estado}>
                  <span className="lista__texto">
                    <span>{recorrido(viaje)}</span>
                    <span className="lista__detalle">
                      {formatearFecha(viaje.solicitadoAt)} ·{' '}
                      <span className={pagado ? undefined : estado.clase}>{pagado ? 'pagado' : estado.texto}</span>
                    </span>
                  </span>
                  <span>{formatearPesos(viaje.tarifaFinalCentavos ?? viaje.estimacionCentavos)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="tarjeta lista lista--compacta" aria-labelledby="titulo-movimientos" data-testid="billetera-movimientos">
        <h2 id="titulo-movimientos">Movimientos</h2>
        {errorMovimientos && <p role="alert" className="aviso aviso--peligro">{errorMovimientos.message}</p>}
        {movimientos?.length === 0 && <p className="pedir__detalle">Todavía no hay cargas ni consumos.</p>}
        {movimientos?.length > 0 && (
          <ul>
            {movimientos.map((m) => {
              const viaje = m.viajeId && porId.get(m.viajeId);
              const texto = m.tipo === 'carga' ? 'Carga' : viaje ? `Viaje a ${nombreDelPunto(viaje.destino)}` : 'Viaje';
              return (
                <li key={m.id} data-testid="billetera-movimiento" data-tipo={m.tipo}>
                  <span className="lista__texto">
                    <span>{texto}</span>
                    <span className="lista__detalle">{formatearFecha(m.creadoAt)}</span>
                  </span>
                  {m.tipo === 'carga'
                    ? <span className="texto-exito">+ {formatearPesos(m.importeCentavos)}</span>
                    : <span>− {formatearPesos(m.importeCentavos)}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
