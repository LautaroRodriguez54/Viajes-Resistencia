import { estimarTarifa } from '../../dominio/viajes/tarifa.js';

// Estimación previa (6.5): el precio aproximado antes de pedir, sin crear el viaje. Usa la misma función
// y la misma tarifa activa que solicitarViaje, así que el aproximado coincide con lo que se cobra al pedir
// (mientras el admin no cambie la tarifa en el medio). No escribe nada: no lleva Idempotency-Key.
export function crearEstimarViaje({ viajes }) {
  return async function estimarViaje({ origen, destino }) {
    const parametros = await viajes.obtenerParametrosTarifaActivos();
    return estimarTarifa(origen, destino, parametros);
  };
}
