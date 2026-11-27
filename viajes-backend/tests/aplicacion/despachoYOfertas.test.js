import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { crearOfrecerAlChoferCercano } from '../../src/aplicacion/viajes/ofrecerAlChoferCercano.js';
import { crearRechazarOferta } from '../../src/aplicacion/viajes/rechazarOferta.js';
import { crearProcesarOfertasVencidas } from '../../src/aplicacion/viajes/procesarOfertasVencidas.js';
import { crearRepositorioViajesEnMemoria } from '../../src/infra/memoria/repositorioViajesEnMemoria.js';
import { crearUnidadDeTrabajoViajesEnMemoria } from '../../src/infra/memoria/unidadDeTrabajoViajesEnMemoria.js';

function armar(opciones = {}) {
  const viajes = crearRepositorioViajesEnMemoria(opciones);
  const unidadDeTrabajo = crearUnidadDeTrabajoViajesEnMemoria({ viajes });
  return {
    viajes,
    ofrecer: crearOfrecerAlChoferCercano({ unidadDeTrabajo }),
    rechazar: crearRechazarOferta({ unidadDeTrabajo }),
    procesarVencidas: crearProcesarOfertasVencidas({ unidadDeTrabajo }),
  };
}

test('ofrecerAlChoferCercano elige al chofer elegible más cercano y filtra fuera de radio, ocupados y TTL vencido', async () => {
  const ahora = new Date('2026-11-26T18:00:00Z');
  const { viajes, ofrecer } = armar({ ubicacionTtlSegundos: 60, ahora: () => ahora });
  const pasajeroId = crypto.randomUUID();
  const origen = { latitud: -27.4514, longitud: -58.9867 };
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId, origen });

  // Lejos (> 5 km)
  viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.52, longitud: -59.05 },
    reportadaAt: ahora,
  });
  // Ubicación vencida por TTL
  viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.4514, longitud: -58.9867 },
    reportadaAt: new Date(ahora.getTime() - 120_000),
  });
  // Más lejano dentro de radio
  viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.46, longitud: -58.99 },
    reportadaAt: ahora,
  });
  // Más cercano dentro de radio y vigente
  const cercano = viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.4515, longitud: -58.9868 },
    reportadaAt: ahora,
  });

  const oferta = await ofrecer({ viajeId, pasajeroId });
  assert.equal(oferta.choferId, cercano);
  assert.equal(viajes.ofertas.get(oferta.ofertaId).estado, 'pendiente');

  await assert.rejects(
    ofrecer({ viajeId, pasajeroId: crypto.randomUUID() }),
    (err) => err.codigo === 'RECURSO_NO_ENCONTRADO',
  );
});

test('rechazarOferta re-ofrece al siguiente candidato y pasa a sin_choferes_disponibles al agotar', async () => {
  const { viajes, ofrecer, rechazar } = armar();
  const pasajeroId = crypto.randomUUID();
  const chofer1 = viajes.agregarChofer({ id: crypto.randomUUID(), ubicacion: { latitud: -27.4514, longitud: -58.9867 } });
  const chofer2 = viajes.agregarChofer({ id: crypto.randomUUID(), ubicacion: { latitud: -27.4520, longitud: -58.9870 } });
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });

  const oferta1 = await ofrecer({ viajeId, pasajeroId });
  assert.equal(oferta1.choferId, chofer1);

  await assert.rejects(
    rechazar({ ofertaId: oferta1.ofertaId, choferId: chofer2 }),
    (err) => err.codigo === 'RECURSO_PROHIBIDO',
  );

  const res1 = await rechazar({ ofertaId: oferta1.ofertaId, choferId: chofer1 });
  assert.deepEqual(res1, {
    viajeId,
    ofertaId: oferta1.ofertaId,
    estado: 'rechazada',
    viajeEstado: 'solicitado',
    reofrecida: true,
  });

  const oferta2 = [...viajes.ofertas.values()].find((o) => o.viajeId === viajeId && o.estado === 'pendiente');
  assert.equal(oferta2.choferId, chofer2);

  const res2 = await rechazar({ ofertaId: oferta2.id, choferId: chofer2 });
  assert.equal(res2.viajeEstado, 'sin_choferes_disponibles');
  assert.equal(res2.reofrecida, false);
  assert.equal(viajes.viajes.get(viajeId).estado, 'sin_choferes_disponibles');
  assert.equal(viajes.viajes.get(viajeId).version, 2);
});

