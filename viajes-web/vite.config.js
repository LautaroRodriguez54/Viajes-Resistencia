import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Orígenes del mapa real (src/mapas/config.js): sólo imágenes de los mosaicos de OpenStreetMap y
// búsquedas a Photon. Ningún script de terceros. Con VITE_MAPA=simulado no se agregan y la política
// queda tan estricta como antes.
const MAPA_REAL = {
  img: ['https://tile.openstreetmap.org'],
  connect: ['https://photon.komoot.io'],
};

/**
 * Construye una politica Content-Security-Policy (CSP) consistente para la SPA.
 * Permite variantes para desarrollo (HMR) y produccion (estricta), con o sin frame-ancestors,
 * y con o sin los origenes del mapa real.
 */
function construirCsp({
  incluirUnsafeInlineScript = false,
  origenesConexionExtra = [],
  incluirFrameAncestors = true,
  conMapaReal = false,
} = {}) {
  const mapa = (tipo) => (conMapaReal ? MAPA_REAL[tipo] : []);
  const scriptSrc = ["'self'", ...(incluirUnsafeInlineScript ? ["'unsafe-inline'"] : [])].join(' ');
  const connectSrc = ["'self'", 'http://localhost:3000', ...origenesConexionExtra, ...mapa('connect')].join(' ');
  const directivas = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    ["img-src 'self' data:", ...mapa('img')].join(' '),
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (incluirFrameAncestors) {
    // frame-ancestors solo es valido por cabecera HTTP; en meta tag el navegador lo ignora.
    directivas.push("frame-ancestors 'none'");
  }

  return directivas.join('; ');
}

/**
 * Inyecta la etiqueta meta CSP en el HTML compilado para entornos de archivos estaticos.
 */
function inyectarCspEnBuild(cspMeta) {
  return {
    name: 'inyectar-csp-en-build',
    apply: 'build',
    transformIndexHtml(html) {
      const etiquetaCsp = `<meta http-equiv="Content-Security-Policy" content="${cspMeta}" />`;
      return html.replace(/(<meta\s+name="viewport"[^>]*>)/i, `$1\n    ${etiquetaCsp}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Lee .env, .env.local, etc. de viajes-web (sólo las VITE_*), igual que la app.
  const conMapaReal = loadEnv(mode, process.cwd()).VITE_MAPA !== 'simulado';
  const cspProduccion = construirCsp({ conMapaReal });
  const cspMetaProduccion = construirCsp({ incluirFrameAncestors: false, conMapaReal });
  const cspDesarrollo = construirCsp({
    // En desarrollo Vite/React Fast Refresh requiere script inline y WebSocket HMR.
    incluirUnsafeInlineScript: true,
    origenesConexionExtra: ['ws://localhost:5173'],
    conMapaReal,
  });

  return {
    plugins: [react(), inyectarCspEnBuild(cspMetaProduccion)],
    server: {
      port: 5173,
      strictPort: true,
      headers: {
        'Content-Security-Policy': cspDesarrollo,
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      headers: {
        'Content-Security-Policy': cspProduccion,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    },
  };
});
