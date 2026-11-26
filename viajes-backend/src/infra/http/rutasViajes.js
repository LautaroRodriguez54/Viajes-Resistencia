import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';

const punto = z.object({ latitud: z.number().gte(-90).lte(90), longitud: z.number().gte(-180).lte(180) }).strict();
const solicitud = z.object({ origen: punto, destino: punto }).strict();
const listado = z.object({ limite: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const cancelacionOpcional = z.object({ motivo: z.string().trim().min(1).max(200).optional() }).strict();

const soloPasajero = requiereRol(Rol.PASAJERO, 'Sólo un pasajero puede solicitar viajes.');

export function crearRutasViajes({ solicitarViaje, buscarViajePropio, ofrecerAlChoferCercano, reintentarCobro, cancelarViaje, listarHistorial, tokens, idempotente }) {
  const router = express.Router();
  router.post('/', requiereAutenticacion(tokens), soloPasajero, idempotente('viajes.solicitar'), async (req, res) => {
    const validacion = solicitud.safeParse(req.body);
    if (!validacion.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Origen o destino inválidos.');
    const datos = validacion.data;
    const viaje = await solicitarViaje({ pasajeroId: req.autenticacion.usuarioId, ...datos });
    res.status(201).json({ viaje });
  });
  // Historial del pasajero (tema 13): sale de la proyección historial_viajes en la base `lectura`,
  // así que puede estar unos milisegundos atrasado. El estado de un viaje en curso se lee con GET /:viajeId.
  router.get('/', requiereAutenticacion(tokens), soloPasajero, async (req, res) => {
    const consulta = listado.safeParse(req.query);
    if (!consulta.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Parámetros de consulta inválidos.');
    res.status(200).json({ viajes: await listarHistorial(req.autenticacion.usuarioId, consulta.data) });
  });
  router.get('/:viajeId', requiereAutenticacion(tokens), soloPasajero, async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.viajeId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    const viaje = await buscarViajePropio(req.params.viajeId, req.autenticacion.usuarioId);
    if (!viaje) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
    res.status(200).json({ viaje });
  });
  router.post('/:viajeId/ofertas', requiereAutenticacion(tokens), soloPasajero, idempotente('viajes.ofrecer'), async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.viajeId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    res.status(201).json(await ofrecerAlChoferCercano(req.params.viajeId, req.autenticacion.usuarioId));
  });
  router.post('/:viajeId/reintentar-cobro', requiereAutenticacion(tokens), soloPasajero, idempotente('viajes.reintentar_cobro'), async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.viajeId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    res.status(200).json(await reintentarCobro({ viajeId: req.params.viajeId, pasajeroId: req.autenticacion.usuarioId }));
  });
  router.post('/:viajeId/cancelar', requiereAutenticacion(tokens), soloPasajero, idempotente('viajes.cancelar_pasajero'), async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.viajeId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    const cuerpo = cancelacionOpcional.safeParse(req.body ?? {});
    if (!cuerpo.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Datos de cancelación inválidos.');
    res.status(200).json(await cancelarViaje({
      viajeId: req.params.viajeId,
      actorId: req.autenticacion.usuarioId,
      rol: Rol.PASAJERO,
      motivo: cuerpo.data.motivo ?? null,
    }));
  });
  return router;
}

