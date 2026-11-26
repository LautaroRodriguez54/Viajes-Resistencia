import crypto from 'node:crypto';
import { crearCandados } from './candados.js';

// Viajes en memoria, por ahora sólo con la parte que usa la unidad de trabajo del cobro
// (bloquearParaCobro y los tres registros del cobro). Ofertas, aceptación y cambios de estado
// siguen sólo en Postgres (son de Lucas).
export function crearRepositorioViajesEnMemoria() {
  const viajes = new Map(); // viajeId → { id, estado, pasajeroId, choferId, estimacionCentavos, tarifaFinalCentavos, version, ... }
  const ofertas = new Map(); // ofertaId → { id, viajeId, choferId, estado, venceAt, respondidaAt }
  const choferes = new Map(); // choferId → { id, habilitado, disponible, ubicacion, reportadaAt }
  const eventos = []; // equivalente a eventos_viaje: { viajeId, tipo, datos }
  const tomarCandado = crearCandados();

  return {
    viajes,
    ofertas,
    choferes,
    eventos,
    agregar(viaje) {
      const nuevo = {
        id: crypto.randomUUID(),
        estado: 'solicitado',
        choferId: null,
        estimacionCentavos: 0,
        tarifaFinalCentavos: null,
        origen: { latitud: -27.4514, longitud: -58.9867 },
        destino: { latitud: -27.44, longitud: -58.98 },
        solicitadoAt: new Date(),
        version: 1,
        ...viaje,
      };
      viajes.set(nuevo.id, nuevo);
      return nuevo.id;
    },
    agregarChofer(chofer) {
      const nuevo = {
        id: crypto.randomUUID(),
        habilitado: true,
        disponible: true,
        ubicacion: { latitud: -27.4514, longitud: -58.9867 },
        reportadaAt: new Date(),
        ...chofer,
      };
      choferes.set(nuevo.id, nuevo);
      return nuevo.id;
    },
    agregarOferta(oferta) {
      const nueva = {
        id: crypto.randomUUID(),
        estado: 'pendiente',
        venceAt: new Date(Date.now() + 30_000),
        respondidaAt: null,
        ...oferta,
      };
      ofertas.set(nueva.id, nueva);
      return nueva.id;
    },

    enTransaccion(tx) {
      return {
        async bloquearParaCobro(viajeId) {
          tx.retener(await tomarCandado(`viaje:${viajeId}`));
          const viaje = viajes.get(viajeId);
          return viaje ? { ...viaje } : null;
        },
        async registrarCobroSolicitado(viajeId, { tarifaFinalCentavos }) {
          tx.alConfirmar(() => {
            const actual = viajes.get(viajeId);
            Object.assign(actual, { estado: 'pago_pendiente', tarifaFinalCentavos, version: (actual.version ?? 1) + 1 });
            eventos.push({ viajeId, tipo: 'cobro_solicitado', datos: { importeCentavos: tarifaFinalCentavos } });
          });
        },
        async registrarCobroConfirmado(viajeId, { importeCentavos, reintento }) {
          tx.alConfirmar(() => {
            const actual = viajes.get(viajeId);
            actual.estado = 'finalizado';
            actual.version = (actual.version ?? 1) + 1;
            eventos.push({ viajeId, tipo: 'cobro_confirmado', datos: reintento ? { importeCentavos, reintento: true } : { importeCentavos } });
          });
        },
        async registrarCobroPendiente(viajeId, { importeCentavos, motivo }) {
          tx.alConfirmar(() => eventos.push({ viajeId, tipo: 'cobro_pendiente', datos: { importeCentavos, motivo } }));
        },
      };
    },

    enTransaccionViajes(tx) {
      return {
        async bloquearViaje(viajeId) {
          tx.retener(await tomarCandado(`viaje:${viajeId}`));
          const viaje = viajes.get(viajeId);
          return viaje ? { ...viaje } : null;
        },
        async actualizarEstadoViaje(viajeId, { nuevoEstado, registrarInicio }) {
          tx.alConfirmar(() => {
            const actual = viajes.get(viajeId);
            actual.estado = nuevoEstado;
            if (registrarInicio) actual.iniciadoAt = new Date();
            actual.version = (actual.version ?? 1) + 1;
          });
        },
        async vencerOfertasPendientesDelViaje(viajeId) {
          tx.retener(await tomarCandado(`ofertas:${viajeId}`));
          const pendientes = [...ofertas.values()].filter((o) => o.viajeId === viajeId && o.estado === 'pendiente');
          if (pendientes.length > 0) {
            tx.alConfirmar(() => {
              const ahora = new Date();
              for (const oferta of pendientes) {
                oferta.estado = 'vencida';
                oferta.respondidaAt = ahora;
              }
            });
          }
        },
        async liberarChoferSiHabilitado(choferId) {
          tx.retener(await tomarCandado(`chofer:${choferId}`));
          tx.alConfirmar(() => {
            const chofer = choferes.get(choferId);
            if (chofer) chofer.disponible = chofer.habilitado;
          });
        },
        async registrarCancelacionViaje(viajeId, { nuevoEstado, actorId, motivo }) {
          const canceladoAt = new Date();
          tx.alConfirmar(() => {
            const actual = viajes.get(viajeId);
            actual.estado = nuevoEstado;
            actual.canceladoAt = canceladoAt;
            actual.canceladoPorId = actorId;
            actual.motivoCancelacion = motivo;
            actual.version = (actual.version ?? 1) + 1;
          });
          return { viajeId, estado: nuevoEstado, canceladoAt, motivo };
        },
        async registrarEventoViaje(viajeId, tipo, datos = null) {
          tx.alConfirmar(() => {
            eventos.push(datos === null ? { viajeId, tipo } : { viajeId, tipo, datos });
          });
        },
      };
    },
  };
}
