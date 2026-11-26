import { Link, NavLink, useNavigate } from 'react-router';
import { usarSesion } from '../sesion.jsx';

const etiquetasRol = {
  pasajero: 'Pasajero',
  chofer: 'Chofer',
  operador: 'Operador',
  administrador: 'Admin',
};

// enlaces: [{ a: '/pasajero/pedir', texto: 'Pedir' }, ...]
export default function Encabezado({ rol, enlaces = [], plano = false }) {
  const { usuario, salir } = usarSesion();
  const navegar = useNavigate();

  function cerrarSesion() {
    salir();
    navegar('/ingresar');
  }

  return (
    <header className={plano ? 'encabezado encabezado--plano' : 'encabezado'}>
      <Link to="/" className="marca">Viajes Resistencia</Link>
      {enlaces.length > 0 && (
        <nav aria-label={etiquetasRol[rol]}>
          {enlaces.map((enlace) => (
            <NavLink key={enlace.a} to={enlace.a} data-testid={`nav-${enlace.a.split('/').pop()}`}>{enlace.texto}</NavLink>
          ))}
        </nav>
      )}
      <span className="encabezado__usuario">
        <span data-testid="usuario-actual">{etiquetasRol[rol]} · {usuario?.email}</span> ·{' '}
        <button type="button" className="enlace" onClick={cerrarSesion} data-testid="salir">Salir</button>
      </span>
    </header>
  );
}
