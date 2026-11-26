import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearUnidadDeTrabajoCobroPostgres } from '../../src/infra/db/unidadDeTrabajoCobroPostgres.js';
import { crearRepositorioIdempotenciaPostgres } from '../../src/infra/db/repositorioIdempotenciaPostgres.js';
import { crearReintentarCobroOperador } from '../../src/aplicacion/viajes/reintentarCobroOperador.js';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { crearApp } from '../../src/infra/http/app.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';
import { crearCasosDeUsoViajesPostgres } from '../ayudas/casosDeUsoViajesPostgres.js';
import { urlsDePrueba } from '../ayudas/basesDePrueba.js';

const loggerMudo = { info() {}, warn() {}, error() {} };
let poolBilletera;

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  assert.equal(new URL(databaseUrl).pathname, '/viajes_test', 'Las pruebas solo pueden ejecutarse contra viajes_test');
  const pool = crearPoolPostgres({ DATABASE_URL: databaseUrl, DATABASE_SSL: false });
  poolBilletera = crearPoolPostgres({ DATABASE_URL: urlsDePrueba().billetera, DATABASE_SSL: false });
  try {
    await ejecutar(pool);
  } finally {
    await Promise.all([pool.end(), poolBilletera.end()]);
  }
}

async function conApp(pool, fn) {
  const config = {
    CORS_ORIGINS: ['http://localhost:5173'],
    JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-al-menos-32-chars',
    JWT_ACCESS_TOKEN_TTL: '15m',
    RATE_LIMIT_LOGIN_VENTANA_MS: 60_000, RATE_LIMIT_LOGIN_MAX: 100,
    RATE_LIMIT_WEBHOOK_VENTANA_MS: 60_000, RATE_LIMIT_WEBHOOK_MAX: 100,
    RATE_LIMIT_UBICACION_VENTANA_MS: 60_000, RATE_LIMIT_UBICACION_MAX: 100,
    IDEMPOTENCIA_TTL_SEGUNDOS: 86_400,
  };
  const tokens = crearServicioJwt(config);
  const viajes = crearRepositorioViajesPostgres(pool);
  const { cancelarViaje } = crearCasosDeUsoViajesPostgres(pool);
  const cobro = { unidadDeTrabajo: crearUnidadDeTrabajoCobroPostgres(pool), billetera: crearRepositorioBilleterasPostgres(poolBilletera) };
  const noUsado = async () => { throw new Error('no usado'); };
  const app = crearApp({
    config, logger: loggerMudo, verificarDisponibilidad: async () => true,
    autenticacion: { registrarUsuario: noUsado, iniciarSesion: noUsado, buscarUsuarioPorId: noUsado, tokens },
    billetera: { procesarCargaWebhook: noUsado, consultarSaldoPorPasajero: noUsado, tokens },
    viajes: { solicitarViaje: noUsado, buscarViajePropio: viajes.buscarPorIdDelPasajero, ofrecerAlChoferCercano: noUsado, reintentarCobro: noUsado, cancelarViaje, tokens },
    ofertas: { aceptarOferta: noUsado, rechazarOferta: noUsado, tokens },
    choferes: { cambiarDisponibilidad: noUsado, registrarUbicacion: noUsado, avanzarEstado: noUsado, finalizarYCobrar: noUsado, cancelarViaje, buscarOfertaPendiente: noUsado, buscarViajeActual: noUsado, tokens },
    administracion: { establecerHabilitacion: noUsado, tokens },
    operador: { listarViajesActivos: viajes.listarViajesActivos, cancelarViaje, reintentarCobro: crearReintentarCobroOperador(cobro), tokens },
    idempotencia: crearRepositorioIdempotenciaPostgres(pool),
  });
  const servidor = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}`, tokens);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

async function crearUsuario(pool, rol) {
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)', [id, `${rol}-${crypto.randomUUID()}@example.com`, 'hash', rol]);
  return id;
}

test('operador lista viajes activos, cancela con motivo obligatorio y reintenta cobro de pago_pendiente', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const operadorId = await crearUsuario(pool, 'operador');
    const pasajeroId = await crearUsuario(pool, 'pasajero');
    const billeteraRes = await poolBilletera.query('INSERT INTO billeteras (pasajero_id) VALUES ($1) RETURNING id', [pasajeroId]);
    const choferId = await crearUsuario(pool, 'chofer');
    await pool.query(
      "INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible) VALUES ($1, $2, 'Toyota', 'Etios', TRUE, FALSE)",
      [choferId, `OP-${crypto.randomUUID().slice(0, 8)}`],
    );

    const { rows: viajeCursoRows } = await pool.query(
      `INSERT INTO viajes (pasajero_id, chofer_id, estado, origen, destino, estimacion_centavos, asignado_at, iniciado_at)
       VALUES ($1, $2, 'en_curso', ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography, ST_SetSRID(ST_MakePoint(-58.98, -27.44), 4326)::geography, 1500, now(), now())
       RETURNING id`,
      [pasajeroId, choferId],
    );
    const viajeEnCurso = viajeCursoRows[0].id;

    const { rows: viajePendienteRows } = await pool.query(
      `INSERT INTO viajes (pasajero_id, estado, origen, destino, estimacion_centavos, tarifa_final_centavos, finalizado_at)
       VALUES ($1, 'pago_pendiente', ST_SetSRID(ST_MakePoint(-58.9867, -27.4514), 4326)::geography, ST_SetSRID(ST_MakePoint(-58.98, -27.44), 4326)::geography, 2000, 2000, now())
       RETURNING id`,
      [pasajeroId],
    );
    const viajePendiente = viajePendienteRows[0].id;

    await conApp(pool, async (baseUrl, tokens) => {
      const tokOperador = tokens.crearTokenDeAcceso({ usuarioId: operadorId, rol: Rol.OPERADOR });
      const tokPasajero = tokens.crearTokenDeAcceso({ usuarioId: pasajeroId, rol: Rol.PASAJERO });

      assert.equal((await fetch(`${baseUrl}/operador/viajes?estado=activos`, { headers: { authorization: `Bearer ${tokPasajero}` } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/operador/viajes?estado=otro`, { headers: { authorization: `Bearer ${tokOperador}` } })).status, 400);

      const listaRes = await fetch(`${baseUrl}/operador/viajes?estado=activos`, { headers: { authorization: `Bearer ${tokOperador}` } });
      assert.equal(listaRes.status, 200);
      const { viajes } = await listaRes.json();
      assert.ok(viajes.some((v) => v.id === viajeEnCurso && v.patente));
      assert.ok(viajes.some((v) => v.id === viajePendiente && v.estado === 'pago_pendiente'));

      // Sin motivo -> 400 ENTRADA_INVALIDA.
      const sinMotivo = await fetch(`${baseUrl}/operador/viajes/${viajeEnCurso}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokOperador}`, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ motivo: '' }),
      });
      assert.equal(sinMotivo.status, 400);

      // Operador cancela en_curso y libera chofer.
      const cancelRes = await fetch(`${baseUrl}/operador/viajes/${viajeEnCurso}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokOperador}`, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ motivo: 'Pedido del pasajero' }),
      });
      assert.equal(cancelRes.status, 200);
      assert.equal((await cancelRes.json()).estado, 'cancelado_operador');
      const perfil = await pool.query('SELECT disponible FROM perfiles_chofer WHERE usuario_id = $1', [choferId]);
      assert.equal(perfil.rows[0].disponible, true);

      // No se puede cancelar pago_pendiente -> 409 TRANSICION_INVALIDA.
      const cancelPendiente = await fetch(`${baseUrl}/operador/viajes/${viajePendiente}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokOperador}`, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ motivo: 'Intento inválido' }),
      });
      assert.equal(cancelPendiente.status, 409);

      // Reintento de cobro sin saldo -> 409 SALDO_INSUFICIENTE; luego carga y cobra -> 200 finalizado.
      const sinSaldo = await fetch(`${baseUrl}/operador/viajes/${viajePendiente}/reintentar-cobro`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokOperador}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(sinSaldo.status, 409);

      await poolBilletera.query("INSERT INTO movimientos_billetera (billetera_id, tipo, importe_centavos) VALUES ($1, 'carga', 5000)", [billeteraRes.rows[0].id]);
      const cobrado = await fetch(`${baseUrl}/operador/viajes/${viajePendiente}/reintentar-cobro`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokOperador}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(cobrado.status, 200);
      assert.deepEqual(await cobrado.json(), { viajeId: viajePendiente, estado: 'finalizado', importeCentavos: 2000 });
    });
  });
});
