import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlsDePrueba, crearPoolsDePrueba, cerrarPools } from '../ayudas/basesDePrueba.js';
import { crearRepositorioChoferesPostgres } from '../../src/infra/db/repositorioChoferesPostgres.js';
import { crearRepositorioTarifasPostgres } from '../../src/infra/db/repositorioTarifasPostgres.js';

// Pantalla del administrador: choferes por habilitar y cambio de tarifa (una fila nueva activa).

async function conBase(t, ejecutar) {
  const urls = urlsDePrueba();
  if (!urls) {
    t.skip('Definir DATABASE_URL para ejecutar las pruebas de integración');
    return;
  }
  const pools = crearPoolsDePrueba(urls);
  try {
    await ejecutar(pools.viajes);
  } finally {
    await cerrarPools(pools);
  }
}

async function crearChofer(pool, habilitado) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO usuarios (id, email, password_hash, rol) VALUES ($1, $2, $3, $4)',
    [id, `admin-chofer-${id}@example.com`, 'hash-de-prueba', 'chofer'],
  );
  await pool.query(
    `INSERT INTO perfiles_chofer (usuario_id, patente, marca_vehiculo, modelo_vehiculo, habilitado)
     VALUES ($1, $2, 'Fiat', 'Cronos', $3)`,
    [id, `ADM-${id.slice(0, 8)}`, habilitado],
  );
  return id;
}

test('listarParaAdministracion: pendientes sólo trae a los no habilitados; todos trae a los dos', async (t) => {
  await conBase(t, async (pool) => {
    const choferes = crearRepositorioChoferesPostgres(pool);
    const pendiente = await crearChofer(pool, false);
    const habilitado = await crearChofer(pool, true);

    const pendientes = await choferes.listarParaAdministracion({ soloPendientes: true, limite: 50 });
    assert.ok(pendientes.every((c) => c.habilitado === false));
    const fila = pendientes.find((c) => c.choferId === pendiente);
    assert.ok(fila, 'el chofer pendiente tiene que aparecer');
    assert.deepEqual(fila.vehiculo, { patente: `ADM-${pendiente.slice(0, 8)}`, marca: 'Fiat', modelo: 'Cronos' });
    assert.ok(!pendientes.some((c) => c.choferId === habilitado));

    const todos = await choferes.listarParaAdministracion({ soloPendientes: false, limite: 50 });
    assert.ok(todos.length <= 50);

    await choferes.establecerHabilitacion(pendiente, true);
    const despues = await choferes.listarParaAdministracion({ soloPendientes: true, limite: 50 });
    assert.ok(!despues.some((c) => c.choferId === pendiente), 'al habilitarlo sale de los pendientes');
  });
});

test('reemplazarActiva: cinco administradores guardando a la vez dejan exactamente una tarifa activa', async (t) => {
  await conBase(t, async (pool) => {
    const tarifas = crearRepositorioTarifasPostgres(pool);
    await pool.query(
      `INSERT INTO parametros_tarifa
         (base_centavos, por_kilometro_centavos, por_minuto_centavos, maximo_viaje_centavos, velocidad_promedio_kmh)
       VALUES (500, 250, 100, 100000, 30)
       ON CONFLICT DO NOTHING`,
    );
    const original = await tarifas.obtenerActiva();
    try {
      // Sin el LOCK TABLE, los cinco desactivarían la misma fila y cuatro INSERT chocarían con
      // ux_parametros_tarifa_activo.
      const resultados = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((i) => tarifas.reemplazarActiva({
          baseCentavos: 600 + i, porKilometroCentavos: 300, porMinutoCentavos: 120, maximoViajeCentavos: 200000,
        })),
      );
      assert.deepEqual(resultados.map((r) => r.status), Array(5).fill('fulfilled'));

      const { rows } = await pool.query('SELECT id FROM parametros_tarifa WHERE activo = TRUE');
      assert.equal(rows.length, 1);
      const activa = await tarifas.obtenerActiva();
      assert.ok(resultados.some((r) => r.value.id === activa.id), 'la activa es la del último que guardó');
      assert.equal(activa.velocidadPromedioKmh, original.velocidadPromedioKmh, 'sin velocidad nueva se conserva la anterior');

      const viejas = await pool.query('SELECT count(*)::int AS n FROM parametros_tarifa WHERE id = $1 AND activo = FALSE', [original.id]);
      assert.equal(viejas.rows[0].n, 1, 'la tarifa anterior queda en el historial, desactivada');
    } finally {
      await tarifas.reemplazarActiva({
        baseCentavos: original.baseCentavos,
        porKilometroCentavos: original.porKilometroCentavos,
        porMinutoCentavos: original.porMinutoCentavos,
        maximoViajeCentavos: original.maximoViajeCentavos,
        velocidadPromedioKmh: original.velocidadPromedioKmh,
      });
    }
  });
});
