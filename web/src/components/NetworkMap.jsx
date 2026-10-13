// Mapa de conectividad: AWS → VPN → sede principal (Bogotá) → SD-WAN → 16 agencias.
// Mapa vectorial de Colombia (departamentos) con enlaces animados del color del estado real,
// anillos de distancia, zoom con la rueda, arrastre, vista inclinada 3D y panel lateral por agencia.
import { useEffect, useMemo, useRef, useState } from 'react';
import GEO from '../lib/geo/colombia.json';
import { AGENCY_GEO, AWS_SITE, HUB_IP, kmBetween } from '../lib/agencyGeo.js';
import { linkState } from '../lib/network.js';

const COL = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', off: '#64748B', info: '#5AB8FF' };
const LABEL = { ok: 'En línea', warn: 'Degradada', crit: 'Sin conexión', off: 'Sin monitorear' };
const D2R = Math.PI / 180;
const X = (lon) => lon * 100;
const Y = (lat) => -Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) * (180 / Math.PI) * 100;
const P = (lat, lon) => [X(lon), Y(lat)];
const ringPath = (r) => r.map(([lo, la], i) => `${i ? 'L' : 'M'}${X(lo).toFixed(1)} ${Y(la).toFixed(1)}`).join('') + 'Z';
const VIEWS = {
  pais: { lon: [-79.4, -71.0], lat: [0.3, 8.6] },
  red: { lon: [-77.6, -73.3], lat: [2.0, 5.9] },
  eje: { lon: [-74.9, -73.2], lat: [3.9, 5.6] },
};
const fms = (v) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);

// Geometría estática (se calcula una vez)
const STATIC = (() => {
  const countries = Object.entries(GEO.countries).map(([k, rings]) => ({ k, d: rings.map(ringPath).join('') }));
  const deps = GEO.deps.map((d) => ({ n: d.n, d: d.r.map(ringPath).join('') }));
  const grat = [];
  for (let lo = -84; lo <= -62; lo += 1) grat.push(`M${X(lo)} ${Y(-6)}L${X(lo)} ${Y(14)}`);
  for (let la = -6; la <= 14; la += 1) grat.push(`M${X(-84)} ${Y(la)}L${X(-62)} ${Y(la)}`);
  return { countries, deps, grat: grat.join('') };
})();

function arcPath(a, b, bend = 0.18) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
  return `M${a[0]} ${a[1]}Q${mx - dy * bend} ${my + dx * bend} ${b[0]} ${b[1]}`;
}

