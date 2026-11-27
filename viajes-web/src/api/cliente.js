// Cliente HTTP único de la web. Hace tres cosas que ninguna pantalla repite:
// 1. agrega el JWT (header Authorization, nunca en la URL: RNF-19);
// 2. manda Idempotency-Key en las operaciones que crean o cobran (ADR 010);
// 3. traduce { error: { codigo } } a un mensaje visible. La pantalla decide por el
//    código, no por el texto.
// `?.`: fuera de Vite (el script de verificación en Node) no existe import.meta.env.
const BASE_API = import.meta.env?.VITE_API_URL ?? 'http://localhost:3000';
const CLAVE_SESION = 'viajes.sesion';

const mensajes = {
  ENTRADA_INVALIDA: 'Revisá los datos: hay algún campo con un formato inválido.',
  JSON_INVALIDO: 'El pedido salió mal formado. Probá de nuevo.',
  CREDENCIALES_INVALIDAS: 'Email o contraseña incorrectos.',
  TOKEN_REQUERIDO: 'Tenés que ingresar de nuevo.',
  TOKEN_INVALIDO: 'Tu sesión venció. Ingresá de nuevo.',
  RECURSO_PROHIBIDO: 'Tu usuario no puede hacer esta operación.',
  EMAIL_O_PATENTE_EXISTENTE: 'Ya hay una cuenta con ese email o esa patente.',
  ROL_NO_REGISTRABLE: 'Ese tipo de cuenta no se puede crear desde acá.',
  BILLETERA_NO_ENCONTRADA: 'No encontramos tu billetera.',
  RECURSO_NO_ENCONTRADO: 'El viaje no existe o ya no está disponible.',
  OFERTA_NO_ENCONTRADA: 'La oferta ya no existe.',
  SIN_CHOFERES_CERCANOS: 'No hay choferes disponibles cerca. Probá de nuevo en un rato.',
  OFERTA_NO_DISPONIBLE: 'Otro chofer lo aceptó primero, o la oferta venció.',
  CHOFER_NO_HABILITADO: 'Un administrador todavía no habilitó tu cuenta de chofer.',
  CHOFER_NO_DISPONIBLE: 'Tenés que estar disponible para aceptar viajes.',
  CHOFER_CON_VIAJE_ACTIVO: 'Ya tenés un viaje en curso.',
  SALDO_INSUFICIENTE: 'El saldo no alcanza. No se cobró nada: cargá saldo y volvé a intentar.',
  TRANSICION_INVALIDA: 'El viaje ya cambió de estado. Actualizamos la pantalla.',
  TARIFA_NO_CONFIGURADA: 'El servicio no tiene una tarifa configurada todavía.',
  VIAJE_SUPERA_MAXIMO: 'El viaje supera el importe máximo permitido.',
  PEDIDO_EN_CURSO: 'Ya estamos procesando este pedido. Esperá un momento.',
  CLAVE_IDEMPOTENCIA_REUTILIZADA: 'Ese pedido ya se usó con otros datos. Volvé a intentarlo.',
  LIMITE_DE_PETICIONES_EXCEDIDO: 'Demasiados intentos seguidos. Esperá un minuto.',
  SERVICIO_NO_DISPONIBLE: 'El servicio no está listo todavía. Reintentá en un momento.',
  SIN_CONEXION: 'No pudimos conectar con el servidor. Revisá la conexión y reintentá.',
  ERROR_INTERNO: 'Algo falló en el servidor. Reintentá en un momento.',
};

export class ErrorApi extends Error {
  constructor({ codigo, status, requestId }) {
    super(mensajes[codigo] ?? `Error inesperado (${codigo}).`);
    this.codigo = codigo;
    this.status = status;
    this.requestId = requestId;
  }
}

export function leerSesion() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_SESION));
  } catch {
    return null;
  }
}

