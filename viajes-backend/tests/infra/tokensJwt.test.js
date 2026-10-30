import test from 'node:test';
import assert from 'node:assert/strict';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = { JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-32-caracteres', JWT_ACCESS_TOKEN_TTL: '15m' };

test('un token JWT conserva la identidad y rol autorizados', () => {
  const jwt = crearServicioJwt(config);
  const token = jwt.crearTokenDeAcceso({ usuarioId: 'usuario-123', rol: Rol.PASAJERO });
  assert.deepEqual(jwt.verificarTokenDeAcceso(token), { usuarioId: 'usuario-123', rol: Rol.PASAJERO });
});

test('un token firmado con otra clave se rechaza', () => {
  const emisor = crearServicioJwt(config);
  const receptor = crearServicioJwt({ ...config, JWT_SECRET: 'otra-clave-secreta-tambien-muy-larga-123' });
  assert.throws(() => receptor.verificarTokenDeAcceso(emisor.crearTokenDeAcceso({ usuarioId: 'u-1', rol: Rol.CHOFER })), (error) => error.codigo === 'TOKEN_INVALIDO');
});

