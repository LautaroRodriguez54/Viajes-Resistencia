import { useEffect, useState } from 'react';
import { api } from '../../api/cliente.js';
import { usarConsultaPeriodica } from '../../ganchos.js';

// Panel del administrador: el estado del sistema en vivo (GET /admin/metricas cada 3 s). Sirve para mostrar
// el bloque 7 en la defensa: con `npm run carga:ubicaciones` corriendo, se ve el lag del event loop y la
// memoria del proceso mientras 500 choferes mandan su ubicación. El objetivo del grupo (docs/mediciones.md)
// es lag p99 < 50 ms: por encima, el número se pone en rojo.
const OBJETIVO_LAG_MS = 50;
const MUESTRAS = 30;

function Grafica({ valores }) {
  if (valores.length < 2) return null;
  const maximo = Math.max(OBJETIVO_LAG_MS * 1.2, ...valores);
  const x = (i) => (i / (MUESTRAS - 1)) * 100;
  const y = (v) => 30 - (v / maximo) * 28;
  const puntos = valores.map((v, i) => `${x(i + MUESTRAS - valores.length)},${y(v)}`).join(' ');
  return (
    <svg className="metrica__grafica" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="100" y1={y(OBJETIVO_LAG_MS)} y2={y(OBJETIVO_LAG_MS)} className="metrica__objetivo" />
      <polyline points={puntos} className="metrica__linea" />
    </svg>
  );
}

function Metrica({ titulo, valor, detalle, estado, children, testId }) {
  return (
    <div className={`metrica${estado ? ` metrica--${estado}` : ''}`} data-testid={testId}>
      <span className="metrica__titulo">{titulo}</span>
      <span className="metrica__valor">{valor ?? <span className="esqueleto esqueleto--monto-chico" />}</span>
      {detalle && <span className="metrica__detalle">{detalle}</span>}
      {children}
    </div>
  );
}

const formatoMs = (ms) => `${ms.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ms`;

export default function PanelMetricas() {
  const { dato, error } = usarConsultaPeriodica(api.metricas, 3000);
  const [lags, setLags] = useState([]);
  const lag = dato?.eventLoopLagMs?.p99;
  // Una muestra por respuesta (`dato` cambia en cada consulta aunque el número se repita).
  useEffect(() => {
    if (typeof lag === 'number') setLags((lista) => [...lista.slice(-(MUESTRAS - 1)), lag]);
  }, [dato, lag]);
  const negocio = dato?.negocio;
  return (
    <section className="tarjeta panel" aria-labelledby="titulo-panel" data-testid="admin-panel">
      <div className="panel__encabezado">
        <h1 id="titulo-panel">Estado del sistema</h1>
        <span className={error ? 'chip chip--peligro' : 'chip chip--exito'}>
          <span className={error ? 'punto-vivo punto-vivo--apagado' : 'punto-vivo'} aria-hidden="true" />
          {error ? 'Sin conexión' : 'En vivo'}
        </span>
      </div>
      {error && <p role="alert" className="aviso aviso--peligro">{error.message}</p>}
      <div className="panel__metricas">
        <Metrica titulo="Viajes activos" valor={negocio?.viajesActivos} detalle="pedidos, asignados o en curso" testId="metrica-viajes" />
        <Metrica
          titulo="Choferes disponibles" valor={negocio?.choferesDisponibles}
          detalle={negocio ? `de ${negocio.choferesHabilitados} habilitados` : null} testId="metrica-choferes"
        />
        <Metrica
          titulo="Por habilitar" valor={negocio?.choferesPorHabilitar}
          estado={negocio?.choferesPorHabilitar ? 'atencion' : null} detalle="choferes esperando"
        />
        <Metrica
          titulo="Pagos pendientes" valor={negocio?.pagosPendientes}
          estado={negocio?.pagosPendientes ? 'atencion' : null} detalle="viajes sin cobrar"
        />
        <Metrica
          titulo="Lag del event loop (p99)" valor={typeof lag === 'number' ? formatoMs(lag) : null}
          estado={typeof lag === 'number' ? (lag < OBJETIVO_LAG_MS ? 'bien' : 'mal') : null}
          detalle={`objetivo: menos de ${OBJETIVO_LAG_MS} ms`} testId="metrica-lag"
        >
          <Grafica valores={lags} />
        </Metrica>
        <Metrica
          titulo="Memoria del proceso" valor={dato ? `${Math.round(dato.memoriaMb.rss)} MB` : null}
          detalle={dato ? `heap ${Math.round(dato.memoriaMb.heapUsed)} MB · activo hace ${Math.round(dato.uptimeSegundos / 60)} min` : null}
        />
      </div>
    </section>
  );
}
