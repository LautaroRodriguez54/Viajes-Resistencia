import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Construye una politica Content-Security-Policy (CSP) consistente para la SPA.
 * Permite variantes para desarrollo (HMR) y produccion (estricta), con o sin frame-ancestors.
 */
function construirCsp({
  incluirUnsafeInlineScript = false,
  origenesConexionExtra = [],
  incluirFrameAncestors = true,
} = {}) {
  const scriptSrc = incluirUnsafeInlineScript ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = ["'self'", 'http://localhost:3000', ...origenesConexionExtra].join(' ');
  const directivas = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
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

const CSP_PRODUCCION = construirCsp();
const CSP_META_PRODUCCION = construirCsp({ incluirFrameAncestors: false });
// El backend alternativo sólo se admite en localhost durante desarrollo.
const apiDesarrollo = process.env.VITE_API_URL;
const origenApiLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiDesarrollo ?? '')
  ? [apiDesarrollo]
  : [];
const CSP_DESARROLLO = construirCsp({
  // En desarrollo Vite/React Fast Refresh requiere script inline y WebSocket HMR.
  incluirUnsafeInlineScript: true,
  origenesConexionExtra: ['ws://localhost:5173', ...origenApiLocal],
});

/**
 * Inyecta la etiqueta meta CSP en el HTML compilado para entornos de archivos estaticos.
 */
function inyectarCspEnBuild() {
  return {
    name: 'inyectar-csp-en-build',
    apply: 'build',
    transformIndexHtml(html) {
      const etiquetaCsp = `<meta http-equiv="Content-Security-Policy" content="${CSP_META_PRODUCCION}" />`;
      return html.replace(/(<meta\s+name="viewport"[^>]*>)/i, `$1\n    ${etiquetaCsp}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), inyectarCspEnBuild()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': CSP_DESARROLLO,
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': CSP_PRODUCCION,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
});
