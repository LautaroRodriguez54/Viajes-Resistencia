import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

// Pantalla 1 del diseño. Al conectar: POST /auth/login → guardar el token →
// GET /auth/me → ir a la pantalla del rol.
export default function Ingresar() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function enviar(evento) {
    evento.preventDefault();
    navegar('/pasajero/pedir');
  }

  return (
    <div className="acceso">
      <span className="marca marca--grande">Viajes Resistencia</span>
      <form className="tarjeta formulario" onSubmit={enviar}>
        <h1>Ingresar</h1>
        <div className="campo">
          <label htmlFor="email">Email</label>
          <input
            id="email" className="input" type="email" autoComplete="email" required
            placeholder="pasajero@demo.local"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="boton boton--principal" style={{ marginTop: 8 }}>Entrar</button>
        <p className="acceso__pie">
          ¿No tenés cuenta? <Link to="/registro">Registrate como pasajero o chofer</Link>
        </p>
      </form>
    </div>
  );
}
