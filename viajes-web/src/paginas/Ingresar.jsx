import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { api } from '../api/cliente.js';
import { inicioPorRol, usarSesion } from '../sesion.jsx';

// Pantalla 1 del diseño: POST /auth/login → guardar la sesión → pantalla del rol.
export default function Ingresar() {
  const navegar = useNavigate();
  const { usuario, vencida, ingresar } = usarSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={inicioPorRol[usuario.rol]} replace />;

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const sesion = await api.ingresar(email.trim(), password);
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
      <form className="tarjeta formulario" onSubmit={enviar} data-testid="form-ingresar">
        <h1>Ingresar</h1>
        {vencida && !error && (
          <p role="status" className="aviso aviso--advertencia">Tu sesión venció. Ingresá de nuevo.</p>
        )}
        <div className="campo">
          <label htmlFor="email">Email</label>
          <input
            id="email" className="input" type="email" autoComplete="email" required
            placeholder="pasajero@demo.local" data-testid="ingresar-email"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password" className="input" type="password" autoComplete="current-password" required
            data-testid="ingresar-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p role="alert" className="aviso aviso--peligro" data-testid="ingresar-error">{error}</p>}
        <button type="submit" className="boton boton--principal" style={{ marginTop: 8 }} disabled={enviando} data-testid="ingresar-enviar">
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="acceso__pie">
          ¿No tenés cuenta?<br />
          <Link to="/registro">Registrate como pasajero o chofer</Link>
        </p>
      </form>
    </div>
  );
}
