import pino from 'pino';
import { leerConfiguracion } from './config/env.js';
import { crearPoolPostgres, verificarPostgres } from './infra/db/postgres.js';
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
import { crearSolicitarViaje } from './aplicacion/viajes/solicitarViaje.js';
import { crearFinalizarViajeYCobrar } from './aplicacion/viajes/finalizarViajeYCobrar.js';
import { crearReintentarCobro } from './aplicacion/viajes/reintentarCobro.js';
import { crearReintentarCobroOperador } from './aplicacion/viajes/reintentarCobroOperador.js';
import { crearAvanzarEstadoViaje } from './aplicacion/viajes/avanzarEstadoViaje.js';
import { crearCancelarViaje } from './aplicacion/viajes/cancelarViaje.js';
import { crearVerificadorWebhookHmac } from './infra/externos/verificadorWebhookHmac.js';

export function componerAplicacion() {
  const config = leerConfiguracion();
  const logger = pino({ level: config.LOG_LEVEL });
  // Un pool por base, cada uno con el rol de su módulo (tema 12): Viajes no puede conectarse a la base de la billetera.
  const pool = crearPoolPostgres(config);
  const poolBilletera = crearPoolPostgres({ ...config, DATABASE_URL: config.BILLETERA_DATABASE_URL });
  const poolLectura = crearPoolPostgres({ ...config, DATABASE_URL: config.LECTURA_DATABASE_URL });
  const proyectorSaldos = crearProyectorSaldosPostgres(poolLectura);
  const proyectorHistorial = crearProyectorHistorialPostgres(poolLectura);
  const usuarios = crearRepositorioUsuariosPostgres(pool);
  const billeteras = crearRepositorioBilleterasPostgres(poolBilletera);
  const viajes = crearRepositorioViajesPostgres(pool, {
    ofertaTtlSegundos: config.OFERTA_TTL_SEGUNDOS,
    ubicacionTtlSegundos: config.UBICACION_TTL_SEGUNDOS,
  });
  const choferes = crearRepositorioChoferesPostgres(pool);
  const hasheador = crearHasheadorArgon2(config);
  const tokens = crearServicioJwt(config);
  const autenticacion = {
    registrarUsuario: crearRegistrarUsuario({ usuarios, hasheador, tokens }),
    iniciarSesion: crearIniciarSesion({ usuarios, hasheador, tokens }),
    buscarUsuarioPorId: usuarios.buscarPorId,
    tokens,
  };
  const billetera = {
    procesarCargaWebhook: crearProcesarCargaWebhook({
      verificadorFirma: crearVerificadorWebhookHmac(config.WEBHOOK_HMAC_SECRET), billeteras,
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
  const viajesHttp = { solicitarViaje: crearSolicitarViaje({ viajes }), buscarViajePropio: viajes.buscarPorIdDelPasajero, ofrecerAlChoferCercano: viajes.ofrecerAlChoferCercano, reintentarCobro, cancelarViaje, listarHistorial: proyectorHistorial.listarPorPasajero, tokens };
  const ofertasHttp = { aceptarOferta: viajes.aceptarOferta, rechazarOferta: viajes.rechazarOferta, tokens };
  const choferesHttp = { cambiarDisponibilidad: choferes.cambiarDisponibilidad, registrarUbicacion: choferes.registrarUbicacion, avanzarEstado, finalizarYCobrar, cancelarViaje, buscarOfertaPendiente: viajes.buscarOfertaPendienteDelChofer, buscarViajeActual: viajes.buscarViajeActualDelChofer, tokens };
  const administracion = { establecerHabilitacion: choferes.establecerHabilitacion, tokens };
  const operadorHttp = { listarViajesActivos: viajes.listarViajesActivos, cancelarViaje, reintentarCobro: crearReintentarCobroOperador(dependenciasCobro), tokens };
  const app = crearApp({ config, logger, verificarDisponibilidad: () => Promise.all([pool, poolBilletera, poolLectura].map(verificarPostgres)), autenticacion, billetera, viajes: viajesHttp, ofertas: ofertasHttp, choferes: choferesHttp, administracion, operador: operadorHttp, idempotencia: crearRepositorioIdempotenciaPostgres(pool) });
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
    procesarOfertasVencidas: viajes.procesarOfertasVencidas,
    logger,
    intervaloMs: config.OFERTA_VERIFICACION_MS,
  });
  const procesos = [...despachadores, despachadorVencimiento];
  return {
    app, config, logger,
    iniciarProcesos: () => procesos.forEach((p) => p.iniciar()),
    async cerrar() {
      await Promise.all(procesos.map((p) => p.detener()));
      await Promise.all([pool.end(), poolBilletera.end(), poolLectura.end()]);
    },
  };
}

