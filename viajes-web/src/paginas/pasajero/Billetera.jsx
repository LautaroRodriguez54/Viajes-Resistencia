import { billeteraEjemplo, historialEjemplo, movimientosEjemplo } from '../../datos/ejemplo.js';
import { formatearPesos } from '../../formato.js';

// Pantalla 4 del diseño. Al conectar: GET /billetera/me (saldo),
// GET /viajes (historial, proyección del tema 13), GET /billetera/me/movimientos
// y la carga demo con Idempotency-Key.
const textoEstado = {
  finalizado: 'pagado',
  pago_pendiente: 'sin pagar',
  sin_choferes_disponibles: 'sin choferes',
  cancelado_pasajero: 'cancelado',
  cancelado_chofer: 'cancelado por el chofer',
};

export default function Billetera() {
  const sinPagar = historialEjemplo.find((viaje) => viaje.estado === 'pago_pendiente');

  return (
    <div className="columna montos">
      <section className="tarjeta billetera__saldo">
        <span className="pedir__detalle">Tu saldo</span>
        <span className="billetera__monto">{formatearPesos(billeteraEjemplo.saldoCentavos)}</span>
        <button type="button" className="boton boton--principal" style={{ minHeight: 48 }}>Cargar $ 100</button>
        {sinPagar && (
          <p role="alert" className="aviso aviso--advertencia">
            Tenés un viaje sin pagar de <strong>{formatearPesos(sinPagar.importeCentavos)}</strong>.
            {' '}No se cobró nada: cuando cargues saldo lo cobramos completo.
          </p>
        )}
      </section>

      <section className="tarjeta lista" aria-labelledby="titulo-viajes">
        <h2 id="titulo-viajes">Mis viajes</h2>
        <ul>
          {historialEjemplo.map((viaje) => (
            <li key={viaje.id}>
              <span className="lista__texto">
                <span>{viaje.recorrido}</span>
                <span className="lista__detalle">
                  {viaje.fecha} ·{' '}
                  <span className={viaje.estado === 'pago_pendiente' ? 'texto-advertencia' : undefined}>
                    {textoEstado[viaje.estado]}
                  </span>
                </span>
              </span>
              {viaje.importeCentavos === null
                ? <span className="pedir__detalle">—</span>
                : <span>{formatearPesos(viaje.importeCentavos)}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="tarjeta lista lista--compacta" aria-labelledby="titulo-movimientos">
        <h2 id="titulo-movimientos">Movimientos</h2>
        <ul>
          {movimientosEjemplo.map((movimiento) => (
            <li key={movimiento.id}>
              <span>{movimiento.descripcion}</span>
              {movimiento.tipo === 'carga'
                ? <span className="texto-exito">+ {formatearPesos(movimiento.importeCentavos)}</span>
                : <span>− {formatearPesos(movimiento.importeCentavos)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
