import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useMatch } from 'react-router';
import Encabezado from './componentes/Encabezado.jsx';
import Ingresar from './paginas/Ingresar.jsx';
import Registro from './paginas/Registro.jsx';
import Billetera from './paginas/pasajero/Billetera.jsx';
import MiViaje from './paginas/pasajero/MiViaje.jsx';
import PedirViaje from './paginas/pasajero/PedirViaje.jsx';
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
        <Route path="*" element={<Navigate to="/ingresar" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
