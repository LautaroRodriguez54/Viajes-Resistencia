// El backend maneja dinero en centavos enteros; acá sólo se formatea para mostrar.
export function formatearPesos(centavos) {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0');
  return `$ ${pesos.toLocaleString('es-AR')},${resto}`;
}

export function formatearDistancia(metros) {
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
}

export function formatearDuracion(segundos) {
  return `unos ${Math.max(1, Math.round(segundos / 60))} min`;
}
