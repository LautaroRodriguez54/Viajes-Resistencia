import test from 'node:test';
import assert from 'node:assert/strict';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';

function crearPoolSimulado(manejador) {
  const consultas = [];
  const client = {
    async query(sql, params = []) {
      const texto = sql.replace(/\s+/g, ' ').trim();
      consultas.push({ sql: texto, params });
      return manejador(texto, params);
    },
    release() {},
  };
  return {
    consultas,
    async connect() {
      return client;
    },
  };
}

test('aceptarOferta respeta orden global de bloqueos (viajes -> ofertas_viaje ORDER BY id -> perfiles_chofer) y cierra competidoras', async () => {
  const pool = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT id, viaje_id, chofer_id FROM ofertas_viaje')) {
      return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1' }] };
    }
    if (sql.startsWith('SELECT id, estado FROM viajes WHERE id = $1 FOR UPDATE')) {
      return { rows: [{ id: 'v-1', estado: 'solicitado' }] };
    }
    if (sql.includes('FROM ofertas_viaje') && sql.includes('ORDER BY id FOR UPDATE')) {
      return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1', estado: 'pendiente', vencida: false }] };
    }
    if (sql.startsWith('SELECT habilitado, disponible FROM perfiles_chofer')) {
      return { rows: [{ habilitado: true, disponible: true }] };
    }
    if (sql.startsWith('SELECT 1 FROM viajes WHERE chofer_id = $1')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  const repo = crearRepositorioViajesPostgres(pool);
  const res = await repo.aceptarOferta('of-1', 'ch-1');
  assert.deepEqual(res, { viajeId: 'v-1', ofertaId: 'of-1', estado: 'asignado' });

  const locks = pool.consultas.map((c) => c.sql).filter((s) => s.includes('FOR UPDATE'));
  assert.equal(locks.length, 3);
  assert.ok(locks[0].includes('FROM viajes'));
  assert.ok(locks[1].includes('FROM ofertas_viaje') && locks[1].includes('ORDER BY id FOR UPDATE'));
  assert.ok(locks[2].includes('FROM perfiles_chofer'));

  assert.ok(pool.consultas.some((c) => c.sql.includes("UPDATE ofertas_viaje SET estado = 'vencida'")));
});

test('aceptarOferta evalúa vencimiento según bandera vencida de PostgreSQL', async () => {
  const pool = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT id, viaje_id, chofer_id FROM ofertas_viaje')) {
      return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1' }] };
    }
    if (sql.startsWith('SELECT id, estado FROM viajes WHERE id = $1 FOR UPDATE')) {
      return { rows: [{ id: 'v-1', estado: 'solicitado' }] };
    }
    if (sql.includes('FROM ofertas_viaje') && sql.includes('ORDER BY id FOR UPDATE')) {
      return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1', estado: 'pendiente', vencida: true }] };
    }
    return { rows: [] };
  });

  const repo = crearRepositorioViajesPostgres(pool);
  await assert.rejects(repo.aceptarOferta('of-1', 'ch-1'), (err) => err.codigo === 'OFERTA_NO_DISPONIBLE');
  assert.ok(pool.consultas.some((c) => c.sql === 'ROLLBACK'));
});

test('aceptarOferta traduce errores 23505 de PostgreSQL a errores de dominio 409', async () => {
  for (const [constraint, codigoEsperado] of [
    ['ux_chofer_un_viaje_activo', 'CHOFER_CON_VIAJE_ACTIVO'],
    ['ux_una_oferta_aceptada_por_viaje', 'OFERTA_NO_DISPONIBLE'],
  ]) {
    const pool = crearPoolSimulado((sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT id, viaje_id, chofer_id FROM ofertas_viaje')) {
        return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1' }] };
      }
      if (sql.startsWith('SELECT id, estado FROM viajes WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: 'v-1', estado: 'solicitado' }] };
      }
      if (sql.includes('FROM ofertas_viaje') && sql.includes('ORDER BY id FOR UPDATE')) {
        return { rows: [{ id: 'of-1', viaje_id: 'v-1', chofer_id: 'ch-1', estado: 'pendiente', vencida: false }] };
      }
      if (sql.startsWith('SELECT habilitado, disponible FROM perfiles_chofer')) {
        return { rows: [{ habilitado: true, disponible: true }] };
      }
      if (sql.startsWith('SELECT 1 FROM viajes WHERE chofer_id = $1')) {
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE viajes SET chofer_id')) {
        const error = new Error('unique violation');
        error.code = '23505';
        error.constraint = constraint;
        throw error;
      }
      return { rows: [] };
    });

    const repo = crearRepositorioViajesPostgres(pool);
    await assert.rejects(repo.aceptarOferta('of-1', 'ch-1'), (err) => err.codigo === codigoEsperado);
  }
});

