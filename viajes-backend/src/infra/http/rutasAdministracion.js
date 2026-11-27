import express from 'express';
import { z } from 'zod';
import { ErrorDeDominio } from '../../dominio/errores.js';
import { Rol } from '../../dominio/usuarios/roles.js';
import { requiereAutenticacion, requiereRol } from './autenticacion.js';
const body = z.object({ habilitado: z.boolean() }).strict();
const soloAdministrador = requiereRol(Rol.ADMINISTRADOR, 'Sólo un administrador puede acceder a esta operación.');
const reiniciarQuery = z.enum(['true', 'false']).optional();
const listadoChoferesQuery = z.object({
  estado: z.enum(['pendientes', 'todos']).default('pendientes'),
  limite: z.coerce.number().int().min(1).max(50).default(50),
}).strict();
// Centavos enteros (nunca float). Tope de $ 1.000.000 por componente: alcanza de sobra y evita
// valores absurdos que después romperían la estimación.
const centavos = z.number().int().min(0).max(100_000_000);
const tarifaBody = z.object({
  baseCentavos: centavos,
  porKilometroCentavos: centavos,
  porMinutoCentavos: centavos,
  maximoViajeCentavos: centavos.min(1),
  velocidadPromedioKmh: z.number().int().min(1).max(120).optional(),
}).strict().refine((t) => t.maximoViajeCentavos >= t.baseCentavos, {
  message: 'El máximo por viaje no puede ser menor que la base.',
});

const sinIdempotencia = () => (_req, _res, next) => next();

export function crearRutasAdministracion({
  establecerHabilitacion,
  listarChoferes = async () => [],
  obtenerTarifa,
  reemplazarTarifa,
  obtenerMetricas = () => ({}),
  tokens,
  idempotente = sinIdempotencia,
}) {
  const router = express.Router();
  router.get('/choferes', requiereAutenticacion(tokens), soloAdministrador, async (req, res) => {
    const parsed = listadoChoferesQuery.safeParse(req.query ?? {});
    if (!parsed.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Parámetros de listado inválidos.');
    const choferes = await listarChoferes({ soloPendientes: parsed.data.estado === 'pendientes', limite: parsed.data.limite });
    res.status(200).json({ choferes });
  });
  router.patch('/choferes/:choferId/habilitacion', requiereAutenticacion(tokens), soloAdministrador, async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.choferId).success || !body.safeParse(req.body).success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Datos de habilitación inválidos.');
    res.status(200).json(await establecerHabilitacion(req.params.choferId, req.body.habilitado));
  });
  router.get('/tarifa', requiereAutenticacion(tokens), soloAdministrador, async (_req, res) => {
    res.status(200).json({ tarifa: await obtenerTarifa() });
  });
  // Crea una tarifa nueva activa (la anterior queda en el historial). Idempotente: un reintento con
  // la misma clave no crea otra fila.
  router.post('/tarifa', requiereAutenticacion(tokens), soloAdministrador, idempotente('admin.reemplazar_tarifa'), async (req, res) => {
    const parsed = tarifaBody.safeParse(req.body);
    if (!parsed.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'Tarifa inválida: centavos enteros y el máximo no puede ser menor que la base.');
    res.status(201).json({ tarifa: await reemplazarTarifa(parsed.data) });
  });
  router.get('/metricas', requiereAutenticacion(tokens), soloAdministrador, (req, res) => {
    const parsed = reiniciarQuery.safeParse(req.query?.reiniciar);
    if (!parsed.success) throw new ErrorDeDominio('ENTRADA_INVALIDA', 'El parámetro reiniciar debe ser true o false.');
    res.status(200).json(obtenerMetricas({ reiniciar: parsed.data === 'true' }));
  });
  return router;
}
