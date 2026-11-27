import http from 'node:http';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { leerConfiguracion } from '../src/config/env.js';
import { crearPoolPostgres } from '../src/infra/db/postgres.js';
import { crearServicioJwt } from '../src/infra/autenticacion/tokensJwt.js';
import { Rol } from '../src/dominio/usuarios/roles.js';

function leerOpciones(argv) {
  const mapa = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [clave, valor = 'true'] = arg.slice(2).split('=');
    mapa.set(clave, valor);
  }
  return {
    escenario: mapa.get('escenario') ?? 'ubicaciones',
    choferes: Number(mapa.get('choferes') ?? 500),
    intervaloMs: Number(mapa.get('intervalo-ms') ?? 2_000),
    duracionS: Number(mapa.get('duracion-s') ?? 30),
    pasajeros: Number(mapa.get('pasajeros') ?? 4),
    pausaViajeMs: Number(mapa.get('pausa-viaje-ms') ?? 200),
    baseUrl: mapa.get('base-url') ?? 'http://127.0.0.1:3000',
    limpiar: mapa.get('limpiar') !== 'false',
  };
}

function percentil(valores, p) {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return Number(ordenados.at(idx).toFixed(2));
}

function sleep(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function peticionHttp(agent, urlBase, { method, path, token, body, idempotente = false }) {
  return new Promise((resolver) => {
    const inicio = performance.now();
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { Authorization: `Bearer ${token}` };
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (idempotente) headers['Idempotency-Key'] = crypto.randomUUID();

    const url = new URL(path, urlBase);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      agent,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ms = performance.now() - inicio;
        let json = null;
        try {
          if (chunks.length > 0) json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          json = null;
        }
        resolver({ status: res.statusCode ?? 0, ms, json });
      });
    });
    req.on('error', () => resolver({ status: 0, ms: performance.now() - inicio, json: null }));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function prepararActores(pool, tokens, cantidadChoferes, cantidadPasajeros) {
  const choferes = [];
  const choferTokens = new Map();
  for (let i = 0; i < cantidadChoferes; i += 1) {
    const email = `carga-chofer-${i}@carga.local`;
    const patente = `CG${String(i).padStart(4, '0')}X`;
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, password_hash, rol) VALUES ($1, 'hash-sintetico-carga', 'chofer')
       ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now() RETURNING id`,
      [email],
    );
    const id = rows[0].id;
    await pool.query(
      `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado, disponible)
       VALUES ($1, $2, 'Carga', 'Sim', TRUE, TRUE)
       ON CONFLICT (usuario_id) DO UPDATE SET habilitado = TRUE, disponible = TRUE, updated_at = now()`,
      [id, patente],
    );
    const lat = -27.4514 + ((i % 20) - 10) * 0.0005;
    const lon = -58.9867 + ((Math.floor(i / 20) % 25) - 12) * 0.0005;
    await pool.query(
      `INSERT INTO ubicaciones_actuales_chofer (chofer_id, ubicacion, reportada_at)
       VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, now())
       ON CONFLICT (chofer_id) DO UPDATE SET ubicacion = EXCLUDED.ubicacion, reportada_at = now()`,
      [id, lat, lon],
    );
    const token = tokens.crearTokenDeAcceso({ usuarioId: id, rol: Rol.CHOFER });
    choferes.push({ id, token, lat, lon });
    choferTokens.set(id, token);
  }

  const pasajeros = [];
  for (let i = 0; i < cantidadPasajeros; i += 1) {
    const email = `carga-pasajero-${i}@carga.local`;
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, password_hash, rol) VALUES ($1, 'hash-sintetico-carga', 'pasajero')
       ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now() RETURNING id`,
      [email],
    );
    pasajeros.push({ id: rows[0].id, token: tokens.crearTokenDeAcceso({ usuarioId: rows[0].id, rol: Rol.PASAJERO }) });
  }

  const tokenAdmin = tokens.crearTokenDeAcceso({ usuarioId: crypto.randomUUID(), rol: Rol.ADMINISTRADOR });
  return { choferes, choferTokens, pasajeros, tokenAdmin };
}

async function limpiarActores(pool) {
  await pool.query("DELETE FROM eventos_viaje WHERE viaje_id IN (SELECT id FROM viajes WHERE pasajero_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local'))");
  await pool.query("DELETE FROM ofertas_viaje WHERE viaje_id IN (SELECT id FROM viajes WHERE pasajero_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local'))");
  await pool.query("DELETE FROM viajes WHERE pasajero_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local')");
  await pool.query("DELETE FROM claves_idempotencia WHERE actor_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local')");
  await pool.query("DELETE FROM historial_ubicaciones_chofer WHERE chofer_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local')");
  await pool.query("DELETE FROM ubicaciones_actuales_chofer WHERE chofer_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local')");
  await pool.query("DELETE FROM perfiles_chofer WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE '%@carga.local')");
  await pool.query("DELETE FROM usuarios WHERE email LIKE '%@carga.local'");
}

const opts = leerOpciones(process.argv.slice(2));
const urlBase = new URL(opts.baseUrl);
if (urlBase.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(urlBase.hostname)) {
  throw new Error('Solo se admite servidor local.');
}
const config = leerConfiguracion();
const urlDb = new URL(config.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(urlDb.hostname)) {
  throw new Error('Solo se admite Postgres local.');
}

