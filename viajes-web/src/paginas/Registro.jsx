import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

// Destino del link de la pantalla 1. Los campos siguen el esquema de
// POST /auth/register (password de 12 a 128, vehículo sólo para chofer).
// "Nombre" todavía no existe en el backend (migración pendiente).
export default function Registro() {
  const navegar = useNavigate();
  const [rol, setRol] = useState('pasajero');

  function enviar(evento) {
    evento.preventDefault();
    navegar('/ingresar');
  }

  return (
    <div className="acceso">
      <span className="marca marca--grande">Viajes Resistencia</span>
      <form className="tarjeta formulario" onSubmit={enviar}>
        <h1>Crear cuenta</h1>

        <fieldset className="campo grupo-rol">
          <legend className="etiqueta">Soy</legend>
          <div className="selector">
            <input type="radio" id="rol-pasajero" name="rol" value="pasajero"
              checked={rol === 'pasajero'} onChange={() => setRol('pasajero')} />
            <label htmlFor="rol-pasajero">Pasajero</label>
            <input type="radio" id="rol-chofer" name="rol" value="chofer"
              checked={rol === 'chofer'} onChange={() => setRol('chofer')} />
            <label htmlFor="rol-chofer">Chofer</label>
          </div>
        </fieldset>

        <div className="campo">
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" className="input" autoComplete="name" required maxLength={80} />
        </div>
        <div className="campo">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required maxLength={254} />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input id="password" className="input" type="password" autoComplete="new-password"
            required minLength={12} maxLength={128} aria-describedby="ayuda-password" />
          <p id="ayuda-password" className="ayuda">Al menos 12 caracteres.</p>
        </div>

        {rol === 'chofer' && (
          <div className="grupo-vehiculo">
            <span className="etiqueta">Tu vehículo</span>
            <div className="fila">
              <div className="campo">
                <label htmlFor="marca">Marca</label>
                <input id="marca" className="input" required maxLength={60} placeholder="Fiat" />
              </div>
              <div className="campo">
                <label htmlFor="modelo">Modelo</label>
                <input id="modelo" className="input" required maxLength={60} placeholder="Cronos" />
              </div>
            </div>
            <div className="campo">
              <label htmlFor="patente">Patente</label>
              <input id="patente" className="input" required minLength={4} maxLength={16} placeholder="AE 123 CD" />
              <p className="ayuda">Un administrador tiene que habilitarte antes de recibir viajes.</p>
            </div>
          </div>
        )}

        <button type="submit" className="boton boton--principal" style={{ marginTop: 8 }}>Crear cuenta</button>
        <p className="acceso__pie">¿Ya tenés cuenta? <Link to="/ingresar">Ingresá</Link></p>
      </form>
    </div>
  );
}
