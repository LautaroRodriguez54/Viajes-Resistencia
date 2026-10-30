import test from 'node:test';
import assert from 'node:assert/strict';
import { Rol, esRolValido } from '../../src/dominio/usuarios/roles.js';

test('solo reconoce los cuatro roles del dominio', () => {
  assert.equal(esRolValido(Rol.PASAJERO), true);
  assert.equal(esRolValido('administrador_global'), false);
});

