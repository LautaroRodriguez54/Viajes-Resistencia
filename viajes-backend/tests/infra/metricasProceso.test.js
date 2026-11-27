import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crearMetricasProceso } from '../../src/infra/observabilidad/metricasProceso.js';
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

test('crearMetricasProceso expone lag del event loop, memoria y permite reiniciar contadores', async () => {
  const metricas = crearMetricasProceso({ resolucionMs: 10 });
  try {
    await new Promise((resolver) => setTimeout(resolver, 25));
    const primera = metricas.obtenerInstantanea({ reiniciar: true });
    assert.ok(primera.eventLoopLagMs.p99 >= 0);
    assert.ok(primera.eventLoopLagMs.max >= primera.eventLoopLagMs.p50);
    assert.ok(primera.memoriaMb.rss > 0);
    assert.ok(primera.memoriaMb.heapUsed > 0);
    assert.ok(primera.uptimeSegundos >= 0);

    const segunda = metricas.obtenerInstantanea();
    assert.ok(segunda.eventLoopLagMs.min >= 0);
  } finally {
    metricas.cerrar();
  }
});

test('GET /admin/metricas exige rol administrador y valida el parámetro reiniciar', async () => {
  const metricas = crearMetricasProceso();
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
    administracion: { establecerHabilitacion: async () => ({}), obtenerMetricas: metricas.obtenerInstantanea, tokens },
    operador: { listarViajesActivos: async () => [], cancelarViaje: async () => ({}), reintentarCobro: async () => ({}), tokens },
  });

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const sinToken = await fetch(`${baseUrl}/admin/metricas`);
    assert.equal(sinToken.status, 401);

    const tokenPasajero = tokens.crearTokenDeAcceso({ rol: Rol.PASAJERO, usuarioId: '11111111-1111-4111-8111-111111111111' });
    const comoPasajero = await fetch(`${baseUrl}/admin/metricas`, { headers: { Authorization: `Bearer ${tokenPasajero}` } });
    assert.equal(comoPasajero.status, 403);

    const tokenAdmin = tokens.crearTokenDeAcceso({ rol: Rol.ADMINISTRADOR, usuarioId: '22222222-2222-4222-8222-222222222222' });
    const invalida = await fetch(`${baseUrl}/admin/metricas?reiniciar=quizas`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
    assert.equal(invalida.status, 400);

    const ok = await fetch(`${baseUrl}/admin/metricas?reiniciar=true`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
    assert.equal(ok.status, 200);
    const cuerpo = await ok.json();
    assert.ok(typeof cuerpo.eventLoopLagMs?.p99 === 'number');
    assert.ok(typeof cuerpo.memoriaMb?.rss === 'number');
  } finally {
    metricas.cerrar();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
