import pino from 'pino';
import { leerConfiguracion } from './config/env.js';
import { crearPoolPostgres } from './infra/db/postgres.js';
import { DIRECTORIOS_MIGRACIONES, verificarMigracionesAplicadas } from './infra/db/migraciones.js';
import { crearRepositorioUsuariosPostgres } from './infra/db/repositorioUsuariosPostgres.js';
import { crearRepositorioBilleterasPostgres } from './infra/db/repositorioBilleterasPostgres.js';
import { crearRepositorioViajesPostgres } from './infra/db/repositorioViajesPostgres.js';
import { crearRepositorioChoferesPostgres } from './infra/db/repositorioChoferesPostgres.js';
import { crearRepositorioIdempotenciaPostgres } from './infra/db/repositorioIdempotenciaPostgres.js';
import { crearUnidadDeTrabajoCobroPostgres } from './infra/db/unidadDeTrabajoCobroPostgres.js';
import { crearUnidadDeTrabajoViajesPostgres } from './infra/db/unidadDeTrabajoViajesPostgres.js';
import { crearDespachadorOutbox } from './infra/db/despachadorOutbox.js';
import { crearDespachadorVencimientoOfertas } from './infra/db/despachadorVencimientoOfertas.js';
import { crearProyectorSaldosPostgres } from './infra/db/proyectorSaldosPostgres.js';
import { crearProyectorHistorialPostgres } from './infra/db/proyectorHistorialPostgres.js';
import { crearHasheadorArgon2 } from './infra/autenticacion/contrasenasArgon2.js';
import { crearServicioJwt } from './infra/autenticacion/tokensJwt.js';
import { crearApp } from './infra/http/app.js';
import { crearRegistrarUsuario } from './aplicacion/autenticacion/registrarUsuario.js';
import { crearIniciarSesion } from './aplicacion/autenticacion/iniciarSesion.js';
import { crearProcesarCargaWebhook } from './aplicacion/billetera/procesarCargaWebhook.js';
import { crearIniciarCargaDeSaldo, crearConfirmarCargaDeSaldo } from './aplicacion/billetera/cargarSaldoDesdeWeb.js';
import { crearPasarelaPagosSimulada } from './infra/externos/pasarelaPagosSimulada.js';
import { crearSolicitarViaje } from './aplicacion/viajes/solicitarViaje.js';
import { crearEstimarViaje } from './aplicacion/viajes/estimarViaje.js';
import { crearFinalizarViajeYCobrar } from './aplicacion/viajes/finalizarViajeYCobrar.js';
import { crearReintentarCobro } from './aplicacion/viajes/reintentarCobro.js';
import { crearReintentarCobroOperador } from './aplicacion/viajes/reintentarCobroOperador.js';
import { crearAvanzarEstadoViaje } from './aplicacion/viajes/avanzarEstadoViaje.js';
import { crearCancelarViaje } from './aplicacion/viajes/cancelarViaje.js';
import { crearAceptarOferta } from './aplicacion/viajes/aceptarOferta.js';
import { crearOfrecerAlChoferCercano } from './aplicacion/viajes/ofrecerAlChoferCercano.js';
import { crearRechazarOferta } from './aplicacion/viajes/rechazarOferta.js';
import { crearProcesarOfertasVencidas } from './aplicacion/viajes/procesarOfertasVencidas.js';
import { crearVerificadorWebhookHmac } from './infra/externos/verificadorWebhookHmac.js';
import { crearMetricasProceso } from './infra/observabilidad/metricasProceso.js';
import { crearRecolectorHistorialUbicaciones } from './infra/db/recolectorHistorialUbicaciones.js';
import { crearRepositorioTarifasPostgres } from './infra/db/repositorioTarifasPostgres.js';
import { crearResumenOperativoPostgres } from './infra/db/resumenOperativoPostgres.js';