test('procesarOfertasVencidas vence ofertas expiradas, re-ofrece y marca sin_choferes_disponibles', async () => {
  let reloj = new Date('2026-11-26T18:00:00Z');
  const { viajes, ofrecer, procesarVencidas } = armar({ ofertaTtlSegundos: 30, ahora: () => reloj });
  const pasajeroId = crypto.randomUUID();
  const chofer1 = viajes.agregarChofer({ id: crypto.randomUUID(), ubicacion: { latitud: -27.4514, longitud: -58.9867 }, reportadaAt: reloj });
  const chofer2 = viajes.agregarChofer({ id: crypto.randomUUID(), ubicacion: { latitud: -27.4520, longitud: -58.9870 }, reportadaAt: reloj });
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });

  const oferta1 = await ofrecer({ viajeId, pasajeroId });
  assert.equal(oferta1.choferId, chofer1);

  reloj = new Date(reloj.getTime() + 35_000);
  const vuelta1 = await procesarVencidas();
  assert.equal(vuelta1.length, 1);
  assert.equal(vuelta1[0].reofrecida, true);
  assert.equal(vuelta1[0].nuevaOferta.choferId, chofer2);

  reloj = new Date(reloj.getTime() + 35_000);
  const vuelta2 = await procesarVencidas();
  assert.equal(vuelta2.length, 1);
  assert.equal(vuelta2[0].reofrecida, false);
  assert.equal(vuelta2[0].viajeEstado, 'sin_choferes_disponibles');
  assert.equal(viajes.viajes.get(viajeId).version, 2);
});

test('ofrecerAlChoferCercano re-ofrece al único chofer si su oferta previa en ese viaje ya venció', async () => {
  let reloj = new Date('2026-11-26T18:00:00Z');
  const { viajes, ofrecer } = armar({ ofertaTtlSegundos: 30, ahora: () => reloj });
  const pasajeroId = crypto.randomUUID();
  const choferId = viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.4514, longitud: -58.9867 },
    reportadaAt: reloj,
  });
  const viajeId = viajes.agregar({ estado: 'solicitado', pasajeroId });

  const primera = await ofrecer({ viajeId, pasajeroId });
  assert.equal(primera.choferId, choferId);

  reloj = new Date(reloj.getTime() + 35_000);
  const segunda = await ofrecer({ viajeId, pasajeroId });
  assert.equal(segunda.choferId, choferId);
  assert.notEqual(segunda.ofertaId, primera.ofertaId);
  assert.equal(viajes.ofertas.get(primera.ofertaId).estado, 'vencida');
  assert.equal(viajes.ofertas.get(segunda.ofertaId).estado, 'pendiente');
});

test('ofrecerAlChoferCercano concurrente no crea dos ofertas pendientes para el mismo chofer en memoria', async () => {
  const { viajes, ofrecer } = armar();
  const pasajero1 = crypto.randomUUID();
  const pasajero2 = crypto.randomUUID();
  const choferId = viajes.agregarChofer({
    id: crypto.randomUUID(),
    ubicacion: { latitud: -27.4514, longitud: -58.9867 },
  });
  const viaje1 = viajes.agregar({ estado: 'solicitado', pasajeroId: pasajero1 });
  const viaje2 = viajes.agregar({ estado: 'solicitado', pasajeroId: pasajero2 });

  const resultados = await Promise.allSettled([
    ofrecer({ viajeId: viaje1, pasajeroId: pasajero1 }),
    ofrecer({ viajeId: viaje2, pasajeroId: pasajero2 }),
  ]);

  const exitosos = resultados.filter((r) => r.status === 'fulfilled');
  const fallidos = resultados.filter((r) => r.status === 'rejected');
  assert.equal(exitosos.length, 1);
  assert.equal(fallidos.length, 1);
  assert.equal(exitosos[0].value.choferId, choferId);
  assert.equal(fallidos[0].reason.codigo, 'SIN_CHOFERES_CERCANOS');

  const pendientes = [...viajes.ofertas.values()].filter((o) => o.estado === 'pendiente');
  assert.equal(pendientes.length, 1);
});
