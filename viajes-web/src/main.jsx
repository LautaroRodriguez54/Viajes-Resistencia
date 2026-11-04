import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useMatch } from 'react-router';
import Encabezado from './componentes/Encabezado.jsx';
import Ingresar from './paginas/Ingresar.jsx';
import Registro from './paginas/Registro.jsx';
import Administracion from './paginas/admin/Administracion.jsx';
import Oferta from './paginas/chofer/Oferta.jsx';
import ViajesActivos from './paginas/operador/ViajesActivos.jsx';
import Billetera from './paginas/pasajero/Billetera.jsx';
import MiViaje from './paginas/pasajero/MiViaje.jsx';
import PedirViaje from './paginas/pasajero/PedirViaje.jsx';
import { choferEjemplo } from './datos/ejemplo.js';
import './estilos.css';

const enlacesPasajero = [
  { a: '/pasajero/pedir', texto: 'Pedir' },
  { a: '/pasajero/viaje', texto: 'Mi viaje' },
  { a: '/pasajero/billetera', texto: 'Billetera' },
];

function LayoutPasajero() {
  // Billetera no tiene mapa: el diseño usa el encabezado sin barra blanca.
  const sinMapa = useMatch('/pasajero/billetera');
  return (
    <div className="con-encabezado">
      <Encabezado rol="pasajero" enlaces={enlacesPasajero} plano={Boolean(sinMapa)} />
      <Outlet />
    </div>
  );
}

// Chofer, operador y admin tienen una sola pantalla: encabezado sin navegación.
// El chofer va sobre el mapa (encabezado con barra); operador y admin, en columna.
function LayoutRol({ rol, plano = false, detalle }) {
  return (
    <div className="con-encabezado">
      <Encabezado rol={rol} plano={plano} detalle={detalle} />
      <Outlet />
    </div>
  );
}

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/ingresar" replace />} />
        <Route path="/ingresar" element={<Ingresar />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/pasajero" element={<LayoutPasajero />}>
          <Route index element={<Navigate to="pedir" replace />} />
          <Route path="pedir" element={<PedirViaje />} />
          <Route path="viaje" element={<MiViaje />} />
          <Route path="billetera" element={<Billetera />} />
        </Route>
        <Route element={<LayoutRol rol="chofer" detalle={choferEjemplo.patente} />}>
          <Route path="/chofer" element={<Oferta />} />
        </Route>
        <Route element={<LayoutRol rol="operador" plano />}>
          <Route path="/operador" element={<ViajesActivos />} />
        </Route>
        <Route element={<LayoutRol rol="administrador" plano />}>
          <Route path="/admin" element={<Administracion />} />
        </Route>
        <Route path="*" element={<Navigate to="/ingresar" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
