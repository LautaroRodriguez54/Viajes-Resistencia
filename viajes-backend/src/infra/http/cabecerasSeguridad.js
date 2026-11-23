import helmet from 'helmet';

/**
 * Configura las cabeceras HTTP de seguridad para una API REST JSON.
 * Aplica una CSP restrictiva porque el backend no sirve HTML ni recursos de interfaz.
 */
export function crearCabecerasSeguridad() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  });
}
