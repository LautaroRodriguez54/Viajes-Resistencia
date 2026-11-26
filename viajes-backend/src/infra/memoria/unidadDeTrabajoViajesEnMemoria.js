// Mismo contrato que unidadDeTrabajoViajesPostgres, sin Postgres:
// - retiene candados en orden hasta confirmar o fallar;
// - aplica los cambios acumulados al confirmar;
// - descarta los cambios si el trabajo lanza un error.
export function crearUnidadDeTrabajoViajesEnMemoria({ viajes }) {
  return {
    async ejecutar(trabajo) {
      const candados = [];
      const cambios = [];
      const tx = {
        retener: (soltar) => candados.push(soltar),
        alConfirmar: (cambio) => cambios.push(cambio),
      };
      try {
        const resultado = await trabajo({ viajes: viajes.enTransaccionViajes(tx) });
        for (const cambio of cambios) cambio();
        return resultado;
      } finally {
        for (const soltar of candados.reverse()) soltar();
      }
    },
  };
}
