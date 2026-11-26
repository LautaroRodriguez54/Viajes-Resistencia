import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/cliente.js';
import { inicioPorRol, usarSesion } from '../sesion.jsx';

// POST /auth/register: devuelve la sesión, así que se entra directo.
// El cuerpo es .strict(): "Nombre" no se pide hasta que exista la columna en usuarios.
export default function Registro() {
  const navegar = useNavigate();
  const { ingresar } = usarSesion();
  const [rol, setRol] = useState('pasajero');
  const [campos, setCampos] = useState({ email: '', password: '', marca: '', modelo: '', patente: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (nombre) => (e) => setCampos({ ...campos, [nombre]: e.target.value });

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const datos = { email: campos.email.trim(), password: campos.password, rol };
    if (rol === 'chofer') {
      datos.vehiculo = { marca: campos.marca.trim(), modelo: campos.modelo.trim(), patente: campos.patente.trim() };
    }
    try {
      const sesion = await api.registrar(datos);
      ingresar(sesion);
      navegar(inicioPorRol[sesion.usuario.rol]);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <span className="marca marca--grande">Viajes Resistencia</span>
      <form className="tarjeta formulario" onSubmit={enviar} data-testid="form-registro">
        <h1>Crear cuenta</h1>

        <fieldset className="campo grupo-rol">
          <legend className="etiqueta">Soy</legend>
          <div className="selector">
            <input type="radio" id="rol-pasajero" name="rol" value="pasajero" data-testid="registro-rol-pasajero"
              checked={rol === 'pasajero'} onChange={() => setRol('pasajero')} />
            <label htmlFor="rol-pasajero">Pasajero</label>
            <input type="radio" id="rol-chofer" name="rol" value="chofer" data-testid="registro-rol-chofer"
              checked={rol === 'chofer'} onChange={() => setRol('chofer')} />
            <label htmlFor="rol-chofer">Chofer</label>
          </div>
        </fieldset>

        <div className="campo">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required maxLength={254}
            data-testid="registro-email" value={campos.email} onChange={cambiar('email')} />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input id="password" className="input" type="password" autoComplete="new-password"
            required minLength={12} maxLength={128} aria-describedby="ayuda-password"
            data-testid="registro-password" value={campos.password} onChange={cambiar('password')} />
          <p id="ayuda-password" className="ayuda">Al menos 12 caracteres.</p>
        </div>

        {rol === 'chofer' && (
          <div className="grupo-vehiculo">
            <span className="etiqueta">Tu vehículo</span>
            <div className="fila">
              <div className="campo">
                <label htmlFor="marca">Marca</label>
                <input id="marca" className="input" required maxLength={60} placeholder="Fiat"
                  data-testid="registro-marca" value={campos.marca} onChange={cambiar('marca')} />
              </div>
              <div className="campo">
                <label htmlFor="modelo">Modelo</label>
                <input id="modelo" className="input" required maxLength={60} placeholder="Cronos"
                  data-testid="registro-modelo" value={campos.modelo} onChange={cambiar('modelo')} />
              </div>
            </div>
            <div className="campo">
              <label htmlFor="patente">Patente</label>
              <input id="patente" className="input" required minLength={4} maxLength={16} placeholder="AE 123 CD"
                data-testid="registro-patente" value={campos.patente} onChange={cambiar('patente')} />
              <p className="ayuda">Un administrador tiene que habilitarte antes de recibir viajes.</p>
            </div>
          </div>
        )}

        {error && <p role="alert" className="aviso aviso--peligro" data-testid="registro-error">{error}</p>}
        <button type="submit" className="boton boton--principal" style={{ marginTop: 8 }} disabled={enviando} data-testid="registro-enviar">
          {enviando ? 'Creando…' : 'Crear cuenta'}
        </button>
        <p className="acceso__pie">¿Ya tenés cuenta? <Link to="/ingresar">Ingresá</Link></p>
      </form>
    </div>
  );
}
