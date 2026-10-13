// Iconos SVG en línea (trazo 2px, heredan el color del texto)
const S = ({ d, size = 16, fill, className = '', children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
    {...(fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const IDots = (p) => <S {...p} fill><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></S>;
export const IOpen = (p) => <S {...p} d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />;
export const ICopy = (p) => <S {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" /></S>;
export const IBellOff = (p) => <S {...p} d="M13.7 21a2 2 0 01-3.4 0M18.6 13A17.9 17.9 0 0118 8M6.3 6.3A6 6 0 006 8c0 7-3 9-3 9h14M18 8a6 6 0 00-9.3-5M2 2l20 20" />;
export const IBell = (p) => <S {...p} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />;
export const IEyeOff = (p) => <S {...p} d="M17.9 17.9A10 10 0 0112 20c-7 0-10-8-10-8a18 18 0 015.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 10 8 10 8a18 18 0 01-2.2 3.2M14.1 14.1a3 3 0 01-4.2-4.2M2 2l20 20" />;
export const IUndo = (p) => <S {...p}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-15-6.7L3 13" /></S>;
export const IWarn = (p) => <S {...p} d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01" />;
export const IOk = (p) => <S {...p}><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.8 2.8L16 10" /></S>;
export const IErr = (p) => <S {...p}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></S>;
export const IInfo = (p) => <S {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></S>;
export const IX = (p) => <S {...p} d="M18 6L6 18M6 6l12 12" />;
export const IServer = (p) => <S {...p}><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></S>;
export const IRefresh = (p) => <S {...p} d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" />;
export const ISearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>;
export const IBack = (p) => <S {...p} d="M15 18l-6-6 6-6" />;
export const IHistory = (p) => <S {...p}><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></S>;
export const ISettings = (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></S>;
export const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44c-9-3-15-10-15-19 5 1 10 4 13 9V20c-5-2-8-7-7-13 5 2 8 6 9 11 1-5 4-9 9-11 1 6-2 11-7 13v14c3-5 8-8 13-9 0 9-6 16-15 19z" fill="rgb(var(--c-ink))" /></svg>
);
export const IMenu = (p) => <S {...p} d="M4 6h16M4 12h16M4 18h16" />;
export const IGrid = (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>;
export const IAlert = (p) => <S {...p} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />;
export const IShield = (p) => <S {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
export const INetwork = (p) => <S {...p}><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-3h14v3" /></S>;
export const ILogs = (p) => <S {...p} d="M4 6h16M4 10h16M4 14h10M4 18h7" />;
export const IDatabase = (p) => <S {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></S>;
export const ICompass = (p) => <S {...p}><circle cx="12" cy="12" r="10" /><path d="M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z" /></S>;
export const IFlame = (p) => <S {...p} d="M12 22c4 0 7-2.8 7-7 0-3.5-2.4-6.3-4-8-.4 2-1.5 3.3-3 4 0-3-1.5-6-4-8 .3 3-3 5.5-3 11 0 4.2 3 8 7 8z" />;
export const IReport = (p) => <S {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 17v-3M12 17v-6M16 17v-4" /></S>;
export const IMonitor = (p) => <S {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4M6 10l3 3 3-5 3 3 3-2" /></S>;
export const ICube = (p) => <S {...p}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 22V12M21 7l-9 5-9-5" /></S>;
export const IGlobe = (p) => <S {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" /></S>;
export const ISliders = (p) => <S {...p} d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />;
export const IChevron = (p) => <S {...p} d="M9 18l6-6-6-6" />;
export const ICollapse = (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 9l-3 3 3 3" /></S>;
export const ISun = (p) => <S {...p}><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>;
export const IMoon = (p) => <S {...p} d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />;
export const IAuto = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 000 18z" fill="currentColor" stroke="none" /></S>;
export const IChart3D = (p) => <S {...p}><path d="M3 21h18" /><path d="M5 17V9l3-2v10M10.5 17V5l3-2v14M16 17v-6l3-2v8" /></S>;
export const ICloud = (p) => <S {...p} d="M17.5 19a4.5 4.5 0 00.5-8.97A6 6 0 006.34 9.5 4.75 4.75 0 007 19h10.5z" />;
