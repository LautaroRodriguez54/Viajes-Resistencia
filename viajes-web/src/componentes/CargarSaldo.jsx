import { useState } from 'react';
import { api } from '../api/cliente.js';
import { conClave, usarClaveIdempotente } from '../ganchos.js';
import { formatearPesos, parsearImporte } from '../formato.js';

// Carga de saldo desde la billetera, con la pasarela de pagos simulada del backend (sólo demo).
// Dos pasos, como con un proveedor real:
// 1. POST /billetera/me/cargas: el pasajero elige el importe y queda una carga pendiente (no mueve plata);
// 2. "checkout" de la pasarela → POST /billetera/me/cargas/:id/pagar: el servidor manda el webhook
//    firmado de siempre y recién ahí se acredita. El secreto del webhook nunca llega al navegador.
// Cada paso lleva su Idempotency-Key: si se corta la conexión, el reintento no carga dos veces.
const MONTOS_RAPIDOS = [500_000, 1_000_000, 2_000_000, 5_000_000]; // $ 5.000, 10.000, 20.000, 50.000
const MINIMO = 10_000;
const MAXIMO = 50_000_000;

export default function CargarSaldo({ alCargar }) {
  const [paso, setPaso] = useState('cerrado'); // cerrado | eligiendo | checkout | listo
  const [importe, setImporte] = useState(MONTOS_RAPIDOS[1]);
  const [otro, setOtro] = useState('');
  const [carga, setCarga] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const claveCrear = usarClaveIdempotente();
  const clavePagar = usarClaveIdempotente();

  const importeOtro = otro.trim() ? parsearImporte(otro) : null;
  const elegido = otro.trim() ? importeOtro : importe;
  const valido = Number.isSafeInteger(elegido) && elegido >= MINIMO && elegido <= MAXIMO;

  function cerrar() {
    setPaso('cerrado');
    setCarga(null);
    setError(null);
    setOtro('');
  }

  async function continuar(evento) {
    evento.preventDefault();
    if (!valido) return;
    setOcupado(true);
    setError(null);
    try {
      const { carga: nueva } = await conClave(claveCrear, (clave) => api.iniciarCarga(elegido, clave));
      setCarga(nueva);
      setPaso('checkout');
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function pagar() {
    setOcupado(true);
    setError(null);
    try {
      await conClave(clavePagar, (clave) => api.pagarCarga(carga.id, clave));
      setPaso('listo');
      alCargar?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (paso === 'cerrado') {
    return (
      <button type="button" className="boton boton--secundario" onClick={() => setPaso('eligiendo')} data-testid="carga-abrir">
        + Cargar saldo
      </button>
    );
  }

  if (paso === 'listo') {
    return (
      <div className="carga" data-testid="carga-lista">
        <p role="status" className="aviso aviso--exito">
          Listo: se acreditaron <strong>{formatearPesos(carga.importeCentavos)}</strong> en tu billetera.
        </p>
        <button type="button" className="boton boton--secundario" onClick={cerrar}>Cerrar</button>
      </div>
    );
  }

  if (paso === 'checkout') {
    return (
      <div className="carga carga--checkout" data-testid="carga-checkout">
        <div className="carga__pasarela">
          <span className="chip chip--neutro">Pasarela de pagos simulada · demo</span>
          <span className="pedir__detalle">Vas a pagar</span>
          <span className="carga__monto">{formatearPesos(carga.importeCentavos)}</span>
          <div className="carga__tarjeta" aria-label="Tarjeta de prueba">
            <span>Tarjeta de prueba</span>
            <span>•••• 4242</span>
          </div>
          <p className="ayuda">No se usa ninguna tarjeta real. Al pagar, la pasarela avisa a la billetera con un webhook firmado.</p>
        </div>
        {error && <p role="alert" className="aviso aviso--peligro">{error}</p>}
        <button type="button" className="boton boton--principal" onClick={pagar} disabled={ocupado} data-testid="carga-pagar">
          {ocupado ? 'Procesando el pago…' : `Pagar ${formatearPesos(carga.importeCentavos)}`}
        </button>
        <button type="button" className="boton boton--secundario" onClick={cerrar} disabled={ocupado}>Cancelar</button>
      </div>
    );
  }

  return (
    <form className="carga" onSubmit={continuar} data-testid="carga-elegir">
      <span className="etiqueta" id="carga-titulo">¿Cuánto querés cargar?</span>
      <div className="carga__montos" role="group" aria-labelledby="carga-titulo">
        {MONTOS_RAPIDOS.map((monto) => (
          <button
            key={monto} type="button"
            className={`boton boton--secundario${!otro.trim() && importe === monto ? ' carga__monto-elegido' : ''}`}
            aria-pressed={!otro.trim() && importe === monto}
            onClick={() => { setImporte(monto); setOtro(''); }}
          >
            {formatearPesos(monto).replace(',00', '')}
          </button>
        ))}
      </div>
      <div className="campo">
        <label htmlFor="carga-otro">Otro importe</label>
        <input
          id="carga-otro" className="input" inputMode="decimal" placeholder="Por ejemplo, 15.000"
          value={otro} onChange={(e) => setOtro(e.target.value)} data-testid="carga-otro"
        />
        <span className="ayuda">De $ 100 a $ 500.000.</span>
      </div>
      {otro.trim() && !valido && <p role="alert" className="aviso aviso--advertencia">Ingresá un importe de $ 100 a $ 500.000.</p>}
      {error && <p role="alert" className="aviso aviso--peligro">{error}</p>}
      <button type="submit" className="boton boton--principal" disabled={!valido || ocupado} data-testid="carga-continuar">
        {ocupado ? 'Preparando…' : valido ? `Continuar con ${formatearPesos(elegido)}` : 'Continuar'}
      </button>
      <button type="button" className="boton boton--secundario" onClick={cerrar} disabled={ocupado}>Cancelar</button>
    </form>
  );
}
