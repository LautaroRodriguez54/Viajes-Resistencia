import { useState } from 'react';
import { api } from '../../api/cliente.js';
import { guardarViajeActual, leerViajeActual } from '../../datos/viajeActual.js';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 4 del diseño. GET /billetera/me cada 5 s (así se ve la carga del webhook
// sin recargar) y, si el último viaje quedó en pago_pendiente, "Pagar ahora" con
// POST /viajes/:viajeId/reintentar-cobro e Idempotency-Key.
// Pendiente en el backend: GET /viajes (historial) y GET /billetera/me/movimientos
// salen de las proyecciones del tema 13 (rama 7).
export default function Billetera() {
  const { dato: billetera, error: errorSaldo, recargar: recargarSaldo } = usarConsultaPeriodica(api.saldo, 5000);
  const guardado = leerViajeActual();
  const { dato: viaje, recargar: recargarViaje } = usarConsultaPeriodica(guardado ? () => api.viaje(guardado.id) : null, 5000);
  const [pagando, setPagando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const clavePago = usarClaveIdempotente();

  // Al pagar se olvida el viaje guardado: la deuda desaparece aunque el último dato consultado sea viejo.
  const deuda = guardado && viaje?.estado === 'pago_pendiente' ? viaje : null;

  async function pagar() {
    setPagando(true);
    setResultado(null);
    try {
      const cobro = await conClave(clavePago, (clave) => api.reintentarCobro(deuda.id, clave));
      setResultado({ tipo: 'exito', texto: `Listo: se cobraron ${formatearPesos(cobro.importeCentavos)}.` });
      guardarViajeActual(null);
    } catch (e) {
      setResultado({ tipo: 'error', texto: e.message });
    } finally {
      setPagando(false);
      recargarSaldo();
      recargarViaje();
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
              Tenés un viaje sin pagar de <strong>{formatearPesos(deuda.tarifaFinalCentavos)}</strong>.
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

      <section className="tarjeta lista lista--compacta" aria-labelledby="titulo-historial">
        <h2 id="titulo-historial">Mis viajes y movimientos</h2>
        <p className="pedir__detalle">
          Todavía no están en el backend: salen de las proyecciones de lectura (CQRS) de la billetera.
        </p>
      </section>
    </div>
  );
}
