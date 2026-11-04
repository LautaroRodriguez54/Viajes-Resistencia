// Dibujo fijo de Resistencia copiado del diseño (docs/diseno-web/02-pasajero-pedir.html).
// Ocupa el lugar del mapa de Google hasta que se conecte @vis.gl/react-google-maps.
const fuente = 'Outfit, Arial, sans-serif';
const ruta = 'M710 350 V410 H830 V170 H1070';
const avenidas = 'M0 410 H1280 M830 0 V800 M710 290 L1050 -50 M560 410 L130 840';

const caminoAlRetiro = 'M560 170 V290 H710 V350';

// chofer: { etiqueta: 'AE 123 KD · 3 min' } dibuja el auto y el camino punteado
// hasta el retiro, y deja la ruta del viaje atenuada (pantalla Mi viaje).
export default function MapaSimulado({ conRuta = true, etiquetaDestino = 'Terminal de Ómnibus', chofer, children }) {
  const descripcion = chofer
    ? 'Mapa con el chofer acercándose al punto de retiro'
    : conRuta ? `Mapa de Resistencia con la ruta hasta ${etiquetaDestino}` : 'Mapa de Resistencia';

  return (
    <main className="mapa">
      <svg viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice" role="img" aria-label={descripcion}>
        <rect width="1280" height="800" fill="#F1F3F4" />
        <rect x="566" y="296" width="138" height="108" rx="4" fill="#C8E6C9" />
        <rect x="1080" y="440" width="150" height="90" rx="6" fill="#C8E6C9" />
        <path
          d="M0 50 H1280 M0 170 H1280 M0 290 H1280 M0 530 H1280 M0 650 H1280 M0 770 H1280 M80 0 V800 M200 0 V800 M320 0 V800 M440 0 V800 M560 0 V800 M710 0 V800 M950 0 V800 M1070 0 V800 M1190 0 V800"
          stroke="#FFFFFF" strokeWidth="9" fill="none"
        />
        <path d={avenidas} stroke="#DADCE0" strokeWidth="20" fill="none" />
        <path d={avenidas} stroke="#FFFFFF" strokeWidth="15" fill="none" />
        <path d="M1290 300 L1110 140 L960 -20" stroke="#F2C94C" strokeWidth="20" fill="none" />
        <path d="M1290 300 L1110 140 L960 -20" stroke="#FDE293" strokeWidth="15" fill="none" />
        <path d="M700 820 C 780 720, 930 700, 1020 640 S 1190 560, 1300 590 L 1300 820 Z" fill="#AADAFF" />
        <g fontFamily={fuente} fontSize="13" fill="#5F6368">
          <text x="190" y="402">Av. 9 de Julio</text>
          <text x="300" y="664" transform="rotate(-45 300 664)">Av. Alberdi</text>
          <text x="880" y="114" transform="rotate(-45 880 114)">Av. Sarmiento</text>
          <text x="822" y="270" transform="rotate(-90 822 270)">Av. Ávalos</text>
        </g>
        <g fontFamily={fuente} fontSize="12" fontWeight="600" fill="#1E6B34">
          <text x="574" y="395">Plaza 25 de Mayo</text>
          <text x="1092" y="490">Parque 2 de Febrero</text>
        </g>
        <text x="960" y="748" fontFamily={fuente} fontSize="14" fontStyle="italic" fill="#2B6CB0">Río Negro</text>
        {!chofer && (
          <g fill="#202124">
            <rect x="190" y="164" width="20" height="12" rx="4" />
            <rect x="436" y="600" width="12" height="20" rx="4" />
            <rect x="1000" y="524" width="20" height="12" rx="4" />
            <rect x="944" y="300" width="12" height="20" rx="4" />
          </g>
        )}
        {conRuta && (
          <>
            {chofer ? (
              <>
                <path d={ruta} stroke="#1A73E8" strokeWidth="7" fill="none" strokeLinejoin="round" strokeLinecap="round" opacity="0.45" />
                <path d={caminoAlRetiro} stroke="#202124" strokeWidth="5" strokeDasharray="1 11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <>
                <path d={ruta} stroke="#1557B0" strokeWidth="11" fill="none" strokeLinejoin="round" strokeLinecap="round" />
                <path d={ruta} stroke="#1A73E8" strokeWidth="7" fill="none" strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            <circle cx="710" cy="350" r="9" fill="#FFFFFF" stroke="#202124" strokeWidth="5" />
            <g transform="translate(1070 170)">
              <path d="M0 0 C 0 0 -16 -18 -16 -30 A 16 16 0 0 1 16 -30 C 16 -18 0 0 0 0 Z" fill="#EA4335" stroke="#B31412" strokeWidth="1.5" />
              <circle cx="0" cy="-30" r="6" fill="#B31412" />
            </g>
            {!chofer && (
              <text x="1086" y="198" fontFamily={fuente} fontSize="13" fontWeight="600" fill="#202124">{etiquetaDestino}</text>
            )}
          </>
        )}
        {chofer && (
          <>
            <g transform="translate(560 170)">
              <circle r="24" fill="#1A73E8" opacity="0.18" />
              <circle r="13" fill="#202124" stroke="#FFFFFF" strokeWidth="3" />
              <path d="M0 -6 L5 5 L0 2 L-5 5 Z" fill="#FFFFFF" />
            </g>
            <g transform="translate(470 128)">
              <rect width="150" height="28" rx="14" fill="#202124" />
              <text x="75" y="19" textAnchor="middle" fontFamily={fuente} fontSize="13" fontWeight="600" fill="#FFFFFF">{chofer.etiqueta}</text>
            </g>
          </>
        )}
      </svg>

      {children}

      <div className="mapa__zoom">
        <button type="button" aria-label="Acercar">+</button>
        <button type="button" aria-label="Alejar">−</button>
      </div>
    </main>
  );
}
