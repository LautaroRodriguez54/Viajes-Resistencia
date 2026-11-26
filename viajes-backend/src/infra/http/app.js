import cors from 'cors';
import express from 'express';
import { crearCabecerasSeguridad } from './cabecerasSeguridad.js';
import { contexto, crearContextoPorPedido } from './contexto.js';
import { manejadorDeErrores } from './errores.js';
import { crearLimitadores } from './limitadorTasa.js';
import { crearRutasAutenticacion } from './rutasAutenticacion.js';
import { crearRutasBilletera } from './rutasBilletera.js';
import { crearRutasViajes } from './rutasViajes.js';
import { crearRutasChoferes } from './rutasChoferes.js';
import { crearRutasAdministracion } from './rutasAdministracion.js';
import { crearRutasOfertas } from './rutasOfertas.js';

export function crearApp({ config, logger, verificarDisponibilidad, autenticacion, billetera, viajes, ofertas, choferes, administracion }) {
  const app = express();
  const limitadores = crearLimitadores(config);

  app.disable('x-powered-by');
  app.use(crearContextoPorPedido(logger));
  app.use(crearCabecerasSeguridad());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: '100kb', strict: true, verify: (req, _res, buffer) => { req.cuerpoCrudo = Buffer.from(buffer); } }));

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/ready', async (_req, res) => {
    await verificarDisponibilidad();
    res.status(200).json({ ok: true });
  });

  app.use('/auth', crearRutasAutenticacion({ ...autenticacion, limitadorLogin: limitadores.login }));
  app.use('/billetera', crearRutasBilletera({ ...billetera, limitadorWebhook: limitadores.webhook }));
  app.use('/viajes', crearRutasViajes(viajes));
  app.use('/ofertas', crearRutasOfertas(ofertas));
  app.use('/choferes', crearRutasChoferes({ ...choferes, limitadorUbicacion: limitadores.ubicacion }));
  app.use('/admin', crearRutasAdministracion(administracion));
  // TODO: montar rutas de habilitación, ofertas, asignación, SSE y finalización/cobro.
  app.use((_req, res) => {
    const requestId = contexto.getStore()?.requestId;
    res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA', requestId } });
  });
  app.use(manejadorDeErrores(logger));
  return app;
}
