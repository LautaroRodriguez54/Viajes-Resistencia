import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

// Pantalla 1 del diseño. Al conectar: POST /auth/login → guardar el token →
// GET /auth/me → ir a la pantalla del rol.
// Para ver cada pantalla, el rol sale del principio del email
// (chofer@, operador@, admin@); cualquier otro entra como pasajero.
const inicioPorRol = {
  chofer: '/chofer',
  operador: '/operador',
  admin: '/admin',
};

export default function Ingresar() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function enviar(evento) {
    evento.preventDefault();
    const prefijo = email.split(/[@.]/)[0].toLowerCase();
    navegar(inicioPorRol[prefijo] ?? '/pasajero/pedir');
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
          ¿No tenés cuenta?<br />
          <Link to="/registro">Registrate como pasajero o chofer</Link>
        </p>
      </form>
    </div>
  );
}