const pool = crearPoolPostgres(config, { nombre: 'carga' });
const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
const tokens = crearServicioJwt(config);

try {
  const { choferes, choferTokens, pasajeros, tokenAdmin } = await prepararActores(pool, tokens, opts.choferes, opts.pasajeros);
  const reset = await peticionHttp(agent, opts.baseUrl, { method: 'GET', path: '/admin/metricas?reiniciar=true', token: tokenAdmin });
  if (reset.status !== 200) throw new Error(`El servidor no respondió 200 en /admin/metricas (status=${reset.status}).`);

  let activo = true;
  const solicitudLatencias = [];
  const asignacionLatencias = [];
  let pingsOk = 0;
  let pingsError = 0;
  let viajesOk = 0;
  let viajesError = 0;
  const enVuelo = new Set();

  function rastrear(promesa) {
    enVuelo.add(promesa);
    promesa.finally(() => enVuelo.delete(promesa));
  }

  const intervalos = [];
  if (opts.escenario === 'ubicaciones') {
    const grupos = 10;
    const tamGrupo = Math.ceil(choferes.length / grupos);
    for (let g = 0; g < grupos; g += 1) {
      const grupo = choferes.slice(g * tamGrupo, (g + 1) * tamGrupo);
      setTimeout(() => {
        if (!activo) return;
        const t = setInterval(() => {
          if (!activo) return;
          for (const ch of grupo) {
            const p = peticionHttp(agent, opts.baseUrl, {
              method: 'PUT',
              path: '/choferes/me/ubicacion',
              token: ch.token,
              body: { latitud: ch.lat + (Math.random() - 0.5) * 0.001, longitud: ch.lon + (Math.random() - 0.5) * 0.001 },
            }).then((r) => {
              if (r.status === 200) pingsOk += 1;
              else pingsError += 1;
            });
            rastrear(p);
          }
        }, opts.intervaloMs);
        intervalos.push(t);
      }, Math.floor((opts.intervaloMs / grupos) * g));
    }
  }

  const hilosPasajero = pasajeros.map(async (pasajero) => {
    while (activo) {
      const inicioCiclo = performance.now();
      const crear = await peticionHttp(agent, opts.baseUrl, {
        method: 'POST', path: '/viajes', token: pasajero.token, idempotente: true,
        body: { origen: { latitud: -27.4514, longitud: -58.9867 }, destino: { latitud: -27.44, longitud: -58.98 } },
      });
      solicitudLatencias.push(crear.ms);
      const viajeId = crear.json?.viaje?.id;
      if (crear.status !== 201 || !viajeId) {
        viajesError += 1;
        await sleep(opts.pausaViajeMs);
        continue;
      }
      const ofrecer = await peticionHttp(agent, opts.baseUrl, {
        method: 'POST', path: `/viajes/${viajeId}/ofertas`, token: pasajero.token, idempotente: true,
      });
      const tokenChofer = choferTokens.get(ofrecer.json?.choferId);
      if (ofrecer.status !== 201 || !ofrecer.json?.ofertaId || !tokenChofer) {
        viajesError += 1;
        await sleep(opts.pausaViajeMs);
        continue;
      }
      const aceptar = await peticionHttp(agent, opts.baseUrl, {
        method: 'POST', path: `/ofertas/${ofrecer.json.ofertaId}/aceptar`, token: tokenChofer, idempotente: true,
      });
      if (aceptar.status === 200) {
        asignacionLatencias.push(performance.now() - inicioCiclo);
        viajesOk += 1;
        await peticionHttp(agent, opts.baseUrl, {
          method: 'POST', path: `/choferes/viajes/${viajeId}/cancelar`, token: tokenChofer, idempotente: true, body: {},
        });
      } else {
        viajesError += 1;
      }
      await sleep(opts.pausaViajeMs);
    }
  });

  const inicioVentana = performance.now();
  await sleep(opts.duracionS * 1_000);
  activo = false;
  for (const t of intervalos) clearInterval(t);
  await Promise.all(hilosPasajero);
  await Promise.allSettled([...enVuelo]);
  const duracionRealS = (performance.now() - inicioVentana) / 1_000;

  const metricas = await peticionHttp(agent, opts.baseUrl, { method: 'GET', path: '/admin/metricas', token: tokenAdmin });
  const totalReqs = pingsOk + pingsError + viajesOk * 4 + viajesError * 2;
  const resumen = {
    escenario: opts.escenario,
    duracionS: Number(duracionRealS.toFixed(2)),
    solicitudMs: { p50: percentil(solicitudLatencias, 50), p95: percentil(solicitudLatencias, 95), p99: percentil(solicitudLatencias, 99) },
    asignacionMs: { p50: percentil(asignacionLatencias, 50), p95: percentil(asignacionLatencias, 95) },
    reqPorSeg: Number((totalReqs / duracionRealS).toFixed(1)),
    pings: { ok: pingsOk, error: pingsError, porSeg: Number((pingsOk / duracionRealS).toFixed(1)) },
    viajes: { ok: viajesOk, error: viajesError },
    servidor: metricas.json,
  };
  console.log(JSON.stringify(resumen, null, 2));
} finally {
  if (opts.limpiar) await limpiarActores(pool).catch(() => {});
  agent.destroy();
  await pool.end();
}
