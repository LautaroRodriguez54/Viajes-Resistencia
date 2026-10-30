import { estimarTarifa } from '../../dominio/viajes/tarifa.js';

export function crearSolicitarViaje({ viajes }) {
  return async function solicitarViaje({ pasajeroId, origen, destino }) {
    const parametros = await viajes.obtenerParametrosTarifaActivos();
    const estimacion = estimarTarifa(origen, destino, parametros);
    return viajes.crearSolicitud({ pasajeroId, origen, destino, estimacion });
  };
}

