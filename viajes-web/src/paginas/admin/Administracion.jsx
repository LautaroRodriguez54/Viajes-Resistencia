import { useState } from 'react';
import { choferesPorHabilitarEjemplo, tarifaEjemplo } from '../../datos/ejemplo.js';
import { formatearImporte } from '../../formato.js';

// Pantalla 7 del diseño: choferes por habilitar y tarifa. Sólo visual:
// "Habilitar" saca al chofer de la lista y "Guardar" no hace nada.
const camposTarifa = [
  { clave: 'baseCentavos', etiqueta: 'Base ($)' },
  { clave: 'porKilometroCentavos', etiqueta: 'Por km ($)' },
  { clave: 'porMinutoCentavos', etiqueta: 'Por minuto ($)' },
  { clave: 'maximoViajeCentavos', etiqueta: 'Máximo ($)' },
];

export default function Administracion() {
  const [choferes, setChoferes] = useState(choferesPorHabilitarEjemplo);

  function habilitar(id) {
    setChoferes(choferes.filter((chofer) => chofer.id !== id));
  }

  return (
    <div className="columna columna--ancha montos">
      <section className="tarjeta lista" aria-labelledby="titulo-choferes">
        <h1 id="titulo-choferes">Choferes por habilitar</h1>
        {choferes.length === 0 ? (
          <p className="pedir__detalle">No hay choferes esperando.</p>
        ) : (
          <ul>
            {choferes.map((chofer) => (
              <li key={chofer.id}>
                <span className="lista__texto">
                  <span>{chofer.vehiculo} · {chofer.patente}</span>
                  <span className="lista__detalle">{chofer.email}</span>
                </span>
                <button type="button" className="boton boton--exito" onClick={() => habilitar(chofer.id)}>
                  Habilitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="tarjeta formulario admin__tarifa" aria-labelledby="titulo-tarifa" onSubmit={(e) => e.preventDefault()}>
        <h2 id="titulo-tarifa">Tarifa</h2>
        <div className="fila">
          {camposTarifa.map((campo) => (
            <div key={campo.clave} className="campo">
              <label htmlFor={campo.clave}>{campo.etiqueta}</label>
              <input
                id={campo.clave} className="input" inputMode="decimal" required
                defaultValue={formatearImporte(tarifaEjemplo[campo.clave])}
              />
            </div>
          ))}
        </div>
        <button type="submit" className="boton boton--principal" style={{ minHeight: 48 }}>Guardar tarifa nueva</button>
      </form>
    </div>
  );
}
