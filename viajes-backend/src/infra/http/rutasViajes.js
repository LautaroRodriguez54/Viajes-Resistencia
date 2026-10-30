import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';

const punto = z.object({ latitud: z.number().gte(-90).lte(90), longitud: z.number().gte(-180).lte(180) }).strict();
const solicitud = z.object({ origen: punto, destino: punto }).strict();

function soloPasajero(req) {
  if (req.autenticacion.rol !== Rol.PASAJERO) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Sólo un pasajero puede solicitar viajes.');
}

export function crearRutasViajes({ solicitarViaje, buscarViajePropio, ofrecerAlChoferCercano, tokens }) {
  const router = express.Router();
  router.post('/', requiereAutenticacion(tokens), async (req, res) => {
    soloPasajero(req);
    const validacion = solicitud.safeParse(req.body);
    if (!validacion.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Origen o destino inválidos.');
    const datos = validacion.data;
    const viaje = await solicitarViaje({ pasajeroId: req.autenticacion.usuarioId, ...datos });
    res.status(201).json({ viaje });
  });
  router.get('/:viajeId', requiereAutenticacion(tokens), async (req, res) => {
    soloPasajero(req);
    const viaje = await buscarViajePropio(req.params.viajeId, req.autenticacion.usuarioId);
    if (!viaje) throw new ErrorDeDominio('RECURSO_NO_ENCONTRADO', 'El viaje no existe o no pertenece al pasajero.');
    res.status(200).json({ viaje });
  });
  router.post('/:viajeId/ofertas', requiereAutenticacion(tokens), async (req, res) => {
    soloPasajero(req);
    if (!z.string().uuid().safeParse(req.params.viajeId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    res.status(201).json(await ofrecerAlChoferCercano(req.params.viajeId, req.autenticacion.usuarioId));
  });
  return router;
}

