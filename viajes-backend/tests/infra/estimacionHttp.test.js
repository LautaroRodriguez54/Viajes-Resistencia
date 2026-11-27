import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = { JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres', JWT_ACCESS_TOKEN_TTL: '15m', IDEMPOTENCIA_TTL_SEGUNDOS: 86_400, CORS_ORIGINS: ['http://localhost:3000'] };
const tokens = crearServicioJwt(config);

test('POST /viajes/estimacion: sólo pasajero, valida el cuerpo, no pide Idempotency-Key y no crea viajes', async () => {
  let creados = 0;
  const app = crearApp({
    config,
    logger: { error() {}, warn() {}, info() {} },
    verificarDisponibilidad: async () => true,
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
    autenticacion: { registrarUsuario: async () => ({}), iniciarSesion: async () => ({}), buscarUsuarioPorId: async () => null, tokens },
    billetera: { procesarCargaWebhook: async () => ({}), consultarSaldoPorPasajero: async () => ({}), tokens },
    viajes: {
      solicitarViaje: async () => { creados += 1; return {}; },
      estimarViaje: async () => ({ importeCentavos: 784_000, kilometros: 4.64, minutos: 12 }),
      buscarViajePropio: async () => null, ofrecerAlChoferCercano: async () => ({}), tokens,
    },
    ofertas: { aceptarOferta: async () => ({}), rechazarOferta: async () => ({}), tokens },
    choferes: { cambiarDisponibilidad: async () => ({}), registrarUbicacion: async () => ({}), avanzarEstado: async () => ({}), finalizarYCobrar: async () => ({}), tokens },
    administracion: { establecerHabilitacion: async () => ({}), tokens },
    operador: { listarViajesActivos: async () => [], cancelarViaje: async () => ({}), reintentarCobro: async () => ({}), tokens },
  });
  const servidor = createServer(app);
  await new Promise((resolver) => servidor.listen(0, resolver));
  const url = `http://127.0.0.1:${servidor.address().port}/viajes/estimacion`;
  const cuerpo = { origen: { latitud: -27.4514, longitud: -58.9867, nombre: 'Plaza' }, destino: { latitud: -27.4562, longitud: -59.0225 } };
  const pedir = (rol, body = cuerpo) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(rol ? { Authorization: `Bearer ${tokens.crearTokenDeAcceso({ rol, usuarioId: crypto.randomUUID() })}` } : {}) },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await pedir(null)).status, 401);
    assert.equal((await pedir(Rol.CHOFER)).status, 403);
    assert.equal((await pedir(Rol.PASAJERO, { origen: cuerpo.origen })).status, 400);
    assert.equal((await pedir(Rol.PASAJERO, { ...cuerpo, sobra: 1 })).status, 400);
    const ok = await pedir(Rol.PASAJERO);
    assert.equal(ok.status, 200, 'sin Idempotency-Key: no escribe nada');
    assert.deepEqual(await ok.json(), { estimacion: { importeCentavos: 784_000, kilometros: 4.64, minutos: 12 } });
    assert.equal(creados, 0);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
});
