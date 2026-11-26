import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';

const disponibilidad = z.object({ disponible: z.boolean() }).strict();
const ubicacion = z.object({ latitud: z.number().gte(-90).lte(90), longitud: z.number().gte(-180).lte(180) }).strict();
const uuid = z.string().uuid();
const cambioEstado = z.object({ estado: z.enum(['chofer_en_camino', 'en_curso']) }).strict();
const cancelacionOpcional = z.object({ motivo: z.string().trim().min(1).max(200).optional() }).strict();

const soloChofer = requiereRol(Rol.CHOFER, 'Esta operación es exclusiva de choferes.');
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
  cancelarViaje,
  buscarOfertaPendiente,
  buscarViajeActual,
  tokens,
  idempotente,
  limitadorUbicacion = (_req, _res, next) => next(),
}) {
  const router = express.Router();
  // Lecturas para la web: devuelven null (y no 404) cuando no hay nada, porque se consultan cada 2 s.
  router.get('/me/ofertas', requiereAutenticacion(tokens), soloChofer, async (req, res) => {
    res.status(200).json({ oferta: await buscarOfertaPendiente(req.autenticacion.usuarioId) });
  });
  router.get('/me/viaje-actual', requiereAutenticacion(tokens), soloChofer, async (req, res) => {
    res.status(200).json({ viaje: await buscarViajeActual(req.autenticacion.usuarioId) });
  });
  router.put('/me/disponibilidad', requiereAutenticacion(tokens), soloChofer, async (req, res) => {
    res.status(200).json(await cambiarDisponibilidad(req.autenticacion.usuarioId, validar(disponibilidad, req.body).disponible));
  });
  router.put('/me/ubicacion', requiereAutenticacion(tokens), soloChofer, limitadorUbicacion, async (req, res) => {
    res.status(200).json(await registrarUbicacion(req.autenticacion.usuarioId, validar(ubicacion, req.body)));
  });
  router.post('/viajes/:viajeId/estado', requiereAutenticacion(tokens), soloChofer, async (req, res) => {
    const id = validar(uuid, req.params.viajeId);
    const { estado } = validar(cambioEstado, req.body);
    res.status(200).json(await avanzarEstado(id, req.autenticacion.usuarioId, estado));
  });
  router.post('/viajes/:viajeId/finalizar', requiereAutenticacion(tokens), soloChofer, idempotente('choferes.finalizar'), async (req, res) => {
    const id = validar(uuid, req.params.viajeId);
    res.status(200).json(await finalizarYCobrar({ viajeId: id, choferId: req.autenticacion.usuarioId }));
  });
  router.post('/viajes/:viajeId/cancelar', requiereAutenticacion(tokens), soloChofer, idempotente('choferes.cancelar_viaje'), async (req, res) => {
    const id = validar(uuid, req.params.viajeId);
    const { motivo } = validar(cancelacionOpcional, req.body ?? {});
    res.status(200).json(await cancelarViaje({
      viajeId: id,
      actorId: req.autenticacion.usuarioId,
      rol: Rol.CHOFER,
      motivo: motivo ?? null,
    }));
  });
  return router;
}

