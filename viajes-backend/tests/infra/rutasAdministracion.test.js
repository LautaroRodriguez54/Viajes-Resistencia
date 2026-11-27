import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { crearApp } from '../../src/infra/http/app.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearRepositorioIdempotenciaEnMemoria } from '../../src/infra/memoria/repositorioIdempotenciaEnMemoria.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = {
  JWT_SECRET: 'secreto-de-prueba-con-mas-de-32-caracteres',
  JWT_ACCESS_TOKEN_TTL: '15m',
  IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  CORS_ORIGINS: ['http://localhost:3000'],
};
const tokens = crearServicioJwt(config);
const tarifaValida = { baseCentavos: 600, porKilometroCentavos: 300, porMinutoCentavos: 120, maximoViajeCentavos: 200000 };

async function conApp(administracion, fn) {
  const app = crearApp({
    config,
    logger: { error() {}, warn() {}, info() {} },
    verificarDisponibilidad: async () => true,
    idempotencia: crearRepositorioIdempotenciaEnMemoria(),
    autenticacion: { registrarUsuario: async () => ({}), iniciarSesion: async () => ({}), buscarUsuarioPorId: async () => null, tokens },
    billetera: { procesarCargaWebhook: async () => ({}), consultarSaldoPorPasajero: async () => ({}), tokens },
    viajes: { solicitarViaje: async () => ({}), buscarViajePropio: async () => null, ofrecerAlChoferCercano: async () => ({}), tokens },
    ofertas: { aceptarOferta: async () => ({}), rechazarOferta: async () => ({}), tokens },
    choferes: { cambiarDisponibilidad: async () => ({}), registrarUbicacion: async () => ({}), avanzarEstado: async () => ({}), finalizarYCobrar: async () => ({}), tokens },
    administracion: { establecerHabilitacion: async () => ({}), tokens, ...administracion },
    operador: { listarViajesActivos: async () => [], cancelarViaje: async () => ({}), reintentarCobro: async () => ({}), tokens },
  });
  const servidor = createServer(app);
  await new Promise((resolver) => servidor.listen(0, resolver));
  try {
    await fn(`http://127.0.0.1:${servidor.address().port}`);
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
}

const token = (rol) => tokens.crearTokenDeAcceso({ rol, usuarioId: crypto.randomUUID() });
const cabeceras = (rol, extra = {}) => ({ Authorization: `Bearer ${token(rol)}`, 'Content-Type': 'application/json', ...extra });

test('GET /admin/choferes y /admin/tarifa: 401 sin token, 403 con otro rol y 200 para el administrador', async () => {
  const pedidos = [];
  await conApp({
    listarChoferes: async (opciones) => { pedidos.push(opciones); return [{ choferId: 'c1' }]; },
    obtenerTarifa: async () => ({ id: 't1', ...tarifaValida }),
  }, async (url) => {
    assert.equal((await fetch(`${url}/admin/choferes`)).status, 401);
    assert.equal((await fetch(`${url}/admin/choferes`, { headers: cabeceras(Rol.OPERADOR) })).status, 403);
    assert.equal((await fetch(`${url}/admin/tarifa`, { headers: cabeceras(Rol.CHOFER) })).status, 403);

    const lista = await fetch(`${url}/admin/choferes`, { headers: cabeceras(Rol.ADMINISTRADOR) });
    assert.equal(lista.status, 200);
    assert.deepEqual(await lista.json(), { choferes: [{ choferId: 'c1' }] });
    await fetch(`${url}/admin/choferes?estado=todos&limite=10`, { headers: cabeceras(Rol.ADMINISTRADOR) });
    assert.deepEqual(pedidos, [{ soloPendientes: true, limite: 50 }, { soloPendientes: false, limite: 10 }]);

    for (const query of ['estado=otros', 'limite=0', 'limite=51', 'sobra=1']) {
      assert.equal((await fetch(`${url}/admin/choferes?${query}`, { headers: cabeceras(Rol.ADMINISTRADOR) })).status, 400, query);
    }

    const tarifa = await fetch(`${url}/admin/tarifa`, { headers: cabeceras(Rol.ADMINISTRADOR) });
    assert.equal(tarifa.status, 200);
    assert.equal((await tarifa.json()).tarifa.id, 't1');
  });
});

test('POST /admin/tarifa: rol antes que la clave, Idempotency-Key obligatoria, validación y repetición sin otra fila', async () => {
  const guardadas = [];
  await conApp({
    reemplazarTarifa: async (datos) => { guardadas.push(datos); return { id: `t${guardadas.length}`, ...datos }; },
  }, async (url) => {
    const enviar = (rol, cuerpo, extra) => fetch(`${url}/admin/tarifa`, { method: 'POST', headers: cabeceras(rol, extra), body: JSON.stringify(cuerpo) });

    // Un rol equivocado da 403 aunque no mande la clave (el rol se verifica antes que la idempotencia).
    assert.equal((await enviar(Rol.PASAJERO, tarifaValida)).status, 403);
    assert.equal((await enviar(Rol.ADMINISTRADOR, tarifaValida)).status, 400, 'sin Idempotency-Key');

    const invalidas = [
      { ...tarifaValida, baseCentavos: 5.5 },
      { ...tarifaValida, baseCentavos: -1 },
      { ...tarifaValida, maximoViajeCentavos: 100 },
      { ...tarifaValida, extra: true },
      { ...tarifaValida, velocidadPromedioKmh: 0 },
    ];
    for (const cuerpo of invalidas) {
      const r = await enviar(Rol.ADMINISTRADOR, cuerpo, { 'Idempotency-Key': crypto.randomUUID() });
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
    assert.equal(guardadas.length, 0);

    // La clave es por actor: el reintento tiene que venir del mismo administrador.
    const admin = { Authorization: `Bearer ${token(Rol.ADMINISTRADOR)}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    const guardar = () => fetch(`${url}/admin/tarifa`, { method: 'POST', headers: admin, body: JSON.stringify(tarifaValida) });
    const primera = await guardar();
    assert.equal(primera.status, 201);
    const repetida = await guardar();
    assert.equal(repetida.status, 201);
    assert.equal(repetida.headers.get('idempotency-replayed'), 'true');
    assert.deepEqual(await repetida.json(), await primera.json());
    assert.equal(guardadas.length, 1, 'el reintento no crea otra tarifa');
  });
});
