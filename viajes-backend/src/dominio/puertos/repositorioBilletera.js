// Contrato del dominio. Los adaptadores PostgreSQL y en memoria lo implementarán.
export const repositorioBilletera = Object.freeze({
  buscarMovimientosPorPasajero: 'buscarMovimientosPorPasajero',
  registrarMovimiento: 'registrarMovimiento',
  ejecutarEnTransaccion: 'ejecutarEnTransaccion',
});

