
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { crearPoolPostgres } from '../../src/infra/db/postgres.js';
import { crearRepositorioUsuariosPostgres } from '../../src/infra/db/repositorioUsuariosPostgres.js';
import { crearRepositorioViajesPostgres } from '../../src/infra/db/repositorioViajesPostgres.js';
import { crearRepositorioBilleterasPostgres } from '../../src/infra/db/repositorioBilleterasPostgres.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';

const PAYLOADS_SQL = [
  "' OR '1'='1",
  "'; DROP TABLE usuarios; --",
  "admin'--",
  "' UNION SELECT * FROM usuarios --",
];

const UUID_VALIDO = '11111111-1111-4111-8111-111111111111';

async function conBaseDePrueba(t, ejecutar) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }

  const url = new URL(databaseUrl);

  assert.equal(
    url.pathname,
    '/viajes_test',
    'Las pruebas solo pueden ejecutarse contra viajes_test',
  );

  const pool = crearPoolPostgres({
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: false,
  });

  try {
    await ejecutar(pool);
  } finally {
    await pool.end();
  }
}

function verificarErrorUuid(error) {
  return error?.code === '22P02';
}

async function comprobarRechazoUuid(t, ejecutar) {
  for (const payload of PAYLOADS_SQL) {
    await t.test(`rechaza como UUID inválido: ${payload}`, async () => {
      await assert.rejects(
        ejecutar(payload),
        verificarErrorUuid,
        'PostgreSQL debe interpretar el payload como un valor UUID inválido',
      );
    });
  }
}

test('SQL Injection - búsqueda de usuarios', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearRepositorioUsuariosPostgres(pool);

    // El email es un dato de texto: el payload debe buscarse como valor,
    // no ejecutarse como parte de la consulta.
    for (const payload of PAYLOADS_SQL) {
      await t.test(`email tratado como dato: ${payload}`, async () => {
        const usuario = await repositorio.buscarPorEmail(payload);

        assert.equal(usuario, null);
      });
    }

    // El ID es UUID: PostgreSQL debe rechazar el valor malicioso.
    await comprobarRechazoUuid(t, (payload) =>
      repositorio.buscarPorId(payload),
    );
  });
});

test('SQL Injection - consultas y operaciones de viajes', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearRepositorioViajesPostgres(pool);

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.buscarPorIdDelPasajero(payload, UUID_VALIDO),
    );

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.aceptarOferta(payload, UUID_VALIDO),
    );

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.crearSolicitud({
        pasajeroId: payload,
        origen: {
          latitud: -27.4514,
          longitud: -58.9867,
        },
        destino: {
          latitud: -27.44,
          longitud: -58.98,
        },
        estimacion: {
          importeCentavos: 5000,
        },
      }),
    );
  });
});

test('SQL Injection - operaciones de billetera', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearRepositorioBilleterasPostgres(pool);

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.consultarSaldoPorPasajero(payload),
    );

    // El evento se inserta dentro de una transacción. El pasajero inválido
    // provoca un error UUID y el repositorio debe ejecutar ROLLBACK.
    for (const payload of PAYLOADS_SQL) {
      await t.test(`webhook con pasajero malicioso: ${payload}`, async () => {
        const cuerpoCrudo = Buffer.from(JSON.stringify({
          id: `test-${crypto.randomUUID()}`,
          tipo: 'carga',
          importe: 5000,
        }));

        await assert.rejects(
          repositorio.registrarCargaDesdeWebhook(
            {
              eventoExternoId: `test-${crypto.randomUUID()}`,
              pasajeroId: payload,
              importeCentavos: 5000,
            },
            cuerpoCrudo,
          ),
          verificarErrorUuid,
        );
      });
    }
  });
});

test('SQL Injection - operaciones de choferes', async (t) => {
  await conBaseDePrueba(t, async (pool) => {
    const repositorio = crearRepositorioChoferesPostgres(pool);

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.establecerHabilitacion(payload, true),
    );

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.cambiarDisponibilidad(payload, true),
    );

    await comprobarRechazoUuid(t, (payload) =>
      repositorio.registrarUbicacion(payload, {
        latitud: -27.4514,
        longitud: -58.9867,
      }),
    );
  });
});
