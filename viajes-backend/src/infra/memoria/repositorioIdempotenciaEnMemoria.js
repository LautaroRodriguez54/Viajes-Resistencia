import crypto from 'node:crypto';

// Mismo contrato que repositorioIdempotenciaPostgres, sin base. Sirve para los
// tests de HTTP y como adaptador en memoria del bloque 2. `ahora` permite
// simular el paso del tiempo para el vencimiento.
export function crearRepositorioIdempotenciaEnMemoria({ ahora = () => Date.now() } = {}) {
  const filas = new Map();
  const claveCompuesta = (actorId, ambito, clave) => JSON.stringify([actorId, ambito, clave]);

  return {
    filas,
    async reservar({ actorId, ambito, clave, requestSha256, ttlSegundos }) {
      const k = claveCompuesta(actorId, ambito, clave);
      const existente = filas.get(k);
      if (existente && existente.creadaEn <= ahora() - ttlSegundos * 1000) filas.delete(k);
      const vigente = filas.get(k);
      if (vigente) {
        return {
          nueva: false,
          id: vigente.id,
          requestSha256: vigente.requestSha256,
          estado: vigente.estado,
          respuestaStatus: vigente.respuestaStatus,
          respuestaCuerpo: structuredClone(vigente.respuestaCuerpo),
        };
      }
      const id = crypto.randomUUID();
      filas.set(k, { id, requestSha256, estado: 'procesando', creadaEn: ahora() });
      return { nueva: true, id };
    },
    async completar(id, { status, cuerpo }) {
      for (const fila of filas.values()) {
        if (fila.id === id && fila.estado === 'procesando') {
          Object.assign(fila, { estado: 'completada', respuestaStatus: status, respuestaCuerpo: structuredClone(cuerpo ?? null) });
        }
      }
    },
    async liberar(id) {
      for (const [k, fila] of filas) {
        if (fila.id === id && fila.estado === 'procesando') filas.delete(k);
      }
    },
  };
}
