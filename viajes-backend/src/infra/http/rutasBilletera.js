import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion } from './autenticacion.js';

const cargaWebhook = z.object({
  eventoExternoId: z.string().trim().min(1).max(128),
  pasajeroId: z.string().uuid(),
  importeCentavos: z.number().int().positive().max(2_000_000_000),
}).strict();

function validarCarga(body) {
  const resultado = cargaWebhook.safeParse(body);
  if (!resultado.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La carga de billetera es inválida.');
  return resultado.data;
}

export function crearRutasBilletera({ procesarCargaWebhook, consultarSaldoPorPasajero, tokens }) {
  const router = express.Router();

  router.post('/webhooks/cargas', async (req, res) => {
    const resultado = await procesarCargaWebhook({
      firma: req.get('x-webhook-signature'),
      cuerpoCrudo: req.cuerpoCrudo,
      carga: validarCarga(req.body),
    });
    res.status(resultado.duplicado ? 200 : 201).json(resultado);
  });

  router.get('/me', requiereAutenticacion(tokens), async (req, res) => {
    if (req.autenticacion.rol !== Rol.PASAJERO) {
      throw new ErrorDeDominio('RECURSO_PROHIBIDO', 'Sólo un pasajero puede consultar su billetera.');
    }
    res.status(200).json(await consultarSaldoPorPasajero(req.autenticacion.usuarioId));
  });

  return router;
}

