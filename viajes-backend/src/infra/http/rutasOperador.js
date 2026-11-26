import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';

const uuid = z.string().uuid();
const cancelacionOperador = z.object({ motivo: z.string().trim().min(3).max(200) }).strict();

function soloOperador(req) {
  if (req.autenticacion.rol !== Rol.OPERADOR) {
    throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Esta operación es exclusiva de operadores.');
  }
}

export function crearRutasOperador({ listarViajesActivos, cancelarViaje, reintentarCobro, tokens, idempotente }) {
  const router = express.Router();
  router.get('/viajes', requiereAutenticacion(tokens), async (req, res) => {
    soloOperador(req);
    const estado = req.query.estado ?? 'activos';
    if (estado !== 'activos') {
      throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Sólo se admite el filtro estado=activos.');
    }
    res.status(200).json({ viajes: await listarViajesActivos() });
  });
  router.post('/viajes/:viajeId/cancelar', requiereAutenticacion(tokens), idempotente('operador.cancelar_viaje'), async (req, res) => {
    soloOperador(req);
    if (!uuid.safeParse(req.params.viajeId).success) {
      throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    }
    const cuerpo = cancelacionOperador.safeParse(req.body);
    if (!cuerpo.success) {
      throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El motivo de cancelación es obligatorio (3 a 200 caracteres).');
    }
    res.status(200).json(await cancelarViaje({
      viajeId: req.params.viajeId,
      actorId: req.autenticacion.usuarioId,
      rol: Rol.OPERADOR,
      motivo: cuerpo.data.motivo,
    }));
  });
  router.post('/viajes/:viajeId/reintentar-cobro', requiereAutenticacion(tokens), idempotente('operador.reintentar_cobro'), async (req, res) => {
    soloOperador(req);
    if (!uuid.safeParse(req.params.viajeId).success) {
      throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de viaje inválido.');
    }
    res.status(200).json(await reintentarCobro({ viajeId: req.params.viajeId }));
  });
  return router;
}
