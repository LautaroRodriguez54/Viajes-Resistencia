import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';

const cargaWebhook = z.object({
  eventoExternoId: z.string().trim().min(1).max(128),
  pasajeroId: z.string().uuid(),
  importeCentavos: z.number().int().positive().max(2_000_000_000),
}).strict();

// Paginación simple: sólo los últimos N (1 a 50, 20 por defecto). Un listado sin tope es un
// hallazgo fácil en el ataque cruzado.
const listado = z.object({ limite: z.coerce.number().int().min(1).max(50).default(20) }).strict();

function validarCarga(body) {
  const resultado = cargaWebhook.safeParse(body);
  if (!resultado.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'La carga de billetera es inválida.');
  return resultado.data;
}

export function crearRutasBilletera({
  procesarCargaWebhook,
  consultarSaldoPorPasajero,
  listarMovimientosPorPasajero,
  tokens,
  limitadorWebhook = (_req, _res, next) => next(),
}) {
  const router = express.Router();

  router.post('/webhooks/cargas', limitadorWebhook, async (req, res) => {
    const resultado = await procesarCargaWebhook({
      firma: req.get('x-webhook-signature'),
      cuerpoCrudo: req.cuerpoCrudo,
      carga: validarCarga(req.body),
    });
    res.status(resultado.duplicado ? 200 : 201).json(resultado);
  });

  const soloPasajero = requiereRol(Rol.PASAJERO, 'Sólo un pasajero puede consultar su billetera.');

  router.get('/me', requiereAutenticacion(tokens), soloPasajero, async (req, res) => {
    res.status(200).json(await consultarSaldoPorPasajero(req.autenticacion.usuarioId));
  });

  // Lee la base `billetera` (fuente de verdad), no una proyección: los movimientos se ven sin atraso.
  router.get('/me/movimientos', requiereAutenticacion(tokens), soloPasajero, async (req, res) => {
    const consulta = listado.safeParse(req.query);
    if (!consulta.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Parámetros de consulta inválidos.');
    const movimientos = await listarMovimientosPorPasajero(req.autenticacion.usuarioId, consulta.data);
    res.status(200).json({ movimientos });
  });

  return router;
}

