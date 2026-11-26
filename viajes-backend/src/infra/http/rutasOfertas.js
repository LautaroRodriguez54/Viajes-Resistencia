import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';

export function crearRutasOfertas({ aceptarOferta, rechazarOferta, tokens, idempotente }) {
  const router = express.Router();
  router.post(
    '/:ofertaId/aceptar',
    requiereAutenticacion(tokens),
    requiereRol(Rol.CHOFER, 'Sólo un chofer puede aceptar una oferta.'),
    idempotente('ofertas.aceptar'),
    async (req, res) => {
      if (!z.string().uuid().safeParse(req.params.ofertaId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de oferta inválido.');
      res.status(200).json(await aceptarOferta(req.params.ofertaId, req.autenticacion.usuarioId));
    },
  );
  router.post(
    '/:ofertaId/rechazar',
    requiereAutenticacion(tokens),
    requiereRol(Rol.CHOFER, 'Sólo un chofer puede rechazar una oferta.'),
    idempotente('ofertas.rechazar'),
    async (req, res) => {
      if (!z.string().uuid().safeParse(req.params.ofertaId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de oferta inválido.');
      res.status(200).json(await rechazarOferta(req.params.ofertaId, req.autenticacion.usuarioId));
    },
  );
  return router;
}