export function componerAplicacion() {
  const config = leerConfiguracion();
  const logger = pino({ level: config.LOG_LEVEL });
  // Un pool por base, cada uno con el rol de su módulo (tema 12): Viajes no puede conectarse a la base de la billetera.
  const pool = crearPoolPostgres(config, { logger, nombre: 'viajes' });
  const poolBilletera = crearPoolPostgres({ ...config, DATABASE_URL: config.BILLETERA_DATABASE_URL }, { logger, nombre: 'billetera' });
  const poolLectura = crearPoolPostgres({ ...config, DATABASE_URL: config.LECTURA_DATABASE_URL }, { logger, nombre: 'lectura' });
  const proyectorSaldos = crearProyectorSaldosPostgres(poolLectura);
  const proyectorHistorial = crearProyectorHistorialPostgres(poolLectura);
  const usuarios = crearRepositorioUsuariosPostgres(pool);
  const billeteras = crearRepositorioBilleterasPostgres(poolBilletera);
  const viajes = crearRepositorioViajesPostgres(pool);
  const recolectorHistorial = crearRecolectorHistorialUbicaciones({
    pool,
    logger,
    intervaloMs: config.HISTORIAL_UBICACIONES_FLUSH_MS,
    loteMax: config.HISTORIAL_UBICACIONES_LOTE_MAX,
    bufferMax: config.HISTORIAL_UBICACIONES_BUFFER_MAX,
  });
  const choferes = crearRepositorioChoferesPostgres(pool, { recolectorHistorial });
  const hasheador = crearHasheadorArgon2(config);
  const tokens = crearServicioJwt(config);
  const autenticacion = {
    registrarUsuario: crearRegistrarUsuario({ usuarios, hasheador, tokens }),
    iniciarSesion: crearIniciarSesion({ usuarios, hasheador, tokens }),
    buscarUsuarioPorId: usuarios.buscarPorId,
    tokens,
  };
  const procesarCargaWebhook = crearProcesarCargaWebhook({
    verificadorFirma: crearVerificadorWebhookHmac(config.WEBHOOK_HMAC_SECRET), billeteras,
  });
  // Carga desde la web (demo): la pasarela simulada manda el mismo webhook firmado. Apagada en producción salvo que se pida.
  const pasarelaHabilitada = config.PASARELA_SIMULADA_HABILITADA ?? config.NODE_ENV !== 'production';
  const pasarela = crearPasarelaPagosSimulada({ secreto: config.WEBHOOK_HMAC_SECRET, procesarCargaWebhook });
  const billetera = {
    procesarCargaWebhook,
    ...(pasarelaHabilitada && {
      iniciarCargaDeSaldo: crearIniciarCargaDeSaldo({ billeteras }),
      confirmarCargaDeSaldo: crearConfirmarCargaDeSaldo({ billeteras, pasarela }),
    }),
    // CQRS (tema 13): la pantalla lee la proyección; el cobro sigue sumando movimientos en `billetera`.
    consultarSaldoPorPasajero: proyectorSaldos.consultarSaldoPorPasajero,
    // Los movimientos se leen de la base `billetera`, sin proyección (ADR 009).
    listarMovimientosPorPasajero: billeteras.listarMovimientosPorPasajero,
    tokens,
  };
  // El cobro (finalizar y reintentar): el viaje se bloquea en la base de viajes y la billetera cobra en su base (ADR 008).
  const dependenciasCobro = { unidadDeTrabajo: crearUnidadDeTrabajoCobroPostgres(pool), billetera: billeteras, logger };
  const finalizarYCobrar = crearFinalizarViajeYCobrar(dependenciasCobro);
  const reintentarCobro = crearReintentarCobro(dependenciasCobro);
  const unidadDeTrabajoViajes = crearUnidadDeTrabajoViajesPostgres(pool, {
    ofertaTtlSegundos: config.OFERTA_TTL_SEGUNDOS,
    ubicacionTtlSegundos: config.UBICACION_TTL_SEGUNDOS,
  });
  const avanzarEstado = crearAvanzarEstadoViaje({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const cancelarViaje = crearCancelarViaje({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const aceptarOferta = crearAceptarOferta({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const ofrecerAlChoferCercano = crearOfrecerAlChoferCercano({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const rechazarOferta = crearRechazarOferta({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const procesarOfertasVencidas = crearProcesarOfertasVencidas({ unidadDeTrabajo: unidadDeTrabajoViajes });
  const viajesHttp = { solicitarViaje: crearSolicitarViaje({ viajes }), estimarViaje: crearEstimarViaje({ viajes }), buscarViajePropio: viajes.buscarPorIdDelPasajero, ofrecerAlChoferCercano, reintentarCobro, cancelarViaje, listarHistorial: proyectorHistorial.listarPorPasajero, tokens };
  const ofertasHttp = { aceptarOferta, rechazarOferta, tokens };
  const choferesHttp = { cambiarDisponibilidad: choferes.cambiarDisponibilidad, registrarUbicacion: choferes.registrarUbicacion, avanzarEstado, finalizarYCobrar, cancelarViaje, buscarOfertaPendiente: viajes.buscarOfertaPendienteDelChofer, buscarViajeActual: viajes.buscarViajeActualDelChofer, tokens };
  const metricasProceso = crearMetricasProceso();
  const tarifas = crearRepositorioTarifasPostgres(pool);
  const resumenOperativo = crearResumenOperativoPostgres(pool, { ubicacionTtlSegundos: config.UBICACION_TTL_SEGUNDOS ?? null });
  const administracion = {
    establecerHabilitacion: choferes.establecerHabilitacion,
    listarChoferes: choferes.listarParaAdministracion,
    obtenerTarifa: tarifas.obtenerActiva,
    reemplazarTarifa: tarifas.reemplazarActiva,
    obtenerMetricas: async (opciones) => ({ ...metricasProceso.obtenerInstantanea(opciones), negocio: await resumenOperativo.obtener() }),
    tokens,
  };
  const operadorHttp = { listarViajesActivos: viajes.listarViajesActivos, cancelarViaje, reintentarCobro: crearReintentarCobroOperador(dependenciasCobro), tokens };
  const verificarDisponibilidad = () => Promise.all([
    verificarMigracionesAplicadas(pool, DIRECTORIOS_MIGRACIONES.viajes),
    verificarMigracionesAplicadas(poolBilletera, DIRECTORIOS_MIGRACIONES.billetera),
    verificarMigracionesAplicadas(poolLectura, DIRECTORIOS_MIGRACIONES.lectura),
  ]);
  const app = crearApp({ config, logger, verificarDisponibilidad, autenticacion, billetera, viajes: viajesHttp, ofertas: ofertasHttp, choferes: choferesHttp, administracion, operador: operadorHttp, idempotencia: crearRepositorioIdempotenciaPostgres(pool) });
  // Outbox de Viajes: cada UsuarioRegistrado de un pasajero crea su billetera, y cada ViajeCambiado
  // (lo deja el trigger de la migración 006) actualiza el historial en la base `lectura`.
  const despachadores = [
    crearDespachadorOutbox({
      pool, tabla: 'outbox_viajes', logger, intervaloMs: config.OUTBOX_INTERVALO_MS,
      manejar: async (evento) => {
        if (evento.tipo === 'UsuarioRegistrado' && evento.datos.rol === 'pasajero') {
          await billeteras.crearBilleteraPorEvento({ eventoId: evento.id, pasajeroId: evento.datos.usuarioId });
        } else if (evento.tipo === 'ViajeCambiado') {
          await proyectorHistorial.aplicar(evento);
        }
      },
    }),
    // Outbox de la billetera → proyección de saldos en la base `lectura`.
    crearDespachadorOutbox({
      pool: poolBilletera, tabla: 'outbox_billetera', logger, intervaloMs: config.OUTBOX_INTERVALO_MS,
      manejar: (evento) => proyectorSaldos.aplicar(evento),
    }),
  ];
  const despachadorVencimiento = crearDespachadorVencimientoOfertas({
    procesarOfertasVencidas,
    logger,
    intervaloMs: config.OFERTA_VERIFICACION_MS,
  });
  const procesos = [...despachadores, despachadorVencimiento, recolectorHistorial];
  return {
    app, config, logger,
    iniciarProcesos: () => procesos.forEach((p) => p.iniciar()),
    async cerrar() {
      metricasProceso.cerrar();
      await Promise.all(procesos.map((p) => p.detener()));
      await Promise.all([pool.end(), poolBilletera.end(), poolLectura.end()]);
    },
  };
}

