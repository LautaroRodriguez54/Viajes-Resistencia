import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';

const disponibilidad = z.object({ disponible: z.boolean() }).strict();
const ubicacion = z.object({ latitud: z.number().gte(-90).lte(90), longitud: z.number().gte(-180).lte(180) }).strict();

function soloChofer(req) {
  if (req.autenticacion.rol !== Rol.CHOFER) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Esta operación es exclusiva de choferes.');
}
function validar(schema, body) {
  const resultado = schema.safeParse(body);
  if (!resultado.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La entrada no cumple el formato requerido.');
  return resultado.data;
}
export function crearRutasChoferes({ cambiarDisponibilidad, registrarUbicacion, avanzarEstado, finalizarYCobrar, tokens }) {
  const router = express.Router();
  router.put('/me/disponibilidad', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    res.status(200).json(await cambiarDisponibilidad(req.autenticacion.usuarioId, validar(disponibilidad, req.body).disponible));
  });
  router.put('/me/ubicacion', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req);
    res.status(200).json(await registrarUbicacion(req.autenticacion.usuarioId, validar(ubicacion, req.body)));
  });
  router.post('/viajes/:viajeId/estado', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req); const id = z.string().uuid().parse(req.params.viajeId); const estado = z.enum(['chofer_en_camino', 'en_curso']).parse(req.body?.estado);
    res.status(200).json(await avanzarEstado(id, req.autenticacion.usuarioId, estado));
  });
  router.post('/viajes/:viajeId/finalizar', requiereAutenticacion(tokens), async (req, res) => {
    soloChofer(req); const id = z.string().uuid().parse(req.params.viajeId);
    res.status(200).json(await finalizarYCobrar(id, req.autenticacion.usuarioId));
  });
  return router;
}

