// Números del panel del administrador (junto con el lag del event loop y la memoria de GET /admin/metricas).
// Son conteos de lectura, sin bloqueos: un número que se atrasa unos milisegundos no importa.
// "Disponibles" son los que hoy podrían recibir una oferta: habilitados, disponibles y con una
// ubicación reciente (la misma regla de UBICACION_TTL_SEGUNDOS que usa el despacho).
export function crearResumenOperativoPostgres(pool, { ubicacionTtlSegundos = null } = {}) {
  return {
    async obtener() {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM viajes
             WHERE estado IN ('solicitado', 'asignado', 'chofer_en_camino', 'en_curso')) AS viajes_activos,
           (SELECT count(*)::int FROM viajes WHERE estado = 'pago_pendiente') AS pagos_pendientes,
           (SELECT count(*)::int FROM perfiles_chofer WHERE habilitado) AS choferes_habilitados,
           (SELECT count(*)::int FROM perfiles_chofer WHERE NOT habilitado) AS choferes_por_habilitar,
           (SELECT count(*)::int FROM perfiles_chofer p
              JOIN ubicaciones_actuales_chofer u ON u.chofer_id = p.usuario_id
             WHERE p.habilitado AND p.disponible
               AND ($1::int IS NULL OR u.reportada_at > now() - make_interval(secs => $1::int))) AS choferes_disponibles`,
        [ubicacionTtlSegundos],
      );
      const f = rows[0];
      return {
        viajesActivos: f.viajes_activos,
        pagosPendientes: f.pagos_pendientes,
        choferesHabilitados: f.choferes_habilitados,
        choferesPorHabilitar: f.choferes_por_habilitar,
        choferesDisponibles: f.choferes_disponibles,
      };
    },
  };
}
