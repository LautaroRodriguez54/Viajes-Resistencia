import crypto from 'node:crypto';
import { crearCandados } from './candados.js';
import { calcularDistanciaKilometros } from '../../dominio/viajes/tarifa.js';

const RADIO_BUSQUEDA_KM = 5;

// Viajes en memoria: cubre cobro (unidadDeTrabajoCobro) y ciclo de vida de viajes y ofertas
// (unidadDeTrabajoViajes) con candados por entidad y copia de cambios al confirmar.
export function crearRepositorioViajesEnMemoria(opciones = {}) {
  const { ofertaTtlSegundos = 30, ubicacionTtlSegundos = null, ahora = () => new Date() } = opciones;
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
      // Registra ofertas vencidas dentro de la misma transacción para que lecturas posteriores
      // las vean como 'vencida' antes del COMMIT, sin mutar el mapa si la transacción revierte.
      const ofertasVencidasEnTx = new Set();

      function estadoEfectivoOferta(oferta) {
        return ofertasVencidasEnTx.has(oferta.id) ? 'vencida' : oferta.estado;
      }

      function esCandidatoElegible(chofer, { viajeId, origen, instante, excluidos }) {
        if (!chofer || !chofer.habilitado || !chofer.disponible || !chofer.ubicacion) return false;
        if (ubicacionTtlSegundos !== null && chofer.reportadaAt) {
          const edadMs = instante.getTime() - chofer.reportadaAt.getTime();
          if (edadMs > ubicacionTtlSegundos * 1000) return false;
        }
        if (calcularDistanciaKilometros(chofer.ubicacion, origen) > RADIO_BUSQUEDA_KM) return false;
        const tieneActivo = [...viajes.values()].some(
          (v) => v.choferId === chofer.id && ['asignado', 'chofer_en_camino', 'en_curso'].includes(v.estado),
        );
        if (tieneActivo) return false;
        const excluidoEnViaje = [...ofertas.values()].some(
          (o) => o.viajeId === viajeId && o.choferId === chofer.id && excluidos.has(estadoEfectivoOferta(o)),
        );
        if (excluidoEnViaje) return false;
        const tieneOfertaVigente = [...ofertas.values()].some(
          (o) => o.choferId === chofer.id && estadoEfectivoOferta(o) === 'pendiente' && o.venceAt > instante,
        );
        return !tieneOfertaVigente;
      }

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
          const instante = ahora();
          return [...ofertas.values()]
            .filter((o) => o.viajeId === viajeId && (o.estado === 'pendiente' || (ofertaId && o.id === ofertaId)))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map((o) => ({
              id: o.id,
              viajeId: o.viajeId,
              choferId: o.choferId,
              estado: o.estado,
              vencida: o.venceAt <= instante,
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
        async bloquearViajeSolicitadoDelPasajero(viajeId, pasajeroId) {
          tx.retener(await tomarCandado(`viaje:${viajeId}`));
          const viaje = viajes.get(viajeId);
          if (!viaje || viaje.pasajeroId !== pasajeroId || viaje.estado !== 'solicitado') return null;
          return { id: viaje.id, origen: viaje.origen };
        },
        async vencerOfertasExpiradasDelViaje(viajeId) {
          tx.retener(await tomarCandado(`ofertas:${viajeId}`));
          const instante = ahora();
          const vencidas = [...ofertas.values()].filter(
            (o) => o.viajeId === viajeId && estadoEfectivoOferta(o) === 'pendiente' && o.venceAt <= instante,
          );
          if (vencidas.length > 0) {
            for (const oferta of vencidas) {
              ofertasVencidasEnTx.add(oferta.id);
            }
            tx.alConfirmar(() => {
              for (const oferta of vencidas) {
                oferta.estado = 'vencida';
                oferta.respondidaAt = instante;
                eventos.push({ viajeId, tipo: 'oferta_vencida', datos: { ofertaId: oferta.id, choferId: oferta.choferId } });
              }
            });
          }
          return vencidas.map((o) => ({ id: o.id, choferId: o.choferId }));
        },
        async seleccionarYCrearOferta({ viajeId, origen, estadosExcluidos }) {
          const instante = ahora();
          const excluidos = new Set(estadosExcluidos);
          const candidatos = [...choferes.values()]
            .filter((c) => esCandidatoElegible(c, { viajeId, origen, instante, excluidos }))
            .sort((a, b) => calcularDistanciaKilometros(a.ubicacion, origen) - calcularDistanciaKilometros(b.ubicacion, origen));

          let elegido = null;
          for (const candidato of candidatos) {
            const soltar = await tomarCandado(`chofer:${candidato.id}`);
            const actual = choferes.get(candidato.id);
            if (esCandidatoElegible(actual, { viajeId, origen, instante, excluidos })) {
              tx.retener(soltar);
              elegido = actual;
              break;
            }
            soltar();
          }

          if (!elegido) return null;
          const ofertaId = crypto.randomUUID();
          const venceAt = new Date(instante.getTime() + ofertaTtlSegundos * 1000);
          tx.alConfirmar(() => {
            ofertas.set(ofertaId, { id: ofertaId, viajeId, choferId: elegido.id, estado: 'pendiente', venceAt, respondidaAt: null });
            eventos.push({ viajeId, tipo: 'oferta_creada', datos: { ofertaId, choferId: elegido.id } });
          });
          return { ofertaId, choferId: elegido.id, venceAt };
        },
        async marcarOfertaRechazada({ viajeId, ofertaId, choferId }) {
          const instante = ahora();
          tx.alConfirmar(() => {
            const oferta = ofertas.get(ofertaId);
            if (oferta) {
              oferta.estado = 'rechazada';
              oferta.respondidaAt = instante;
            }
            eventos.push({ viajeId, tipo: 'oferta_rechazada', datos: { ofertaId, choferId } });
          });
        },
        async marcarOfertasVencidas(viajeId, ofertasVencidas) {
          const instante = ahora();
          tx.alConfirmar(() => {
            for (const item of ofertasVencidas) {
              const oferta = ofertas.get(item.id);
              if (oferta) {
                oferta.estado = 'vencida';
                oferta.respondidaAt = instante;
              }
              eventos.push({ viajeId, tipo: 'oferta_vencida', datos: { ofertaId: item.id, choferId: item.choferId } });
            }
          });
        },
        async marcarViajeSinChoferesDisponibles(viajeId, datosEvento) {
          tx.alConfirmar(() => {
            const actual = viajes.get(viajeId);
            actual.estado = 'sin_choferes_disponibles';
            actual.version = (actual.version ?? 1) + 1;
            eventos.push({ viajeId, tipo: 'viaje_sin_choferes_disponibles', datos: datosEvento });
          });
        },
        async bloquearSiguienteViajeConOfertaVencida() {
          const instante = ahora();
          const pendientes = [...viajes.values()]
            .filter((v) => [...ofertas.values()].some((o) => o.viajeId === v.id && o.estado === 'pendiente' && o.venceAt <= instante))
            .sort((a, b) => a.solicitadoAt - b.solicitadoAt);
          const siguiente = pendientes[0];
          if (!siguiente) return null;
          tx.retener(await tomarCandado(`viaje:${siguiente.id}`));
          return { id: siguiente.id, estado: siguiente.estado, origen: siguiente.origen };
        },
      };
    },
  };
}
