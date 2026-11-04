import { Link, NavLink } from 'react-router';

const etiquetasRol = {
  pasajero: 'Pasajero',
  chofer: 'Chofer',
  operador: 'Operador',
  administrador: 'Admin',
};

// enlaces: [{ a: '/pasajero/pedir', texto: 'Pedir' }, ...]
export default function Encabezado({ rol, enlaces = [], plano = false }) {
  return (
    <header className={plano ? 'encabezado encabezado--plano' : 'encabezado'}>
      <Link to="/" className="marca">Viajes Resistencia</Link>
      {enlaces.length > 0 && (
        <nav aria-label={etiquetasRol[rol]}>
          {enlaces.map((enlace) => (
            <NavLink key={enlace.a} to={enlace.a}>{enlace.texto}</NavLink>
          ))}
        </nav>
      )}
      <span className="encabezado__usuario">
        {etiquetasRol[rol]} · <Link to="/ingresar">Salir</Link>
      </span>
    </header>
  );
}
