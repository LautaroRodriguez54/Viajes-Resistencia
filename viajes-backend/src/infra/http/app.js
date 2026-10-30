import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { contextoPorPedido } from './contexto.js';
import { manejadorDeErrores } from './errores.js';
import { crearRutasAutenticacion } from './rutasAutenticacion.js';
import { crearRutasBilletera } from './rutasBilletera.js';
import { crearRutasViajes } from './rutasViajes.js';
import { crearRutasChoferes } from './rutasChoferes.js';
import { crearRutasAdministracion } from './rutasAdministracion.js';
import { crearRutasOfertas } from './rutasOfertas.js';

export function crearApp({ config, logger, verificarDisponibilidad, autenticacion, billetera, viajes, ofertas, choferes, administracion }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(express.json({ limit: '100kb', strict: true, verify: (req, _res, buffer) => { req.cuerpoCrudo = Buffer.from(buffer); } }));
  app.use(contextoPorPedido);

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/ready', async (_req, res) => {
    await verificarDisponibilidad();
    res.status(200).json({ ok: true });
  });

  app.use('/auth', crearRutasAutenticacion(autenticacion));
  app.use('/billetera', crearRutasBilletera(billetera));
  app.use('/viajes', crearRutasViajes(viajes));
  app.use('/ofertas', crearRutasOfertas(ofertas));
  app.use('/choferes', crearRutasChoferes(choferes));
  app.use('/admin', crearRutasAdministracion(administracion));
  // TODO: montar rutas de habilitación, ofertas, asignación, SSE y finalización/cobro.
  app.use((_req, res) => res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA' } }));
  app.use(manejadorDeErrores(logger));
  return app;
}

