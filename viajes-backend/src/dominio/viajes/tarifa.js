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

// La línea recta subestima el recorrido: el auto va por calles. Resistencia es una cuadrícula y en una
// cuadrícula el camino es, en promedio, ~1,27 veces la línea recta (4/π); con semáforos y desvíos se usa 1,3.
// Así la estimación queda cerca del recorrido real sin depender de un servicio de rutas externo (OSRM es
// sólo visual en la web). El radio de búsqueda de choferes sigue en línea recta.
export const FACTOR_RECORRIDO_URBANO = 1.3;

export function estimarTarifa(origen, destino, parametros) {
  const kilometros = calcularDistanciaKilometros(origen, destino) * FACTOR_RECORRIDO_URBANO;
  const minutos = Math.max(1, Math.ceil((kilometros / parametros.velocidadPromedioKmh) * 60));
  // Los kilómetros se cobran con decimales (antes se redondeaban para arriba: 1,1 km costaba como 2).
  // El total se redondea a pesos enteros, como lo muestran las apps de viajes: sigue en centavos enteros
  // (múltiplo de 100), así que la regla de "nunca float para el dinero" no cambia.
  const subtotal = parametros.baseCentavos
    + kilometros * parametros.porKilometroCentavos
    + minutos * parametros.porMinutoCentavos;
  const importeCentavos = Math.round(subtotal / 100) * 100;
  if (importeCentavos > parametros.maximoViajeCentavos) {
    throw new ErrorDeDominio('VIAJE_SUPERA_MAXIMO', 'La estimación supera el máximo permitido.');
  }
  return { importeCentavos, kilometros: Number(kilometros.toFixed(2)), minutos };
}

