import { useEffect, useState } from 'react';
import { api } from '../../api/cliente.js';
import { FilasCargando } from '../../componentes/Cargando.jsx';
import PanelMetricas from './PanelMetricas.jsx';
import { conClave, usarClaveIdempotente, usarConsultaPeriodica } from '../../ganchos.js';
import { formatearFecha, formatearImporte, formatearPesos, parsearImporte } from '../../formato.js';

// Pantalla 7 del diseño, conectada:
// - Choferes por habilitar: GET /admin/choferes cada 10 s (los pendientes, los más viejos primero).
//   "Habilitar" hace PATCH /admin/choferes/:id/habilitacion y el chofer sale de la lista.
// - Tarifa: GET /admin/tarifa. "Guardar tarifa nueva" hace POST /admin/tarifa con Idempotency-Key:
//   el backend no edita la vigente, la desactiva y crea otra activa (los viajes ya pedidos conservan
//   su estimación). Los importes se convierten a centavos enteros antes de mandarlos.
const camposTarifa = [
  { clave: 'baseCentavos', etiqueta: 'Base ($)' },
  { clave: 'porKilometroCentavos', etiqueta: 'Por km ($)' },
  { clave: 'porMinutoCentavos', etiqueta: 'Por minuto ($)' },
  { clave: 'maximoViajeCentavos', etiqueta: 'Máximo por viaje ($)' },
];

function aFormulario(tarifa) {
  return Object.fromEntries(camposTarifa.map(({ clave }) => [clave, formatearImporte(tarifa[clave])]));
}

export default function Administracion() {
  const { dato: choferes, error: errorChoferes, cargando, recargar } = usarConsultaPeriodica(api.choferesAdmin, 10000);
  const [habilitando, setHabilitando] = useState(null);
  const [habilitados, setHabilitados] = useState([]);
  const [errorHabilitar, setErrorHabilitar] = useState(null);

  const [tarifa, setTarifa] = useState(null);
  const [formulario, setFormulario] = useState(null);
  const [errorTarifa, setErrorTarifa] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const claveTarifa = usarClaveIdempotente();

  useEffect(() => {
    api.tarifaActiva()
      .then((t) => { setTarifa(t); setFormulario(aFormulario(t)); })
      .catch((e) => setErrorTarifa(e.message));
  }, []);

  async function habilitar(chofer) {
    setHabilitando(chofer.choferId);
    setErrorHabilitar(null);
    try {
      await api.habilitarChofer(chofer.choferId, true);
      setHabilitados((lista) => [...lista, chofer]);
      await recargar();
    } catch (e) {
      setErrorHabilitar(e.message);
    } finally {
      setHabilitando(null);
    }
  }

  async function guardar(evento) {
    evento.preventDefault();
    setGuardada(false);
    setErrorTarifa(null);
    const centavos = Object.fromEntries(camposTarifa.map(({ clave }) => [clave, parsearImporte(formulario[clave])]));
    const invalido = camposTarifa.find(({ clave }) => centavos[clave] === null);
    if (invalido) {
      setErrorTarifa(`"${invalido.etiqueta}" no es un importe válido (por ejemplo, 1.500,00).`);
      return;
    }
    if (centavos.maximoViajeCentavos < centavos.baseCentavos) {
      setErrorTarifa('El máximo por viaje no puede ser menor que la base.');
      return;
    }
    setGuardando(true);
    try {
      const nueva = await conClave(claveTarifa, (clave) => api.guardarTarifa(centavos, clave));
      setTarifa(nueva);
      setFormulario(aFormulario(nueva));
      setGuardada(true);
    } catch (e) {
      setErrorTarifa(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const pendientes = choferes ?? [];
  const cambio = tarifa && formulario && camposTarifa.some(({ clave }) => parsearImporte(formulario[clave]) !== tarifa[clave]);

  return (
    <div className="columna columna--ancha montos">
      <PanelMetricas />
      <section className="tarjeta lista" aria-labelledby="titulo-choferes" data-testid="admin-choferes">
        <h1 id="titulo-choferes">Choferes por habilitar</h1>
        {errorChoferes && <p role="alert" className="aviso aviso--peligro">{errorChoferes.message}</p>}
        {errorHabilitar && <p role="alert" className="aviso aviso--peligro">{errorHabilitar}</p>}
        {cargando && !choferes ? (
          <FilasCargando filas={2} />
        ) : pendientes.length === 0 ? (
          <div className="vacio">
            <span className="vacio__icono vacio__icono--choferes" aria-hidden="true" />
            <p className="pedir__detalle">No hay choferes esperando. Los que se registran desde la web aparecen acá.</p>
          </div>
        ) : (
          <ul>
            {pendientes.map((chofer) => (
              <li key={chofer.choferId} data-testid="admin-chofer">
                <span className="lista__texto">
                  <span>{chofer.vehiculo.marca} {chofer.vehiculo.modelo} · {chofer.vehiculo.patente}</span>
                  <span className="lista__detalle">{chofer.email} · se registró {formatearFecha(chofer.registradoAt).toLowerCase()}</span>
                </span>
                <button
                  type="button" className="boton boton--exito" disabled={habilitando !== null}
                  onClick={() => habilitar(chofer)} data-testid="admin-habilitar"
                >
                  {habilitando === chofer.choferId ? 'Habilitando…' : 'Habilitar'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {habilitados.length > 0 && (
          <p role="status" className="aviso aviso--exito">
            Habilitado{habilitados.length > 1 ? 's' : ''}: {habilitados.map((c) => c.email).join(', ')}. Ya pueden prender "Disponible".
          </p>
        )}
      </section>

      <form className="tarjeta formulario admin__tarifa" aria-labelledby="titulo-tarifa" onSubmit={guardar} data-testid="admin-tarifa">
        <h2 id="titulo-tarifa">Tarifa</h2>
        {tarifa && (
          <p className="pedir__detalle">
            Vigente desde {formatearFecha(tarifa.vigenteDesde).toLowerCase()}. Un viaje cuesta {formatearPesos(tarifa.baseCentavos)} de base más
            {' '}{formatearPesos(tarifa.porKilometroCentavos)} por km y {formatearPesos(tarifa.porMinutoCentavos)} por minuto,
            {' '}con un tope de {formatearPesos(tarifa.maximoViajeCentavos)}.
          </p>
        )}
        {formulario ? (
          <div className="fila">
            {camposTarifa.map((campo) => (
              <div key={campo.clave} className="campo">
                <label htmlFor={campo.clave}>{campo.etiqueta}</label>
                <input
                  id={campo.clave} className="input" inputMode="decimal" required
                  value={formulario[campo.clave]}
                  onChange={(e) => { setGuardada(false); setFormulario({ ...formulario, [campo.clave]: e.target.value }); }}
                  data-testid={`admin-${campo.clave}`}
                />
              </div>
            ))}
          </div>
        ) : (
          !errorTarifa && <p className="pedir__detalle">Cargando…</p>
        )}
        {errorTarifa && <p role="alert" className="aviso aviso--peligro">{errorTarifa}</p>}
        {guardada && <p role="status" className="aviso aviso--exito">Tarifa nueva activa. Los viajes que se pidan desde ahora usan estos valores.</p>}
        <p className="ayuda">Guardar no modifica la tarifa vigente: crea una nueva y la anterior queda en el historial.</p>
        <button type="submit" className="boton boton--principal" style={{ minHeight: 48 }} disabled={!cambio || guardando} data-testid="admin-guardar">
          {guardando ? 'Guardando…' : 'Guardar tarifa nueva'}
        </button>
      </form>
    </div>
  );
}