export function NetworkMap({ agencies = [], route = {}, height = 600, compact = false }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 900, h: height });
  const [view, setView] = useState(null); // { cx, cy, s }  s = unidades de mundo por píxel
  const [tilt, setTilt] = useState(false);
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const drag = useRef(null);
  // Ampliar: pantalla completa del navegador (Esc para salir); si no se puede, ocupa toda la ventana
  const root = useRef(null);
  const [full, setFull] = useState(false);
  const [hideSide, setHideSide] = useState(false);
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const onFs = () => { setFull(!!document.fullscreenElement); setVh(window.innerHeight); };
    const onRs = () => setVh(window.innerHeight);
    document.addEventListener('fullscreenchange', onFs); window.addEventListener('resize', onRs);
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('resize', onRs); };
  }, []);
  useEffect(() => { if (!full) return undefined; const k = (e) => e.key === 'Escape' && !document.fullscreenElement && setFull(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [full]);
  const toggleFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (full) { setFull(false); return; }
    if (root.current?.requestFullscreen) root.current.requestFullscreen().catch(() => setFull(true)); else setFull(true);
  };
  const H = full ? Math.max(420, vh) : height;
  // al ampliar u ocultar la lista, el mapa se reencuadra al nuevo tamaño
  const firstFit = useRef(true);
  useEffect(() => { if (firstFit.current) { firstFit.current = false; return; } setView(null); }, [full, hideSide]);

  // ---------- datos ----------
  const live = useMemo(() => Object.fromEntries((agencies || []).map((a) => [a.ip, a])), [agencies]);
  const vpn = route?.vpn, wan = route?.internet;
  const hubGeo = AGENCY_GEO.find((a) => a.hub);
  const hubTone = vpn ? (vpn.ok ? 'ok' : 'crit') : 'off';
  const nodes = useMemo(() => AGENCY_GEO.filter((g) => !g.hub).map((g) => {
    const a = live[g.ip];
    const tone = a ? linkState(a)[1] : 'off';
    return { ...g, a, tone, km: Math.round(kmBetween(hubGeo, g)), p: P(g.lat, g.lon) };
  }), [live, hubGeo]);
  const hubLive = live[HUB_IP];
  const hub = { ...hubGeo, p: P(hubGeo.lat, hubGeo.lon), tone: hubTone, a: hubLive };
  const counts = ['ok', 'warn', 'crit', 'off'].map((t) => nodes.filter((n) => n.tone === t).length);
  const monitored = nodes.filter((n) => n.a);
  const rtts = monitored.map((n) => n.a.rtt).filter((v) => v != null);
  const avgRtt = rtts.length ? rtts.reduce((x, y) => x + y, 0) / rtts.length : null;
  const posture = hubTone === 'crit' || counts[2] > 2 ? ['crit', 'Crítica'] : counts[2] || counts[1] ? ['warn', 'Degradada'] : monitored.length ? ['ok', 'Operando'] : hubTone === 'ok' ? ['info', 'Sede OK · agencias pendientes'] : ['off', 'Sin datos'];

  // ---------- vista (zoom / arrastre) ----------
  const fit = (v, w = size.w, h = size.h) => {
    const x0 = X(v.lon[0]), x1 = X(v.lon[1]), y0 = Y(v.lat[1]), y1 = Y(v.lat[0]);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.max((x1 - x0) / w, (y1 - y0) / h) };
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height); setSize({ w, h }); setView((v) => v || fit(VIEWS.red, w, h)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const V = view || fit(VIEWS.red);
  const vb = [V.cx - (size.w * V.s) / 2, V.cy - (size.h * V.s) / 2, size.w * V.s, size.h * V.s];
  const s = V.s;
  const toScreen = ([wx, wy]) => [(wx - vb[0]) / s, (wy - vb[1]) / s];

  const zoomAt = (f, px = size.w / 2, py = size.h / 2) => setView((v0) => {
    const v = v0 || V, ns = Math.min(Math.max(v.s * f, 0.02), 1.4);
    const wx = v.cx - (size.w * v.s) / 2 + px * v.s, wy = v.cy - (size.h * v.s) / 2 + py * v.s;
    return { s: ns, cx: wx - (px - size.w / 2) * ns, cy: wy - (py - size.h / 2) * ns };
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const wheel = (e) => { if (tilt) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const down = (e) => { if (tilt) return; drag.current = { x: e.clientX, y: e.clientY, v: V }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { const d = drag.current; if (!d) return; setView({ ...d.v, cx: d.v.cx - (e.clientX - d.x) * d.v.s, cy: d.v.cy - (e.clientY - d.y) * d.v.s }); };
  const up = () => { drag.current = null; };
  const flyTo = (n) => { setFocus(n.ip); setView({ cx: n.p[0], cy: n.p[1], s: Math.min(V.s, fit(VIEWS.eje).s * 1.6) }); };

  // Enlace a AWS: sale del mapa hacia el norte (N. Virginia)
  const awsDir = (() => { const a = P(hub.lat, hub.lon), b = P(AWS_SITE.lat, AWS_SITE.lon), L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; })();
  const awsEnd = [hub.p[0] + awsDir[0] * 5000, hub.p[1] + awsDir[1] * 5000];
  const awsTone = hubTone;
  const awsKm = Math.round(kmBetween(hub, AWS_SITE));
  // punto donde el enlace AWS cruza el borde superior de la vista
  const awsEdge = (() => { const t = (vb[1] + 40 * s - hub.p[1]) / (awsDir[1] * 5000); const k = Math.max(0, Math.min(1, t)); return [hub.p[0] + awsDir[0] * 5000 * k, hub.p[1] + awsDir[1] * 5000 * k]; })();
  const awsScreen = toScreen(awsEdge);

  // ---------- etiquetas sin superposición (en píxeles) ----------
  const labels = useMemo(() => {
    const placed = [], out = {};
    if (awsScreen[1] >= 0) placed.push([awsScreen[0] + 10, 2, 200, 40]); // insignia AWS
    const all = [{ ...hub, pri: 0 }, ...nodes.map((n) => ({ ...n, pri: n.tone === 'crit' ? 1 : n.tone === 'warn' ? 2 : n.ip === focus ? 1 : 3 }))].sort((a, b) => a.pri - b.pri);
    for (const n of all) {
      const [sx, sy] = toScreen(n.p), w = Math.max(n.name.length * 6.6, 50) + 14, h = 30;
      // Primero junto al punto; si no cabe, cada vez más lejos (con línea guía) para que ninguna agencia quede sin nombre
      const cand = [[12, -h / 2], [-w - 12, -h / 2], [-w / 2, -h - 12], [-w / 2, 12]];
      for (const d of [45, 75, 110, 150]) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; cand.push([Math.cos(a) * d - w / 2, Math.sin(a) * d - h / 2]); }
      let done = false;
      for (const [dx, dy] of cand) {
        const r = [sx + dx, sy + dy, w, h];
        if (r[0] < 4 || r[1] < 44 || r[0] + w > size.w - 4 || r[1] + h > size.h - 4) continue;
        if (placed.some((q) => r[0] < q[0] + q[2] && r[0] + r[2] > q[0] && r[1] < q[1] + q[3] && r[1] + r[3] > q[1])) continue;
        placed.push(r); out[n.ip] = [dx, dy]; done = true; break;
      }
      if (!done) out[n.ip] = [12, -h / 2]; // último recurso: junto al punto aunque se superponga
    }
    return out;
  }, [nodes, hub.tone, vb[0], vb[1], s, size.w, size.h, focus, awsScreen[0], awsScreen[1]]); // eslint-disable-line react-hooks/exhaustive-deps


  const rings = [50, 100, 200, 400].map((km) => ({ km, r: (km / 111.32) * 100 * (1 / Math.cos(hub.lat * D2R)) }));
  const tip = hover && (hover.hub ? hub : nodes.find((n) => n.ip === hover.ip));

  return (
    <div ref={root} className={`netmap dark-zone ${compact || hideSide ? 'netmap-compact' : ''} ${full && !document.fullscreenElement ? 'fixed inset-0 z-[90] !rounded-none' : ''} ${full ? '!rounded-none' : ''}`}>
      <div className="netmap-grid">
        {/* ----------- Mapa ----------- */}
        <div className="netmap-stage" style={{ height: H }}>
          <div className="netmap-top">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-ink font-semibold text-[13px]">Red de agencias</span>
              <span className="text-[11px] text-muted font-mono">{monitored.length + (hubLive || vpn ? 1 : 0)}/{nodes.length + 1} monitoreadas · SD-WAN · VPN AWS</span>
              {[['ok', counts[0]], ['warn', counts[1]], ['crit', counts[2]], ['off', counts[3]]].map(([t, n]) => n > 0 && (
                <span key={t} className={`netmap-chip netmap-chip-${t}`}>{LABEL[t]} {n}</span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {[['pais', 'País'], ['red', 'Red'], ['eje', 'Región']].map(([k, l]) => <button key={k} type="button" className="netmap-btn" onClick={() => { setTilt(false); setView(fit(VIEWS[k])); }}>{l}</button>)}
              <button type="button" className="netmap-btn" onClick={() => zoomAt(1 / 1.4)} aria-label="Acercar" disabled={tilt}>+</button>
              <button type="button" className="netmap-btn" onClick={() => zoomAt(1.4)} aria-label="Alejar" disabled={tilt}>−</button>
              <button type="button" className={`netmap-btn ${tilt ? 'is-on' : ''}`} onClick={() => setTilt(!tilt)} aria-pressed={tilt} title="Inclinar el mapa en 3D">3D</button>
              {!compact && <button type="button" className={`netmap-btn ${hideSide ? 'is-on' : ''}`} onClick={() => setHideSide(!hideSide)} aria-pressed={hideSide} title={hideSide ? 'Mostrar la lista de agencias' : 'Ocultar la lista para ver el mapa más ancho'}>{hideSide ? 'Lista' : 'Solo mapa'}</button>}
              <button type="button" className={`netmap-btn ${full ? 'is-on' : ''}`} onClick={toggleFull} aria-pressed={full} title={full ? 'Salir de pantalla completa (Esc)' : 'Ampliar a pantalla completa'}>{full ? '✕ Salir' : '⤢ Ampliar'}</button>
            </div>
          </div>

          <div ref={box} className={`netmap-canvas ${tilt ? 'is-tilt' : ''} ${drag.current ? 'is-drag' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
            <svg width={size.w} height={size.h} viewBox={vb.join(' ')} className="block" role="img" aria-label="Mapa de conectividad de la sede y las agencias">
              <defs>
                <radialGradient id="nmHubGlow"><stop offset="0" stopColor="#5AB8FF" stopOpacity=".5" /><stop offset="1" stopColor="#5AB8FF" stopOpacity="0" /></radialGradient>
                <filter id="nmGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={2.2 * s} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <linearGradient id="nmCo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10284a" /><stop offset="1" stopColor="#0b1c36" /></linearGradient>
              </defs>
              <path d={STATIC.grat} className="nm-grat" strokeWidth={s} />
              {STATIC.countries.filter((c) => c.k !== 'CO').map((c) => <path key={c.k} d={c.d} className="nm-country" strokeWidth={0.8 * s} />)}
              <path d={STATIC.countries.find((c) => c.k === 'CO').d} fill="url(#nmCo)" className="nm-co-glow" strokeWidth={5 * s} />
              {STATIC.deps.map((d) => <path key={d.n} d={d.d} className="nm-dep" strokeWidth={0.7 * s} />)}
              <path d={STATIC.countries.find((c) => c.k === 'CO').d} className="nm-co" strokeWidth={1.3 * s} />

              {/* anillos de distancia desde la sede */}
              {rings.map(({ km, r }) => (
                <g key={km}>
                  <circle cx={hub.p[0]} cy={hub.p[1]} r={r} className="nm-ring" strokeWidth={s} strokeDasharray={`${2 * s} ${5 * s}`} />
                  <text x={hub.p[0] + r * 0.707 + 4 * s} y={hub.p[1] - r * 0.707} className="nm-ring-t" fontSize={9.5 * s}>{km} km</text>
                </g>
              ))}

              {/* enlace AWS */}
              <path d={`M${hub.p[0]} ${hub.p[1]}L${awsEnd[0]} ${awsEnd[1]}`} stroke={COL[awsTone]} strokeWidth={1.6 * s} strokeDasharray={`${7 * s} ${5 * s}`} fill="none" opacity=".9">
                {awsTone !== 'crit' && <animate attributeName="stroke-dashoffset" from={`${24 * s}`} to="0" dur="1.1s" repeatCount="indefinite" />}
              </path>

              {/* enlaces sede → agencias */}
              {nodes.map((n) => {
                const d = arcPath(hub.p, n.p), c = COL[n.tone], hot = hover?.ip === n.ip || focus === n.ip;
                return (
                  <g key={n.ip} opacity={focus && !hot ? 0.35 : 1}>
                    <path d={d} stroke={c} strokeOpacity={n.tone === 'off' ? 0.35 : 0.22} strokeWidth={(hot ? 5 : 3.2) * s} fill="none" />
                    <path d={d} stroke={c} strokeWidth={(hot ? 1.8 : 1.2) * s} fill="none" strokeDasharray={n.tone === 'off' ? `${2 * s} ${4 * s}` : `${6 * s} ${4 * s}`} strokeLinecap="round">
                      {(n.tone === 'ok' || n.tone === 'warn') && <animate attributeName="stroke-dashoffset" from={`${20 * s}`} to="0" dur={n.tone === 'warn' ? '2.2s' : '1.2s'} repeatCount="indefinite" />}
                    </path>
                    {(n.tone === 'ok' || n.tone === 'warn') && (
                      <circle r={2.4 * s} fill={c} filter="url(#nmGlow)"><animateMotion dur={`${2.4 + (n.km % 7) * 0.3}s`} repeatCount="indefinite" path={d} /></circle>
                    )}
                  </g>
                );
              })}

              {/* sede */}
              <g onPointerEnter={(e) => setHover({ hub: true, e })} onPointerLeave={() => setHover(null)} className="cursor-pointer">
                <circle cx={hub.p[0]} cy={hub.p[1]} r={46 * s} fill="url(#nmHubGlow)" />
                <circle cx={hub.p[0]} cy={hub.p[1]} r={16 * s} fill="none" stroke={COL[hub.tone === 'off' ? 'info' : hub.tone]} strokeWidth={1.6 * s} opacity=".9">
                  <animate attributeName="r" values={`${12 * s};${30 * s}`} dur="2.4s" repeatCount="indefinite" /><animate attributeName="opacity" values=".9;0" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle cx={hub.p[0]} cy={hub.p[1]} r={11 * s} fill="#041014" stroke={COL[hub.tone === 'off' ? 'info' : hub.tone]} strokeWidth={2.4 * s} />
                <circle cx={hub.p[0]} cy={hub.p[1]} r={5 * s} fill={COL[hub.tone === 'off' ? 'info' : hub.tone]} filter="url(#nmGlow)" />
              </g>

              {/* agencias */}
              {nodes.map((n) => {
                const c = COL[n.tone];
                return (
                  <g key={n.ip} className="cursor-pointer" onPointerEnter={(e) => setHover({ ip: n.ip, e })} onPointerLeave={() => setHover(null)} onClick={() => flyTo(n)}>
                    {n.tone === 'crit' && (
                      <circle cx={n.p[0]} cy={n.p[1]} r={8 * s} fill="none" stroke={c} strokeWidth={1.4 * s}>
                        <animate attributeName="r" values={`${6 * s};${20 * s}`} dur="1.3s" repeatCount="indefinite" /><animate attributeName="opacity" values="1;0" dur="1.3s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={n.p[0]} cy={n.p[1]} r={9 * s} fill="none" stroke={c} strokeOpacity=".6" strokeWidth={1.3 * s} />
                    <circle cx={n.p[0]} cy={n.p[1]} r={4.2 * s} fill={c} filter={n.tone === 'off' ? undefined : 'url(#nmGlow)'} />
                    <circle cx={n.p[0]} cy={n.p[1]} r={14 * s} fill="transparent" />
                  </g>
                );
              })}
            </svg>

            {/* etiquetas HTML (tamaño constante) */}
            <div className="nm-labels">
              <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h} aria-hidden="true">
                {[hub, ...nodes].map((n) => { const off = labels[n.ip]; if (!off) return null; const [sx, sy] = toScreen(n.p); const lx = sx + off[0] + (off[0] < -20 ? Math.max(50, n.name.length * 6.6) + 14 : 0), ly = sy + off[1] + 15;
                  return Math.hypot(off[0] + 20, off[1] + 15) > 60 ? <line key={n.ip} x1={sx} y1={sy} x2={lx} y2={ly} stroke="rgba(165,228,238,.45)" strokeWidth="1" strokeDasharray="3 3" /> : null; })}
              </svg>
              {[hub, ...nodes].map((n) => {
                const off = labels[n.ip]; if (!off) return null;
                const [sx, sy] = toScreen(n.p), c = COL[n.tone === 'off' && n.hub ? 'info' : n.tone];
                const val = n.hub ? (vpn ? (vpn.ok ? `VPN ${fms(vpn.ms)}` : 'VPN caída') : 'Sede principal') : n.a ? (n.a.ok ? fms(n.a.rtt) : 'sin conexión') : 'sin monitorear';
                return (
                  <div key={n.ip} className={`nm-label ${n.hub ? 'nm-label-hub' : ''}`} style={{ left: sx + off[0], top: sy + off[1] }}>
                    <b>{n.hub ? 'SEDE · BOGOTÁ' : n.name.toUpperCase()}</b>
                    <span style={{ color: c }}>{val}</span>
                  </div>
                );
              })}
              {awsScreen[1] >= 0 && (
                <div className="nm-aws" style={{ left: Math.min(size.w - 200, Math.max(8, awsScreen[0] + 12)), top: 8 }}>
                  <span className="nm-aws-dot" style={{ background: COL[awsTone === 'off' ? 'info' : awsTone] }} />
                  <div><b>AWS us-east-1</b><span>{awsKm.toLocaleString('es-CO')} km · monitoreo</span></div>
                </div>
              )}
            </div>

            {tip && hover?.e && (() => {
              const r = box.current?.getBoundingClientRect(); const x = hover.e.clientX - (r?.left || 0), y = hover.e.clientY - (r?.top || 0);
              return (
                <div className="glass-tip absolute z-30 pointer-events-none" style={{ left: Math.min(size.w - 250, x + 14), top: Math.max(8, y - 10) }}>
                  <div className="flex items-center gap-2"><i className="dot3d" style={{ background: COL[tip.tone === 'off' && tip.hub ? 'info' : tip.tone] }} /><b className="text-ink text-[12.5px]">{tip.hub ? 'Sede principal · Bogotá' : tip.name}</b></div>
                  <div className="text-[11px] text-muted mt-0.5">{tip.hub ? 'FortiGate · fin del túnel VPN-AWS' : `${tip.city} · ${tip.km} km de la sede`}</div>
                  <div className="font-mono text-[11.5px] text-ink2 mt-1.5 space-y-0.5">
                    {tip.hub ? (<>
                      <div>VPN AWS: {vpn ? (vpn.ok ? fms(vpn.ms) : 'caída') : 'sin monitorear'}</div>
                      <div>Internet WAN: {wan ? (wan.ok ? fms(wan.ms) : 'sin respuesta a ping') : '—'}</div>
                      <div>IP: {HUB_IP}</div>
                    </>) : tip.a ? (<>
                      <div>Estado: <span style={{ color: COL[tip.tone] }}>{linkState(tip.a)[0]}</span></div>
                      <div>Latencia: {fms(tip.a.rtt)} · pérdida 1 h: {tip.a.loss1 != null ? `${(tip.a.loss1 * 100).toFixed(1)}%` : '—'}</div>
                      <div>Disponibilidad 24 h: {tip.a.u24 != null ? `${(tip.a.u24 * 100).toFixed(2)}%` : '—'}</div>
                      <div>IP: {tip.ip}</div>
                    </>) : (<>
                      <div>IP: {tip.ip}</div>
                      <div className="text-warn">Sin monitorear: requiere ruta AWS ↔ agencia en el FortiGate</div>
                    </>)}
                  </div>
                </div>
              );
            })()}
            <span className="hud-corner tl" /><span className="hud-corner tr" /><span className="hud-corner bl" /><span className="hud-corner br" />
          </div>
          <div className="netmap-foot">
            <span><i className="dot3d" style={{ background: COL.ok }} />En línea</span><span><i className="dot3d" style={{ background: COL.warn }} />Degradada</span>
            <span><i className="dot3d" style={{ background: COL.crit }} />Sin conexión</span><span><i className="dot3d" style={{ background: COL.off }} />Sin monitorear</span>
            <span className="ml-auto text-faint hidden md:inline">rueda = zoom · arrastrar = mover · clic en una agencia = enfocar · {GEO.attribution}</span>
          </div>
        </div>

        {/* ----------- Panel lateral ----------- */}
        {!compact && !hideSide && (
          <aside className="netmap-side" style={{ height: H }}>
            <div className="netmap-side-h">
              <div>
                <div className="text-ink font-semibold text-[13px]">Conectividad</div>
                <div className="text-[10.5px] tracking-[.16em] uppercase text-faint">AWS → VPN → sede → agencias</div>
              </div>
              <span className={`netmap-chip netmap-chip-${posture[0]}`}>{posture[1]}</span>
            </div>
            <div className="netmap-hops">
              {[
                ['AWS us-east-1', 'Prometheus + Blackbox', 'ok', 'origen'],
                ['VPN IPsec', vpn ? vpn.name || 'AWS → LAN sede' : 'sin monitorear', vpn ? (vpn.ok ? 'ok' : 'crit') : 'off', vpn ? (vpn.ok ? fms(vpn.ms) : 'CAÍDA') : '—'],
                ['Internet sede (WAN)', wan?.target || '203.0.113.10', wan ? (wan.ok ? 'ok' : 'warn') : 'off', wan ? (wan.ok ? fms(wan.ms) : 'no responde ping') : '—'],
                ['SD-WAN agencias', `${monitored.length}/${nodes.length} con datos`, counts[2] ? 'crit' : counts[1] ? 'warn' : monitored.length ? 'ok' : 'off', avgRtt != null ? `prom. ${fms(avgRtt)}` : 'pendiente'],
              ].map(([t, sub, tone, v], i) => (
                <div key={t} className="netmap-hop">
                  <span className="netmap-hop-dot" style={{ background: COL[tone], boxShadow: `0 0 10px ${COL[tone]}` }} />
                  {i < 3 && <span className="netmap-hop-line" />}
                  <div className="min-w-0 flex-1"><div className="text-ink text-[12px] font-medium truncate">{t}</div><div className="text-[10.5px] text-faint font-mono truncate">{sub}</div></div>
                  <span className="font-mono text-[11.5px]" style={{ color: tone === 'off' ? undefined : COL[tone] }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="netmap-side-sub">Agencias <span className="font-mono text-faint">{nodes.length + 1}</span></div>
            <ul className="netmap-list">
              <li>
                <button type="button" className="netmap-row" onClick={() => setView({ cx: hub.p[0], cy: hub.p[1], s: fit(VIEWS.eje).s })}>
                  <span className="dot3d shrink-0" style={{ background: COL[hub.tone === 'off' ? 'info' : hub.tone], boxShadow: `0 0 8px ${COL[hub.tone === 'off' ? 'info' : hub.tone]}` }} />
                  <span className="min-w-0 flex-1 text-left"><span className="block text-ink text-[12px] truncate">Bogotá Principal <span className="text-info text-[10px] font-semibold">SEDE</span></span><span className="block text-[10.5px] text-faint font-mono">192.168.10.x · VPN AWS</span></span>
                  <span className="font-mono text-[11.5px]" style={{ color: COL[hub.tone === 'off' ? 'info' : hub.tone] }}>{vpn ? (vpn.ok ? fms(vpn.ms) : 'caída') : '—'}</span>
                </button>
              </li>
              {[...nodes].sort((a, b) => ['crit', 'warn', 'ok', 'off'].indexOf(a.tone) - ['crit', 'warn', 'ok', 'off'].indexOf(b.tone) || a.name.localeCompare(b.name)).map((n) => (
                <li key={n.ip}>
                  <button type="button" className={`netmap-row ${focus === n.ip ? 'is-on' : ''}`} onClick={() => flyTo(n)} onMouseEnter={() => setFocus(n.ip)} onMouseLeave={() => setFocus(null)}>
                    <span className="dot3d shrink-0" style={{ background: COL[n.tone], boxShadow: n.tone === 'off' ? 'none' : `0 0 8px ${COL[n.tone]}` }} />
                    <span className="min-w-0 flex-1 text-left"><span className="block text-ink text-[12px] truncate">{n.name}</span><span className="block text-[10.5px] text-faint font-mono">{n.ip.replace('.254', '.x')} · {n.km} km</span></span>
                    <span className="font-mono text-[11.5px] text-right" style={{ color: n.tone === 'off' ? undefined : COL[n.tone] }}>{n.a ? (n.a.ok ? fms(n.a.rtt) : 'caída') : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!monitored.length && <div className="netmap-note">Las agencias se verán en vivo cuando soporte habilite la ruta AWS ↔ agencias en el FortiGate. La sede y la VPN ya se monitorean.</div>}
          </aside>
        )}
      </div>
    </div>
  );
}
