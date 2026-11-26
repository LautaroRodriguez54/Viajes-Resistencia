// El backend maneja dinero en centavos enteros; acá sólo se formatea para mostrar.
export function formatearPesos(centavos) {
  return `$ ${formatearImporte(centavos)}`;
}

// Sin el signo, para los campos editables (tarifa del admin): 100000 → "1.000,00".
export function formatearImporte(centavos) {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0');
  return `${pesos.toLocaleString('es-AR')},${resto}`;
}

// "Hoy 16:40", "Ayer 21:15" o "24/11 09:05", como en el diseño de la billetera.
export function formatearFecha(iso, ahora = new Date()) {
  const fecha = new Date(iso);
  const hora = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(ahora) - dia(fecha)) / 86_400_000);
  if (dias === 0) return `Hoy ${hora}`;
  if (dias === 1) return `Ayer ${hora}`;
  return `${fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

export function formatearDistancia(metros) {
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
}

export function formatearDuracion(segundos) {
  return `unos ${Math.max(1, Math.round(segundos / 60))} min`;
}
