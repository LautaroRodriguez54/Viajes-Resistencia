# ADR 003 - Autenticación y autorización

- Estado: aceptado
- Fecha: 2026-10-29
- Participantes: TODO

## Contexto

El sistema tiene cuatro roles y debe verificar autorización por rol y por recurso en el servidor.

## Opciones consideradas

1. JWT firmado: apropiado para API y clientes separados; requiere revocación/expiración bien definida.
2. Sesiones de servidor: revocación simple; demanda almacenamiento y manejo de cookies.

## Decisión

Usaremos JWT firmado para los tokens de acceso. El token contendrá solamente el identificador del usuario (`sub`) y su rol; su duración se configura con `JWT_ACCESS_TOKEN_TTL` (15 minutos por defecto de desarrollo). Las contraseñas se almacenarán con Argon2id y los costos quedan configurados por entorno.

## Consecuencias

La autenticación no requiere estado de sesión en memoria, lo que simplifica varios procesos. La autorización por recurso se verificará contra los datos persistidos en cada caso de uso; nunca se deducirá sólo del rol que viaja en el JWT. La revocación y los refresh tokens quedan fuera del alcance inicial y deben revisarse si se vuelven necesarios.

## Qué nos haría cambiar

Una necesidad de revocación inmediata y frecuente, o requisitos de navegador que favorezcan cookies de sesión con protección CSRF.

