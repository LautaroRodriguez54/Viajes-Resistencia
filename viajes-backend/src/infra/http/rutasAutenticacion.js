import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { aUsuarioPublico } from '../../aplicacion/autenticacion/iniciarSesion.js';
import { requiereAutenticacion } from './autenticacion.js';

const credenciales = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict();

const registro = credenciales.extend({
  rol: z.enum([Rol.PASAJERO, Rol.CHOFER]),
  vehiculo: z.object({
    patente: z.string().trim().min(4).max(16),
    marca: z.string().trim().min(1).max(60),
    modelo: z.string().trim().min(1).max(60),
  }).strict().optional(),
}).superRefine((datos, contexto) => {
  if (datos.rol === Rol.CHOFER && !datos.vehiculo) {
    contexto.addIssue({ code: 'custom', path: ['vehiculo'], message: 'Los datos del vehículo son obligatorios para un chofer.' });
  }
  if (datos.rol === Rol.PASAJERO && datos.vehiculo) {
    contexto.addIssue({ code: 'custom', path: ['vehiculo'], message: 'Un pasajero no registra vehículo.' });
  }
});

function validar(schema, body) {
  const resultado = schema.safeParse(body);
  if (!resultado.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La entrada no cumple el formato requerido.');
  return resultado.data;
}

export function crearRutasAutenticacion({ registrarUsuario, iniciarSesion, buscarUsuarioPorId, tokens }) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    const resultado = await registrarUsuario(validar(registro, req.body));
    res.status(201).json(resultado);
  });

  router.post('/login', async (req, res) => {
    const resultado = await iniciarSesion(validar(credenciales, req.body));
    res.status(200).json(resultado);
  });

  router.get('/me', requiereAutenticacion(tokens), async (req, res) => {
    const usuario = await buscarUsuarioPorId(req.autenticacion.usuarioId);
    if (!usuario) throw new ErrorDeDominio('TOKEN_INVALIDO', 'El usuario del token no existe.');
    res.status(200).json({ usuario: aUsuarioPublico(usuario) });
  });

  return router;
}

