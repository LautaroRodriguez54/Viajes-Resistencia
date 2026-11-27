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
// Carga desde la web: el importe en centavos enteros. Los límites ($ 100 a $ 500.000) los valida el caso de uso.
const nuevaCarga = z.object({ importeCentavos: z.number().int().positive().max(2_000_000_000) }).strict();

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
  iniciarCargaDeSaldo,
  confirmarCargaDeSaldo,
  idempotente = () => (_req, _res, next) => next(),
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

  // Carga de saldo desde la web con la pasarela de pagos simulada. Sólo se monta si la composición
  // la arma (PASARELA_SIMULADA_HABILITADA): sin ella, la única carga es el webhook del proveedor.
  if (iniciarCargaDeSaldo && confirmarCargaDeSaldo) {
    router.post('/me/cargas', requiereAutenticacion(tokens), soloPasajero, idempotente('billetera.iniciar_carga'), async (req, res) => {
      const cuerpo = nuevaCarga.safeParse(req.body);
      if (!cuerpo.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El importe de la carga es inválido.');
      const carga = await iniciarCargaDeSaldo({ pasajeroId: req.autenticacion.usuarioId, importeCentavos: cuerpo.data.importeCentavos });
      res.status(201).json({ carga });
    });

    router.post('/me/cargas/:cargaId/pagar', requiereAutenticacion(tokens), soloPasajero, idempotente('billetera.pagar_carga'), async (req, res) => {
      if (!z.string().uuid().safeParse(req.params.cargaId).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Identificador de carga inválido.');
      const carga = await confirmarCargaDeSaldo({ intencionId: req.params.cargaId, pasajeroId: req.autenticacion.usuarioId });
      res.status(200).json({ carga });
    });
  }

  return router;
}

