// Candado por clave para los adaptadores en memoria: hace el papel del SELECT ... FOR UPDATE.
// `tomar(clave)` espera a que se suelte el candado anterior de esa misma clave y devuelve la
// función que lo suelta. Los que esperan pasan de a uno y en orden de llegada.
// No es reentrante: la misma transacción no puede tomar dos veces la misma clave.
export function crearCandados() {
  const colas = new Map();
  return async function tomar(clave) {
    const anterior = colas.get(clave) ?? Promise.resolve();
    let soltar;
    const liberado = new Promise((resolver) => { soltar = resolver; });
    colas.set(clave, liberado);
    await anterior;
    return () => {
      soltar();
      if (colas.get(clave) === liberado) colas.delete(clave);
    };
  };
}
