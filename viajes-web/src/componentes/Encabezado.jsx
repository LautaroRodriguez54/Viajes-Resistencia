import { Link, NavLink } from 'react-router';

const etiquetasRol = {
  pasajero: 'Pasajero',
  chofer: 'Chofer',
  operador: 'Operador',
  administrador: 'Admin',
};

// enlaces: [{ a: '/pasajero/pedir', texto: 'Pedir' }, ...]
// detalle: dato extra al lado del rol (la patente del chofer).
export default function Encabezado({ rol, enlaces = [], plano = false, detalle }) {
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
        {etiquetasRol[rol]} · {detalle && <>{detalle} · </>}<Link to="/ingresar">Salir</Link>
      </span>
    </header>
  );
}
