import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';
export function crearRutasOfertas({ aceptarOferta, tokens }) {
  const router = express.Router();
  router.post('/:ofertaId/aceptar', requiereAutenticacion(tokens), async (req, res) => {
    if (req.autenticacion.rol !== Rol.CHOFER) throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Sólo un chofer puede aceptar una oferta.');
    if (!z.string().uuid().safeParse(req.params.ofertaId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de oferta inválido.');
    res.status(200).json(await aceptarOferta(req.params.ofertaId, req.autenticacion.usuarioId));
  });
  return router;
}
