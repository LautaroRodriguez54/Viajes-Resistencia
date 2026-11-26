import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';

const disponibilidad = z.object({ disponible: z.boolean() }).strict();
const ubicacion = z.object({ latitud: z.number().gte(-90).lte(90), longitud: z.number().gte(-180).lte(180) }).strict();
const uuid = z.string().uuid();
const cambioEstado = z.object({ estado: z.enum(['chofer_en_camino', 'en_curso']) }).strict();

function soloChofer(req) {
  if (req.autenticacion.rol !== Rol.CHOFER) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Esta operación es exclusiva de choferes.');
}
function validar(schema, body) {
  const resultado = schema.safeParse(body);
  if (!resultado.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La entrada no cumple el formato requerido.');
  return resultado.data;
}
export function crearRutasChoferes({
  cambiarDisponibilidad,
  registrarUbicacion,
  avanzarEstado,
  finalizarYCobrar,
  buscarOfertaPendiente,
  buscarViajeActual,
  tokens,
  idempotente,
  limitadorUbicacion = (_req, _res, next) => next(),
}) {
  const router = express.Router();
  // Lecturas para la web: devuelven null (y no 404) cuando no hay nada, porque se consultan cada 2 s.
  router.get('/me/ofertas', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    res.status(200).json({ oferta: await buscarOfertaPendiente(req.autenticacion.usuarioId) });
  });
  router.get('/me/viaje-actual', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    res.status(200).json({ viaje: await buscarViajeActual(req.autenticacion.usuarioId) });
  });
  router.put('/me/disponibilidad', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    res.status(200).json(await cambiarDisponibilidad(req.autenticacion.usuarioId, validar(disponibilidad, req.body).disponible));
  });
  router.put('/me/ubicacion', requiereAutenticacion(tokens), limitadorUbicacion, async (req, res) => {
    soloChofer(req);
    res.status(200).json(await registrarUbicacion(req.autenticacion.usuarioId, validar(ubicacion, req.body)));
  });
  router.post('/viajes/:viajeId/estado', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    const id = validar(uuid, req.params.viajeId);
    const { estado } = validar(cambioEstado, req.body);
    res.status(200).json(await avanzarEstado(id, req.autenticacion.usuarioId, estado));
  });
  router.post('/viajes/:viajeId/finalizar', requiereAutenticacion(tokens), idempotente('choferes.finalizar'), async (req, res) => {
    soloChofer(req);
    const id = validar(uuid, req.params.viajeId);
    res.status(200).json(await finalizarYCobrar({ viajeId: id, choferId: req.autenticacion.usuarioId }));
  });
  return router;
}

