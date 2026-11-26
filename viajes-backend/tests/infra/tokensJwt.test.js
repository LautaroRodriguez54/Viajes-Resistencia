import test from 'node:test';
import assert from 'node:assert/strict';
import jwtLib from 'jsonwebtoken';
import { crearServicioJwt } from '../../src/infra/autenticacion/tokensJwt.js';
import { Rol } from '../../src/dominio/usuarios/roles.js';

const config = { JWT_SECRET: 'un-secreto-de-prueba-muy-largo-de-32-caracteres', JWT_ACCESS_TOKEN_TTL: '15m' };

test('un token JWT conserva la identidad y rol autorizados y se firma con HS256', () => {
  const jwt = crearServicioJwt(config);
  const token = jwt.crearTokenDeAcceso({ usuarioId: 'usuario-123', rol: Rol.PASAJERO });
  const decodificado = jwtLib.decode(token, { complete: true });

  assert.equal(decodificado?.header?.alg, 'HS256');
  assert.deepEqual(jwt.verificarTokenDeAcceso(token), { usuarioId: 'usuario-123', rol: Rol.PASAJERO });
});

test('un token firmado con otra clave se rechaza', () => {
  const emisor = crearServicioJwt(config);
  const receptor = crearServicioJwt({ ...config, JWT_SECRET: 'otra-clave-secreta-tambien-muy-larga-123' });
  assert.throws(() => receptor.verificarTokenDeAcceso(emisor.crearTokenDeAcceso({ usuarioId: 'u-1', rol: Rol.CHOFER })), (error) => error.codigo === 'TOKEN_INVALIDO');
});

test('un token sin firma (alg none) se rechaza con TOKEN_INVALIDO', () => {
  const receptor = crearServicioJwt(config);
  const encabezado = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const carga = Buffer.from(JSON.stringify({ rol: Rol.PASAJERO, sub: 'u-1' })).toString('base64url');
  const tokenSinFirma = `${encabezado}.${carga}.`;

  assert.throws(() => receptor.verificarTokenDeAcceso(tokenSinFirma), (error) => error.codigo === 'TOKEN_INVALIDO');
});

test('un token firmado con HS384 o HS512 con el mismo secreto se rechaza por pinning de algoritmo', () => {
  const receptor = crearServicioJwt(config);
  for (const algorithm of ['HS384', 'HS512']) {
    const tokenOtroAlg = jwtLib.sign({ rol: Rol.PASAJERO }, config.JWT_SECRET, {
      algorithm,
      subject: 'u-1',
      expiresIn: '15m',
    });
    assert.throws(() => receptor.verificarTokenDeAcceso(tokenOtroAlg), (error) => error.codigo === 'TOKEN_INVALIDO');
  }
});
