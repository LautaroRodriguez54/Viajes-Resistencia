import argon2 from 'argon2';

export function crearHasheadorArgon2(config) {
  const opciones = {
    type: argon2.argon2id,
    memoryCost: config.ARGON2_MEMORY_COST,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  };

  return {
    hashear: (contrasena) => argon2.hash(contrasena, opciones),
    verificar: (hash, contrasena) => argon2.verify(hash, contrasena),
  };
}

