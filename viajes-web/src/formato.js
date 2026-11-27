// El backend maneja dinero en centavos enteros; acá sólo se formatea para mostrar.
export function formatearPesos(centavos) {
  return `$ ${formatearImporte(centavos)}`;
}

// Para importes que ya vienen redondeados a pesos (el precio aproximado): "$ 7.840" en vez de "$ 7.840,00".
export function formatearPesosEnteros(centavos) {
  return `$ ${Math.round(centavos / 100).toLocaleString('es-AR')}`;
}

// Sin el signo, para los campos editables (tarifa del admin): 100000 → "1.000,00".
export function formatearImporte(centavos) {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0');
  return `${pesos.toLocaleString('es-AR')},${resto}`;
}

// Lo contrario, para guardar: "1.000,50" → 100050. Se hace con texto y no con parseFloat, porque
// en punto flotante 0,1 + 0,2 no da 0,3 (la misma razón por la que el backend usa centavos enteros).
// Acepta "1000", "1000,5", "1.000,50" y "1000.50". Devuelve null si no es un importe válido.
export function parsearImporte(texto) {
  let limpio = String(texto).replace(/[\s$]/g, '');
  if (limpio.includes(',')) limpio = limpio.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) limpio = limpio.replace(/\./g, '');
  const partes = /^(\d+)(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!partes) return null;
  const centavos = Number(partes[1]) * 100 + Number((partes[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
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
