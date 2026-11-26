// Mismo contrato que unidadDeTrabajoCobroPostgres, sin base:
// - "BEGIN": cada adaptador anota en `tx` los candados que toma y los cambios que quiere escribir;
// - "COMMIT": si el trabajo termina bien, se aplican todos los cambios juntos;
// - "ROLLBACK": si lanza, los cambios anotados se descartan y no queda nada escrito;
// - los candados se sueltan siempre al final, como los FOR UPDATE de Postgres.
// Como se escribe antes de soltar los candados, el que estaba esperando ya ve los cambios.
export function crearUnidadDeTrabajoCobroEnMemoria({ viajes, billetera }) {
  return {
    async ejecutar(trabajo) {
      const candados = [];
      const cambios = [];
      const tx = {
        retener: (soltar) => candados.push(soltar),
        alConfirmar: (cambio) => cambios.push(cambio),
      };
      try {
        const resultado = await trabajo({ viajes: viajes.enTransaccion(tx), billetera: billetera.enTransaccion(tx) });
        for (const cambio of cambios) cambio();
        return resultado;
      } finally {
        for (const soltar of candados.reverse()) soltar();
      }
    },
  };
}
