// Marca Infra Ops en 3D (CSS): monograma C• extruido por capas + nombre con relieve.
// Liviano (sin WebGL) para usarse en el menú en todas las páginas.
import { monogramPath } from '../lib/brand.js';

// Trazo anterior (hoja) — se conserva por compatibilidad
export const LEAF = 'M24 44c-9-3-15-10-15-19 5 1 10 4 13 9V20c-5-2-8-7-7-13 5 2 8 6 9 11 1-5 4-9 9-11 1 6-2 11-7 13v14c3-5 8-8 13-9 0 9-6 16-15 19z';
const M = monogramPath();

export function BrandEmblem({ size = 30, spin = false }) {
  const layers = 7;
  return (
    <span className={`brand-emblem ${spin ? 'brand-spin' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="brand-emblem-rot">
        {Array.from({ length: layers }, (_, i) => (
          <svg key={i} viewBox="0 0 48 48" width={size} height={size} style={{ transform: `translateZ(${(i - layers + 1) * 0.9}px)` }}>
            <path d={M.c} fill={i === layers - 1 ? 'url(#brandFace)' : i === 0 ? '#0B1B4D' : '#1E3A8A'} />
            <path d={M.d} fill={i === layers - 1 ? '#67E8F9' : '#0E7490'} />
          </svg>
        ))}
        <svg viewBox="0 0 48 48" width={size} height={size} className="brand-shine" style={{ transform: 'translateZ(0.6px)' }}>
          <defs>
            <linearGradient id="brandFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9EE6F0" /><stop offset=".5" stopColor="#1FA9C0" /><stop offset="1" stopColor="#007B8D" /></linearGradient>
            <linearGradient id="brandShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".8" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <clipPath id="brandClip"><path d={M.c} /><path d={M.d} /></clipPath>
          </defs>
          <g clipPath="url(#brandClip)"><rect className="brand-shine-bar" x="-30" y="-10" width="18" height="70" fill="url(#brandShine)" transform="rotate(20)" /></g>
        </svg>
      </span>
    </span>
  );
}

/** Emblema + nombre. compact = solo emblema (menú colapsado). */
export function BrandLogo({ compact = false, sub = 'Observabilidad' }) {
  return (
    <span className="brand-logo">
      <BrandEmblem size={compact ? 28 : 32} />
      {!compact && (
        <span className="leading-tight min-w-0">
          <span className="brand-word" data-text="Infra Ops">Infra Ops</span>
          <span className="block text-faint text-[10.5px] tracking-[.22em] uppercase mt-0.5">{sub}</span>
        </span>
      )}
    </span>
  );
}
