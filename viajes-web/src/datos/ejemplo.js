// Datos fijos de las pantallas que el backend todavía no puede alimentar (operador y admin).
// Tienen la forma que van a devolver los endpoints; al conectar, cada uno se reemplaza por la llamada.

// Viajes activos que ve el operador
export const viajesActivosEjemplo = [
  { id: 'a1', recorrido: 'Costanera → Centro', estado: 'solicitado', detalle: 'Buscando chofer hace 1 min 40 s', patente: null, importeCentavos: null },
  { id: 'a2', recorrido: 'Plaza 25 de Mayo → Terminal', estado: 'chofer_en_camino', detalle: 'hace 3 min', patente: 'AE 123 KD', importeCentavos: null },
  { id: 'a3', recorrido: 'UTN → Av. Sarmiento', estado: 'en_curso', detalle: 'hace 11 min', patente: 'AC 552 PL', importeCentavos: null },
  { id: 'a4', recorrido: 'Shopping → Villa Prosperidad', estado: 'pago_pendiente', detalle: 'sin pagar', patente: 'AF 090 RT', importeCentavos: 9200 },
];

// Choferes registrados que esperan la habilitación del admin
export const choferesPorHabilitarEjemplo = [
  { id: 'c1', email: 'chofer.nuevo@demo.local', vehiculo: 'Toyota Etios', patente: 'AG 410 JS' },
  { id: 'c2', email: 'otro.chofer@demo.local', vehiculo: 'Renault Logan', patente: 'AD 877 MN' },
];

// Tarifa vigente que edita el admin
export const tarifaEjemplo = {
  baseCentavos: 500,
  porKilometroCentavos: 250,
  porMinutoCentavos: 100,
  maximoViajeCentavos: 100000,
};