test('ofrecerAlChoferCercano usa FOR UPDATE OF p SKIP LOCKED y revalida elegibilidad con SAVEPOINT', async () => {
  const pool = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('SAVEPOINT')) return { rows: [] };
    if (sql.includes('FROM viajes WHERE id = $1')) return { rows: [{ id: 'v-1', origen: 'POINT(0 0)' }] };
    if (sql.startsWith('SELECT 1')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM perfiles_chofer p')) return { rows: [{ usuario_id: 'ch-1' }] };
    if (sql.startsWith('INSERT INTO ofertas_viaje')) return { rows: [{ id: 'of-1', chofer_id: 'ch-1', vence_at: '2026-01-01T00:00:00Z' }] };
    return { rows: [] };
  });

  const repo = crearRepositorioViajesPostgres(pool);
  const res = await repo.ofrecerAlChoferCercano('v-1', 'p-1');
  assert.equal(res.ofertaId, 'of-1');

  const queryCandidato = pool.consultas.find((c) => c.sql.includes('FOR UPDATE OF p SKIP LOCKED'));
  assert.ok(queryCandidato);
  assert.ok(queryCandidato.sql.includes('FROM ofertas_viaje o'));
  assert.ok(pool.consultas.some((c) => c.sql === 'SAVEPOINT buscar_candidato'));
  assert.ok(pool.consultas.some((c) => c.sql.startsWith('SELECT 1') && c.sql.includes('FROM perfiles_chofer p')));
});

test('cambiarDisponibilidad bloquea disponible=true si el chofer tiene un viaje activo', async () => {
  const pool = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT usuario_id, habilitado, disponible FROM perfiles_chofer')) {
      return { rows: [{ usuario_id: 'ch-1', habilitado: true, disponible: false }] };
    }
    if (sql.startsWith('SELECT 1 FROM viajes WHERE chofer_id = $1')) {
      return { rows: [{ '?column?': 1 }] };
    }
    return { rows: [] };
  });

  const repo = crearRepositorioChoferesPostgres(pool);
  await assert.rejects(repo.cambiarDisponibilidad('ch-1', true), (err) => err.codigo === 'CHOFER_CON_VIAJE_ACTIVO');
});

test('registrarUbicacion permite chofer con viaje activo aunque disponible sea false, y rechaza chofer inactivo', async () => {
  const poolConViajeActivo = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
    if (sql.startsWith('SELECT habilitado, disponible FROM perfiles_chofer')) {
      return { rows: [{ habilitado: true, disponible: false }] };
    }
    if (sql.startsWith('SELECT 1 FROM viajes WHERE chofer_id = $1')) {
      return { rows: [{ '?column?': 1 }] };
    }
    return { rows: [] };
  });

  const repoActivo = crearRepositorioChoferesPostgres(poolConViajeActivo);
  const res = await repoActivo.registrarUbicacion('ch-1', { latitud: -27.45, longitud: -58.98 });
  assert.deepEqual(res, { choferId: 'ch-1', latitud: -27.45, longitud: -58.98 });

  const poolSinViaje = crearPoolSimulado((sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT habilitado, disponible FROM perfiles_chofer')) {
      return { rows: [{ habilitado: true, disponible: false }] };
    }
    if (sql.startsWith('SELECT 1 FROM viajes WHERE chofer_id = $1')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  const repoInactivo = crearRepositorioChoferesPostgres(poolSinViaje);
  await assert.rejects(
    repoInactivo.registrarUbicacion('ch-1', { latitud: -27.45, longitud: -58.98 }),
    (err) => err.codigo === 'CHOFER_NO_DISPONIBLE',
  );
});
