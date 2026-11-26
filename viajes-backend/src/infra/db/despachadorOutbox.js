// Despachador de un outbox (temas 12 y 13): toma un evento pendiente, se lo entrega a `manejar`
// y lo marca procesado, todo con la fila bloqueada.
// - FOR UPDATE SKIP LOCKED: si hay dos despachadores (dos instancias del backend), no toman el mismo evento.
// - Entrega "al menos una vez": si `manejar` termina pero el UPDATE no llega (caída), el evento se
//   vuelve a entregar. Por eso cada consumidor deduplica por id de evento (tema 3).
// - Si `manejar` lanza, el evento queda pendiente y se reintenta en la próxima vuelta.
// Los nombres de tabla son fijos: no se arma SQL con datos externos.
const CONSULTAS = new Map([
  ['outbox_viajes', {
    pendiente: 'SELECT id, tipo, datos FROM outbox_viajes WHERE procesado_at IS NULL ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED',
    marcar: 'UPDATE outbox_viajes SET procesado_at = now() WHERE id = $1',
  }],
  ['outbox_billetera', {
    pendiente: 'SELECT id, tipo, datos FROM outbox_billetera WHERE procesado_at IS NULL ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED',
    marcar: 'UPDATE outbox_billetera SET procesado_at = now() WHERE id = $1',
  }],
]);

export function crearDespachadorOutbox({ pool, tabla, manejar, logger, intervaloMs = 500 }) {
  const sql = CONSULTAS.get(tabla);
  if (!sql) throw new Error(`Outbox desconocido: ${tabla}`);
  let temporizador = null;
  let vuelta = Promise.resolve();
  let activo = false;

  async function procesarUno() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(sql.pendiente);
      if (!rows[0]) {
        await client.query('COMMIT');
        return false;
      }
      await manejar(rows[0]);
      await client.query(sql.marcar, [rows[0].id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Procesa hasta vaciar el outbox. Devuelve cuántos eventos entregó. Los tests lo llaman directo.
  async function procesarPendientes() {
    let cantidad = 0;
    while (await procesarUno()) cantidad += 1;
    return cantidad;
  }

  function programar() {
    if (!activo) return;
    temporizador = setTimeout(() => {
      vuelta = procesarPendientes()
        .catch((error) => logger.error({ err: error, outbox: tabla }, 'falló la entrega de un evento; se reintenta'))
        .finally(programar);
    }, intervaloMs);
  }

  return {
    procesarPendientes,
    iniciar() {
      activo = true;
      programar();
    },
    // Espera a que termine la vuelta en curso, para no cerrar los pools con una entrega a medias.
    async detener() {
      activo = false;
      clearTimeout(temporizador);
      await vuelta;
    },
  };
}
