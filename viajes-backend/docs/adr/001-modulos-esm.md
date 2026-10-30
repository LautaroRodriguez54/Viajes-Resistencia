# ADR 001 - Usamos ESM en todo el backend

- Estado: aceptado
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

Node.js 22 permite ESM nativo y el proyecto debe elegir un único sistema de módulos.

## Opciones consideradas

1. ESM: sintaxis nativa moderna y coherente con Node 22; exige extensiones en imports relativos.
2. CommonJS: muy conocido y compatible con material previo; mezcla peor con dependencias ESM-first.

## Decisión

Usaremos ESM mediante `"type": "module"`.

## Consecuencias

Todos los archivos usan `import`/`export`; los imports relativos llevan extensión `.js`.

## Qué nos haría cambiar

Una dependencia imprescindible incompatible con ESM sin alternativa razonable.

