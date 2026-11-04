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