export function guardarSesion(sesion) {
  if (sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  else sessionStorage.removeItem(CLAVE_SESION);
}

// Un UUID por intención del usuario (no por intento): ver usarClaveIdempotente.
export function nuevaClave() {
  return crypto.randomUUID();
}

// Avisos a la sesión (src/sesion.jsx) cuando el servidor rechaza el token.
export const eventosSesion = new EventTarget();

export async function pedir(metodo, ruta, { cuerpo, clave } = {}) {
  const sesion = leerSesion();
  const headers = { accept: 'application/json' };
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (sesion?.accessToken) headers.authorization = `Bearer ${sesion.accessToken}`;
  if (clave) headers['idempotency-key'] = clave;

  let respuesta;
  try {
    respuesta = await fetch(`${BASE_API}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    // Sin respuesta no sabemos si el servidor ejecutó la operación: por eso
    // el reintento tiene que mandar la misma Idempotency-Key.
    throw new ErrorApi({ codigo: 'SIN_CONEXION', status: 0 });
  }

  const datos = await respuesta.json().catch(() => null);
  if (respuesta.ok) return datos;

  const codigo = datos?.error?.codigo ?? (respuesta.status >= 500 ? 'ERROR_INTERNO' : `HTTP_${respuesta.status}`);
  if (respuesta.status === 401 && sesion) eventosSesion.dispatchEvent(new Event('vencida'));
  throw new ErrorApi({ codigo, status: respuesta.status, requestId: datos?.error?.requestId });
}

export const api = {
  ingresar: (email, password) => pedir('POST', '/auth/login', { cuerpo: { email, password } }),
  registrar: (datos) => pedir('POST', '/auth/register', { cuerpo: datos }),
  saldo: () => pedir('GET', '/billetera/me'),
  // Movimientos desde la base `billetera` (sin atraso) e historial desde la proyección (tema 13).
  movimientos: (limite = 20) => pedir('GET', `/billetera/me/movimientos?limite=${limite}`).then((r) => r.movimientos),
  historial: (limite = 20) => pedir('GET', `/viajes?limite=${limite}`).then((r) => r.viajes),
  // POST /viajes y GET /viajes/:id responden { viaje } (ver openapi.yaml): se desenvuelve acá.
  // Precio aproximado antes de pedir (no crea nada, sin Idempotency-Key). Responde { importeCentavos, kilometros, minutos }.
  estimarViaje: (origen, destino) => pedir('POST', '/viajes/estimacion', { cuerpo: { origen, destino } }).then((r) => r.estimacion),
  solicitarViaje: (origen, destino, clave) => pedir('POST', '/viajes', { cuerpo: { origen, destino }, clave }).then((r) => r.viaje),
  buscarChofer: (viajeId, clave) => pedir('POST', `/viajes/${viajeId}/ofertas`, { clave }),
  viaje: (viajeId) => pedir('GET', `/viajes/${viajeId}`).then((r) => r.viaje),
  reintentarCobro: (viajeId, clave) => pedir('POST', `/viajes/${viajeId}/reintentar-cobro`, { clave }),
  cambiarDisponibilidad: (disponible) => pedir('PUT', '/choferes/me/disponibilidad', { cuerpo: { disponible } }),
  enviarUbicacion: (punto) => pedir('PUT', '/choferes/me/ubicacion', { cuerpo: punto }),
  ofertaPendiente: () => pedir('GET', '/choferes/me/ofertas'),
  viajeActualChofer: () => pedir('GET', '/choferes/me/viaje-actual'),
  aceptarOferta: (ofertaId, clave) => pedir('POST', `/ofertas/${ofertaId}/aceptar`, { clave }),
  // Responde { viajeId, ofertaId, estado: 'rechazada', viajeEstado, reofrecida }: el backend
  // le ofrece el viaje al siguiente chofer o lo deja en sin_choferes_disponibles.
  rechazarOferta: (ofertaId, clave) => pedir('POST', `/ofertas/${ofertaId}/rechazar`, { clave }),
  avanzarEstado: (viajeId, estado) => pedir('POST', `/choferes/viajes/${viajeId}/estado`, { cuerpo: { estado } }),
  finalizar: (viajeId, clave) => pedir('POST', `/choferes/viajes/${viajeId}/finalizar`, { clave }),
  // Cancelación del chofer (#25): sólo en asignado o en camino; el motivo es opcional (1 a 200 caracteres).
  cancelarComoChofer: (viajeId, motivo, clave) => pedir('POST', `/choferes/viajes/${viajeId}/cancelar`, { cuerpo: motivo ? { motivo } : {}, clave }),
  // Cancelación del pasajero (#25): sin motivo obligatorio. Responde { viajeId, estado, canceladoAt, motivo }.
  cancelarViaje: (viajeId, clave) => pedir('POST', `/viajes/${viajeId}/cancelar`, { cuerpo: {}, clave }),
  // Operador (#26): viajes activos, cancelar con motivo obligatorio (3 a 200 caracteres) y reintentar un cobro pendiente.
  viajesActivos: () => pedir('GET', '/operador/viajes?estado=activos').then((r) => r.viajes),
  cancelarComoOperador: (viajeId, motivo, clave) => pedir('POST', `/operador/viajes/${viajeId}/cancelar`, { cuerpo: { motivo }, clave }),
  reintentarCobroOperador: (viajeId, clave) => pedir('POST', `/operador/viajes/${viajeId}/reintentar-cobro`, { clave }),
  // Administrador: choferes por habilitar, habilitación y tarifa (guardar crea una fila nueva activa).
  choferesAdmin: (estado = 'pendientes') => pedir('GET', `/admin/choferes?estado=${estado}`).then((r) => r.choferes),
  habilitarChofer: (choferId, habilitado) => pedir('PATCH', `/admin/choferes/${choferId}/habilitacion`, { cuerpo: { habilitado } }),
  tarifaActiva: () => pedir('GET', '/admin/tarifa').then((r) => r.tarifa),
  metricas: () => pedir('GET', '/admin/metricas'),
  guardarTarifa: (tarifa, clave) => pedir('POST', '/admin/tarifa', { cuerpo: tarifa, clave }).then((r) => r.tarifa),
};
