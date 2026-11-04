// Datos fijos para diseñar sin backend. Tienen la forma que van a devolver
// los endpoints; al conectar, cada uno se reemplaza por la llamada indicada.

// GET /auth/me
export const usuarioEjemplo = {
  id: 'ejemplo-pasajero',
  email: 'pasajero@demo.local',
  rol: 'pasajero',
};

// GET /billetera/me
export const billeteraEjemplo = {
  saldoCentavos: 8500,
};

// POST /viajes/estimacion (FALTA en el backend)
export const estimacionEjemplo = {
  origen: { nombre: 'Plaza 25 de Mayo', latitud: -27.4514, longitud: -58.9867 },
  destino: { nombre: 'Terminal de Ómnibus', latitud: -27.4691, longitud: -58.9581 },
  distanciaMetros: 3400,
  duracionSegundos: 420,
  tarifaEstimadaCentavos: 2050,
};

// GET /viajes/:viajeId (FALTA devolver vehículo, patente y minutos hasta el retiro)
export const viajeActualEjemplo = {
  id: 'ejemplo-viaje-1',
  estado: 'chofer_en_camino',
  estimacionCentavos: 2050,
  minutosHastaRetiro: 3,
  chofer: { patente: 'AE 123 KD', vehiculo: 'Fiat Cronos gris' },
};

// GET /viajes (FALTA): historial del pasajero, sale de la proyección historial_viajes
export const historialEjemplo = [
  { id: 'v3', recorrido: 'Shopping → Villa Prosperidad', fecha: 'Hoy 16:40', estado: 'pago_pendiente', importeCentavos: 9200 },
  { id: 'v2', recorrido: 'Plaza 25 de Mayo → Terminal', fecha: 'Hoy 14:02', estado: 'finalizado', importeCentavos: 2050 },
  { id: 'v1', recorrido: 'Costanera → Centro', fecha: 'Ayer 21:15', estado: 'sin_choferes_disponibles', importeCentavos: null },
];

// GET /billetera/me/movimientos (FALTA): carga suma, consumo resta
export const movimientosEjemplo = [
  { id: 'm3', tipo: 'consumo', descripcion: 'Viaje a la Terminal', importeCentavos: 2050 },
  { id: 'm2', tipo: 'carga', descripcion: 'Carga', importeCentavos: 5000 },
  { id: 'm1', tipo: 'consumo', descripcion: 'Viaje a Av. Sarmiento', importeCentavos: 2475 },
];

// Chofer que ve la pantalla 5
export const choferEjemplo = {
  id: 'ejemplo-chofer',
  email: 'chofer@demo.local',
  rol: 'chofer',
  patente: 'AE 123 KD',
  disponible: true,
};

// Oferta de viaje que recibe el chofer (dura 30 s)
export const ofertaEjemplo = {
  id: 'ejemplo-oferta-1',
  viajeId: 'ejemplo-viaje-1',
  origen: { nombre: 'Plaza 25 de Mayo' },
  destino: { nombre: 'Terminal de Ómnibus' },
  tarifaEstimadaCentavos: 2050,
  distanciaRetiroMetros: 1200,
  duracionRetiroSegundos: 240,
  distanciaViajeMetros: 3400,
  duracionViajeSegundos: 420,
  segundosRestantes: 30,
};

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
