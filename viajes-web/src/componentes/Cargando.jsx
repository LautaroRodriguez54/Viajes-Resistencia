// Placeholders grises animados mientras llega la primera respuesta: el lugar ya tiene la forma de lo que
// va a aparecer, y la pantalla no "salta" cuando carga. Con prefers-reduced-motion no se animan.
export function FilasCargando({ filas = 3 }) {
  return (
    <ul className="cargando" aria-label="Cargando" aria-busy="true">
      {Array.from({ length: filas }, (_, i) => (
        <li key={i}>
          <span className="esqueleto esqueleto--icono" />
          <span className="cargando__texto">
            <span className="esqueleto esqueleto--linea" />
            <span className="esqueleto esqueleto--linea esqueleto--corta" />
          </span>
          <span className="esqueleto esqueleto--monto-chico" />
        </li>
      ))}
    </ul>
  );
}
