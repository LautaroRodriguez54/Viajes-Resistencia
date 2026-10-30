import { ErrorDeDominio } from '../errores.js';

export function calcularDistanciaKilometros(origen, destino) {
  const radioTierraKm = 6371;
  const aRad = (valor) => valor * Math.PI / 180;
  const deltaLat = aRad(destino.latitud - origen.latitud);
  const deltaLon = aRad(destino.longitud - origen.longitud);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(aRad(origen.latitud)) * Math.cos(aRad(destino.latitud)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radioTierraKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimarTarifa(origen, destino, parametros) {
  const kilometros = calcularDistanciaKilometros(origen, destino);
  const minutos = Math.max(1, Math.ceil((kilometros / parametros.velocidadPromedioKmh) * 60));
  const importeCentavos = parametros.baseCentavos
    + Math.ceil(kilometros) * parametros.porKilometroCentavos
    + minutos * parametros.porMinutoCentavos;
  if (importeCentavos > parametros.maximoViajeCentavos) {
    throw new ErrorDeDominio('VIAJE_SUPERA_MAXIMO', 'La estimación supera el máximo permitido.');
  }
  return { importeCentavos, kilometros: Number(kilometros.toFixed(2)), minutos };
}

