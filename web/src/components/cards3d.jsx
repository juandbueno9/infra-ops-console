// Tarjetas 3D profesionales (CSS 3D, sin WebGL): inclinación con el ratón, capas con profundidad,
// reflejo de vidrio, medidores circulares y tarjetas de servidor que giran para mostrar el detalle.
import { useId, useRef, useState } from 'react';
import { LEVEL } from '../lib/analyze.js';
import { since } from '../lib/format.js';
import { goHost } from '../hooks/useHashRoute.js';
import { pulseTone } from '../hooks/useFleetRows.js';
import { Sparkline } from './charts.jsx';
import { HostMenu } from './HostMenu.jsx';
import { Badge, Pulse } from './ui.jsx';

const TONE = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', off: '#64748B', info: '#1FA9C0' };
const toneFor = (v, warn = 75, bad = 90) => (v == null ? 'off' : v >= bad ? 'crit' : v >= warn ? 'warn' : 'ok');
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Contenedor con inclinación 3D siguiendo al ratón y brillo especular. */
export function HoloCard({ children, className = '', tone, onClick, max = 9, as: Tag = 'div', ...rest }) {
  const ref = useRef(null);
  const move = (e) => {
    const el = ref.current;
    if (!el || reduceMotion()) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - 0.5) * max * 2}deg`);
    el.style.setProperty('--rx', `${(0.5 - y) * max * 1.4}deg`);
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };
  const leave = () => { const el = ref.current; if (el) { el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg'); } };
  return (
    <Tag ref={ref} onMouseMove={move} onMouseLeave={leave} onClick={onClick} className={`holo ${tone ? `holo-${tone}` : ''} ${onClick ? 'cursor-pointer' : ''} ${className}`} {...rest}>
      <div className="holo-inner">{children}</div>
      <span className="holo-glare" aria-hidden="true" />
    </Tag>
  );
}

/** Medidor circular con degradado, marcas y brillo. value 0..max */
export function RingGauge({ value, max = 100, size = 92, stroke = 8, tone, color, children, ticks = true, title }) {
  const id = useId().replace(/:/g, '');
  const v = value == null || !isFinite(value) ? null : Math.max(0, Math.min(max, value));
  const c = color || TONE[tone || toneFor(v == null ? null : (v / max) * 100)];
  const R = (size - stroke) / 2 - 4, C = 2 * Math.PI * R, f = v == null ? 0 : v / max;
  return (
    <div className="ring3d" style={{ width: size, height: size }} title={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c} stopOpacity=".55" /><stop offset="1" stopColor={c} /></linearGradient>
          <filter id={`f${id}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
        </defs>
        {ticks && Array.from({ length: 40 }, (_, i) => {
          const a = (i / 40) * Math.PI * 2 - Math.PI / 2, r1 = size / 2 - 1.5, r2 = r1 - (i % 5 ? 2.5 : 4.5);
          return <line key={i} x1={size / 2 + Math.cos(a) * r1} y1={size / 2 + Math.sin(a) * r1} x2={size / 2 + Math.cos(a) * r2} y2={size / 2 + Math.sin(a) * r2} className="ring3d-tick" strokeWidth={i % 5 ? 1 : 1.4} opacity={i / 40 <= f ? 0.95 : 0.3} style={i / 40 <= f ? { stroke: c } : undefined} />;
        })}
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" className="ring3d-track" strokeWidth={stroke} />
        {v != null && <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${C * f} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} filter={`url(#f${id})`} opacity=".55" />}
        {v != null && <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={`url(#g${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${C * f} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring3d-arc" />}
      </svg>
      <div className="ring3d-center">{children}</div>
    </div>
  );
}

/** Tarjeta KPI holográfica: valor grande + medidor + tendencia. */
export function HoloKpi({ label, value, unit, sub, gauge, gaugeMax = 100, tone, icon, foot, spark, sparkColor, gaugeLabel }) {
  const t = tone || toneFor(gauge == null ? null : (gauge / gaugeMax) * 100);
  return (
    <HoloCard tone={t} className="holo-kpi">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 holo-z1">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[.12em] text-muted font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={label}>{icon}{label}</div>
          <div className={`font-mono ${String(value).length > 13 ? 'text-[19px]' : String(value).length > 10 ? 'text-[23px]' : 'text-[28px]'} leading-none font-semibold text-ink mt-2.5 tabular-nums holo-value whitespace-nowrap`}>{value}{unit && <small className="text-[13px] text-muted font-medium ml-1">{unit}</small>}</div>
          {sub && <div className="font-mono text-[13px] text-ink2 mt-1.5 whitespace-nowrap">{sub}</div>}
          {foot && <div className="text-[11.5px] text-faint mt-2 truncate">{foot}</div>}
        </div>
        {gauge !== undefined && (
          <div className="holo-z2 shrink-0">
            <RingGauge value={gauge} max={gaugeMax} tone={t} size={78} stroke={7}>
              <span className="font-mono text-[12px] font-semibold text-ink">{gaugeLabel ?? (gauge == null ? '—' : `${Math.round((gauge / gaugeMax) * 100)}%`)}</span>
            </RingGauge>
          </div>
        )}
      </div>
      {spark && spark.length > 1 && <div className="holo-z1 mt-2"><Sparkline values={spark} color={sparkColor || TONE[t]} className="w-full h-8" /></div>}
    </HoloCard>
  );
}

function StatusBadge({ r }) {
  if (r.muted) return <Badge tone="off">Silenciado</Badge>;
  if (r.s.up !== 1) return <Badge tone="crit">Sin respuesta</Badge>;
  return <Badge tone={LEVEL[r.a.level].tone}>{LEVEL[r.a.level].label}</Badge>;
}

/** Tarjeta de servidor que gira (frente: medidores · reverso: detalle). Clic en el frente abre el servidor. */
export function ServerFlipCard({ r, menu = true }) {
  const [flip, setFlip] = useState(false);
  const s = r.s, tone = pulseTone(r), sd = (s.svcDown || []).length, dd = s.diskDays;
  const open = () => goHost(s.inst);
  const Flip = ({ back }) => (
    <button type="button" className="flip-btn" onClick={(e) => { e.stopPropagation(); setFlip(!back); }} aria-label={back ? 'Ver medidores' : 'Ver detalle'} title={back ? 'Ver medidores' : 'Ver detalle'}>⟲</button>
  );
  return (
    <div className={`flip3d ${flip ? 'is-flipped' : ''} ${r.muted ? 'opacity-60' : ''}`}>
      <div className="flip3d-inner">
        {/* Frente */}
        <HoloCard tone={tone} className="flip3d-face" max={6} role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
          <div className="flex items-center gap-2.5 holo-z1">
            <Pulse tone={tone} />
            <div className="min-w-0 flex-1"><div className="font-mono text-ink font-semibold truncate">{s.host || s.inst}</div><div className="font-mono text-faint text-[11px] truncate">{s.itype || '—'} · {s.az || '—'}</div></div>
            <StatusBadge r={r} />
            {menu && <span onClick={(e) => e.stopPropagation()}><HostMenu host={s} /></span>}
          </div>
          <div className="grid grid-cols-3 gap-1 mt-3 holo-z2 justify-items-center">
            {[['CPU', s.cpu], ['Memoria', s.memP], ['Disco', s.fsP]].map(([l, v]) => (
              <div key={l} className="flex flex-col items-center">
                <RingGauge value={s.up === 1 ? v : null} size={74} stroke={6}><span className="font-mono text-[13px] font-semibold text-ink">{s.up === 1 && v != null ? Math.round(v) : '—'}<small className="text-[9px] text-muted">%</small></span></RingGauge>
                <span className="text-[10.5px] uppercase tracking-[.12em] text-muted mt-1">{l}</span>
              </div>
            ))}
          </div>
          <div className="holo-z1 mt-2"><Sparkline values={s.spark} color={r.muted ? '#64748B' : TONE[tone] === TONE.ok ? '#1FA9C0' : TONE[tone]} className="w-full h-[26px]" /></div>
          <div className="flex items-center gap-2 text-[11.5px] text-muted border-t border-line pt-2 mt-1.5 holo-z1">
            <span>{r.a.A.length ? <span className={r.a.level === 'bad' ? 'text-crit' : 'text-warn'}>{r.a.A.length} alerta(s)</span> : 'Sin alertas'}</span>
            <span className="ml-auto text-faint">Detalle</span><Flip />
          </div>
        </HoloCard>
        {/* Reverso */}
        <HoloCard tone={tone} className="flip3d-face flip3d-back" max={6}>
          <div className="flex items-center gap-2 holo-z1"><Pulse tone={tone} /><span className="font-mono text-ink font-semibold truncate flex-1">{s.host || s.inst}</span><Flip back /></div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-[12px] holo-z1">
            {[
              ['Carga 1 min', s.load?.[0] != null ? `${s.load[0].toFixed(2)}${s.cpus ? ` / ${s.cpus}` : ''}` : '—'],
              ['Servicios', s.svcTotal != null ? <span className={sd ? 'text-crit' : ''}>{s.svcTotal - sd}/{s.svcTotal}</span> : '—'],
              ['Contenedores', s.ctrTotal ? <span className={s.ctrBad?.length ? 'text-crit' : ''}>{s.ctrRunning}/{s.ctrTotal}</span> : '—'],
              ['Sesiones', (s.sessions || []).length],
              ['Encendido', since(s.boot)],
              ['Disco lleno en', dd != null ? <span className={dd < 14 ? 'text-crit' : dd < 30 ? 'text-warn' : ''}>~{Math.round(dd)} días</span> : 'estable'],
            ].map(([k, v]) => <div key={k}><dt className="text-[10.5px] uppercase tracking-[.1em] text-faint">{k}</dt><dd className="m-0 font-mono text-ink">{v}</dd></div>)}
          </dl>
          <div className="mt-3 space-y-1 holo-z1">
            {r.a.A.slice(0, 3).map(([k, t]) => <div key={t} className={`text-[11.5px] truncate ${k === 'bad' ? 'text-crit' : 'text-warn'}`}>● {t}</div>)}
            {!r.a.A.length && <div className="text-[11.5px] text-ok">● Todo en orden</div>}
          </div>
          <button type="button" onClick={open} className="hud-btn w-full justify-center mt-3 holo-z2">Abrir servidor →</button>
        </HoloCard>
      </div>
    </div>
  );
}

const siteName = (t) => t.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');

/** Tarjeta de sitio web: estado, latencia y días de certificado. */
export function SiteCard3D({ w }) {
  const days = w.ssl != null ? Math.floor(w.ssl / 86400) : null;
  const ms = w.dur != null ? Math.round(w.dur * 1000) : null;
  const tone = !w.ok ? 'crit' : (days != null && days < 21) || (ms != null && ms > 2000) ? 'warn' : 'ok';
  return (
    <HoloCard tone={tone} max={7} className="site3d" onClick={() => { location.hash = `#/sitio/${encodeURIComponent(w.target)}`; }}>
      <div className="flex items-center gap-3">
        <div className="holo-z2 shrink-0">
          <RingGauge value={days == null ? null : Math.min(days, 90)} max={90} size={64} stroke={5} tone={days == null ? 'off' : days < 7 ? 'crit' : days < 21 ? 'warn' : 'ok'} ticks={false} title="Días de certificado SSL (escala 90)">
            <span className="font-mono text-[12px] font-semibold text-ink leading-none text-center">{days ?? '—'}<br /><small className="text-[8.5px] text-muted tracking-wider">SSL</small></span>
          </RingGauge>
        </div>
        <div className="min-w-0 flex-1 holo-z1">
          <div className="flex items-center gap-2"><Pulse tone={tone} /><span className="text-ink text-[12.5px] font-semibold truncate">{siteName(w.target).split('/')[0]}</span></div>
          <div className="text-[11px] text-faint font-mono truncate">{siteName(w.target).split('/').slice(1).join('/') || '/'}</div>
          <div className="mt-2 h-1.5 rounded-full bg-line/70 overflow-hidden"><i className="block h-full rounded-full" style={{ width: `${ms == null ? 0 : Math.min(100, (ms / 2500) * 100)}%`, background: ms == null ? 'transparent' : ms > 2000 ? TONE.warn : 'linear-gradient(90deg,#22D3EE,#1FA9C0)' }} /></div>
          <div className="flex justify-between text-[10.5px] font-mono mt-1"><span className={w.ok ? 'text-ink2' : 'text-crit font-semibold'}>{w.ok ? `${ms ?? '—'} ms` : 'CAÍDO'}</span><span className="text-faint">{w.code ? `HTTP ${w.code}` : ''}</span></div>
        </div>
      </div>
    </HoloCard>
  );
}

/** Tarjeta compacta de enlace de red (VPN / agencia). */
export function LinkCard3D({ name, ok, tone, sub, ms }) {
  const t = tone || (ok ? 'ok' : 'crit');
  return (
    <HoloCard tone={t} max={8} className="link3d" onClick={() => { location.hash = '#/red'; }}>
      <div className="flex items-center gap-2.5 holo-z1">
        <span className="link3d-orb" style={{ '--c': TONE[t] }} />
        <div className="min-w-0 flex-1"><div className="text-ink text-[12.5px] font-semibold truncate">{name}</div><div className="text-[11px] text-faint truncate">{sub}</div></div>
        <span className="font-mono text-[12px] text-ink2 holo-z2">{ms != null ? `${Math.round(ms)} ms` : ''}</span>
      </div>
    </HoloCard>
  );
}
