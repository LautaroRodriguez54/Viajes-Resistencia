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
        async buscarReferenciaOferta(ofertaId) {
          const oferta = ofertas.get(ofertaId);
          if (!oferta) return null;
          return { id: oferta.id, viajeId: oferta.viajeId, choferId: oferta.choferId };
        },
        async bloquearOfertasDelViaje(viajeId, ofertaId = null) {
          tx.retener(await tomarCandado(`ofertas:${viajeId}`));
          const ahora = new Date();
          return [...ofertas.values()]
            .filter((o) => o.viajeId === viajeId && (o.estado === 'pendiente' || (ofertaId && o.id === ofertaId)))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((o) => ({
              id: o.id,
              viajeId: o.viajeId,
              choferId: o.choferId,
              estado: o.estado,
              vencida: o.venceAt <= ahora,
            }));
        },
        async bloquearChofer(choferId) {
          tx.retener(await tomarCandado(`chofer:${choferId}`));
          const chofer = choferes.get(choferId);
          if (!chofer) return null;
          const tieneViajeActivo = [...viajes.values()].some(
            (v) => v.choferId === choferId && ['asignado', 'chofer_en_camino', 'en_curso'].includes(v.estado),
          );
          return {
            habilitado: chofer.habilitado,
            disponible: chofer.disponible,
            tieneViajeActivo,
          };
        },
        async registrarAceptacionOferta({ viajeId, ofertaId, choferId }) {
          tx.alConfirmar(() => {
            const ahora = new Date();
            const actual = viajes.get(viajeId);
            actual.choferId = choferId;
            actual.estado = 'asignado';
            actual.asignadoAt = ahora;
            actual.version = (actual.version ?? 1) + 1;

            for (const oferta of ofertas.values()) {
              if (oferta.id === ofertaId) {
                oferta.estado = 'aceptada';
                oferta.respondidaAt = ahora;
              } else if (oferta.viajeId === viajeId && oferta.estado === 'pendiente') {
                oferta.estado = 'vencida';
                oferta.respondidaAt = ahora;
              }
            }

            const chofer = choferes.get(choferId);
            if (chofer) chofer.disponible = false;
            eventos.push({ viajeId, tipo: 'viaje_asignado', datos: { choferId, ofertaId } });
          });
        },
      };
    },
  };
}
