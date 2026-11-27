// Datos fijos de la pantalla que el backend todavía no puede alimentar (admin: no hay listado de
// choferes por habilitar ni endpoint de tarifas). El operador ya usa los endpoints reales (#26).
// Tienen la forma que van a devolver los endpoints; al conectar, cada uno se reemplaza por la llamada.

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
