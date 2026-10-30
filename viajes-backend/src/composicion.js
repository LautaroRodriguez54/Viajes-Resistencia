import pino from 'pino';
import { leerConfiguracion } from './config/env.js';
import { crearPoolPostgres, verificarPostgres } from './infra/db/postgres.js';
import { crearRepositorioUsuariosPostgres } from './infra/db/repositorioUsuariosPostgres.js';
import { crearRepositorioBilleterasPostgres } from './infra/db/repositorioBilleterasPostgres.js';
import { crearRepositorioViajesPostgres } from './infra/db/repositorioViajesPostgres.js';
import { crearRepositorioChoferesPostgres } from './infra/db/repositorioChoferesPostgres.js';
import { crearHasheadorArgon2 } from './infra/autenticacion/contrasenasArgon2.js';
import { crearServicioJwt } from './infra/autenticacion/tokensJwt.js';
import { crearApp } from './infra/http/app.js';
import { crearRegistrarUsuario } from './aplicacion/autenticacion/registrarUsuario.js';
import { crearIniciarSesion } from './aplicacion/autenticacion/iniciarSesion.js';
import { crearProcesarCargaWebhook } from './aplicacion/billetera/procesarCargaWebhook.js';
import { crearSolicitarViaje } from './aplicacion/viajes/solicitarViaje.js';
import { crearVerificadorWebhookHmac } from './infra/externos/verificadorWebhookHmac.js';

export function componerAplicacion() {
  const config = leerConfiguracion();
  const logger = pino({ level: config.LOG_LEVEL });
  const pool = crearPoolPostgres(config);
  const usuarios = crearRepositorioUsuariosPostgres(pool);
  const billeteras = crearRepositorioBilleterasPostgres(pool);
  const viajes = crearRepositorioViajesPostgres(pool);
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
    consultarSaldoPorPasajero: billeteras.consultarSaldoPorPasajero,
    tokens,
  };
  const viajesHttp = { solicitarViaje: crearSolicitarViaje({ viajes }), buscarViajePropio: viajes.buscarPorIdDelPasajero, ofrecerAlChoferCercano: viajes.ofrecerAlChoferCercano, tokens };
  const ofertasHttp = { aceptarOferta: viajes.aceptarOferta, tokens };
  const choferesHttp = { cambiarDisponibilidad: choferes.cambiarDisponibilidad, registrarUbicacion: choferes.registrarUbicacion, avanzarEstado: viajes.avanzarEstado, finalizarYCobrar: viajes.finalizarYCobrar, tokens };
  const administracion = { establecerHabilitacion: choferes.establecerHabilitacion, tokens };
  const app = crearApp({ config, logger, verificarDisponibilidad: () => verificarPostgres(pool), autenticacion, billetera, viajes: viajesHttp, ofertas: ofertasHttp, choferes: choferesHttp, administracion });
  return { app, config, logger, cerrar: () => pool.end() };
}

