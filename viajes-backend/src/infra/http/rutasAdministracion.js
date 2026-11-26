import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';
const body = z.object({ habilitado: z.boolean() }).strict();
const soloAdministrador = requiereRol(Rol.ADMINISTRADOR, 'Sólo un administrador puede habilitar choferes.');
export function crearRutasAdministracion({ establecerHabilitacion, tokens }) {
  const router = express.Router();
  router.patch('/choferes/:choferId/habilitacion', requiereAutenticacion(tokens), soloAdministrador, async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.choferId).success || !body.safeParse(req.body).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Datos de habilitación inválidos.');
    res.status(200).json(await establecerHabilitacion(req.params.choferId, req.body.habilitado));
  });
  return router;
}
