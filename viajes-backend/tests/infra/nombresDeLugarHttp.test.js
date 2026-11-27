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

test('POST /viajes acepta un nombre opcional por punto y rechaza vacíos, largos o con caracteres de control', async () => {
  const recibidos = [];
  const app = crearApp({
    config,
    logger: { error() {}, warn() {}, info() {} },
    verificarDisponibilidad: async () => true,
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
    autenticacion: { registrarUsuario: async () => ({}), iniciarSesion: async () => ({}), buscarUsuarioPorId: async () => null, tokens },
    billetera: { procesarCargaWebhook: async () => ({}), consultarSaldoPorPasajero: async () => ({}), tokens },
    viajes: { solicitarViaje: async (datos) => { recibidos.push(datos); return { id: crypto.randomUUID() }; }, buscarViajePropio: async () => null, ofrecerAlChoferCercano: async () => ({}), tokens },
    ofertas: { aceptarOferta: async () => ({}), rechazarOferta: async () => ({}), tokens },
    choferes: { cambiarDisponibilidad: async () => ({}), registrarUbicacion: async () => ({}), avanzarEstado: async () => ({}), finalizarYCobrar: async () => ({}), tokens },
    administracion: { establecerHabilitacion: async () => ({}), tokens },
    operador: { listarViajesActivos: async () => [], cancelarViaje: async () => ({}), reintentarCobro: async () => ({}), tokens },
  });
  const servidor = createServer(app);
  await new Promise((resolver) => servidor.listen(0, resolver));
  const url = `http://127.0.0.1:${servidor.address().port}/viajes`;
  const token = tokens.crearTokenDeAcceso({ rol: Rol.PASAJERO, usuarioId: crypto.randomUUID() });
  const pedir = (origen) => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ origen, destino: { latitud: -27.46, longitud: -58.98 } }),
  });
  try {
    const base = { latitud: -27.4514, longitud: -58.9867 };
    assert.equal((await pedir({ ...base, nombre: '  Plaza 25 de Mayo  ' })).status, 201);
    assert.equal(recibidos[0].origen.nombre, 'Plaza 25 de Mayo', 'se recorta');
    assert.equal(recibidos[0].destino.nombre, undefined, 'es opcional');
    for (const nombre of ['', '   ', 'x'.repeat(121), 'Plaza\nfalsa', 'Plaza\u0000']) {
      assert.equal((await pedir({ ...base, nombre })).status, 400, JSON.stringify(nombre));
    }
    assert.equal((await pedir({ ...base, nombre: 'Plaza', sobra: 1 })).status, 400, 'sigue siendo estricto');
    assert.equal(recibidos.length, 1);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
});
