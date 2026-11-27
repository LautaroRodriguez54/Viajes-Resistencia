import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const RUTA_OPENAPI = new URL('../../docs/openapi.yaml', import.meta.url);

function resolverRefLocal(doc, ref) {
  const partes = ref.replace(/^#\//, '').split('/');
  let actual = doc;
  for (const parte of partes) {
    if (actual === null || typeof actual !== 'object' || !Object.hasOwn(actual, parte)) {
      throw new Error(`No se pudo resolver la referencia OpenAPI: ${ref}`);
    }
    actual = Reflect.get(actual, parte);
  }
  return actual;
}

export function crearValidadorOpenApi() {
  const documento = parse(readFileSync(RUTA_OPENAPI, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const compilados = new Map();

  function obtenerRespuesta(metodo, rutaOpenApi, status) {
    const pathItem = documento.paths ? Reflect.get(documento.paths, rutaOpenApi) : undefined;
    if (!pathItem) throw new Error(`Ruta no declarada en OpenAPI: ${rutaOpenApi}`);
    const operacion = Reflect.get(pathItem, metodo.toLowerCase());
    if (!operacion) throw new Error(`Método ${metodo} no declarado en ${rutaOpenApi}`);

    const respuestas = operacion.responses ?? {};
    let respuesta = Reflect.get(respuestas, String(status)) ?? respuestas.default;
    if (!respuesta) {
      throw new Error(`Status ${status} no declarado para ${metodo.toUpperCase()} ${rutaOpenApi}`);
    }
    if (respuesta.$ref) {
      respuesta = resolverRefLocal(documento, respuesta.$ref);
    }
    return respuesta;
  }

  function validarRespuesta(metodo, rutaOpenApi, status, cuerpo) {
    const clave = `${metodo.toUpperCase()} ${rutaOpenApi} ${status}`;
    const respuesta = obtenerRespuesta(metodo, rutaOpenApi, status);
    const schema = respuesta.content?.['application/json']?.schema;
    if (!schema) {
      throw new Error(`La respuesta ${clave} no define esquema application/json en OpenAPI.`);
    }

    let validar = compilados.get(clave);
    if (!validar) {
      validar = ajv.compile({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        ...schema,
        components: documento.components,
      });
      compilados.set(clave, validar);
    }

    const ok = validar(cuerpo);
    if (!ok) {
      const detalle = ajv.errorsText(validar.errors, { separator: '; ' });
      throw new Error(`Respuesta inválida contra OpenAPI (${clave}): ${detalle}`);
    }
  }

  return {
    documento,
    obtenerRespuesta,
    validarRespuesta,
  };
}
