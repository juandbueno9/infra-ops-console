// Héroe del Resumen: mapa 3D en vivo con HUD de vidrio.
import { Suspense, lazy, useMemo, useState } from 'react';
import { useNames } from './EditName.jsx';
import { buildInfraNodes, fxEnabled, setFx } from '../lib/infra3d.js';
const Scene3D = lazy(() => import('./Scene3D.jsx').then((m) => ({ default: m.Scene3D })));
const Loading3D = ({ h }) => <div className="grid place-items-center text-xs text-muted bg-[#041014]" style={{ height: h }}>Cargando vista 3D…</div>;

const Stat = ({ label, total, bad, warn }) => (
  <div className="hud-chip">
    <div className="text-[10px] uppercase tracking-[.14em] text-muted">{label}</div>
    <div className="flex items-baseline gap-2 mt-0.5">
      <span className="font-mono text-lg text-ink font-semibold">{total}</span>
      {bad > 0 && <span className="font-mono text-[11px] text-crit">● {bad}</span>}
      {warn > 0 && <span className="font-mono text-[11px] text-warn">● {warn}</span>}
      {!bad && !warn && total > 0 && <span className="font-mono text-[11px] text-ok">● OK</span>}
    </div>
  </div>
);

export function InfraHero({ model, web, net, kpi = {}, offline = false }) {
  const [on, setOn] = useState(fxEnabled);
  const names = useNames();
  const infra = useMemo(() => buildInfraNodes(model, web, net, names), [model, web, net, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k) => { const l = infra.nodes.filter((n) => n.kind === k); return { total: l.length, bad: l.filter((n) => n.tone === 'crit').length, warn: l.filter((n) => n.tone === 'warn').length }; };
  const toggle = () => { setFx(!on); setOn(!on); };
  const title = infra.crit ? `${infra.crit} componente(s) con falla` : infra.warn ? `${infra.warn} componente(s) por revisar` : 'Toda la infraestructura operando';

  return (
    <section className="hero3d mb-4">
      <div className="hero3d-frame dark-zone">
        {on ? <Suspense fallback={<Loading3D h={440} />}><Scene3D nodes={infra.nodes} health={infra.health} height={440} /></Suspense> : <div className="h-[120px]" />}
        <span className="hud-corner tl" /><span className="hud-corner tr" /><span className="hud-corner bl" /><span className="hud-corner br" />
        <div className="hud-scan" aria-hidden="true" />
        {offline && (
          <div className="absolute inset-0 z-[15] grid place-items-center pointer-events-none">
            <div className="glass-tip text-center pointer-events-auto max-w-[360px]">
              <div className="text-warn font-semibold text-[13px]">Sin conexión con Prometheus</div>
              <div className="text-[12px] text-ink2 mt-1">El mapa se llena cuando llegan los datos. Abre el túnel en otra terminal:</div>
              <code className="block mt-2 font-mono text-[12px] text-info">npm run tunnel</code>
            </div>
          </div>
        )}
        <div className="hud hud-tl">
          <div className="text-[10px] uppercase tracking-[.2em] text-info/90 flex items-center gap-2"><span className="live-dot" />Centro de observabilidad · en vivo</div>
          <div className={`text-xl font-semibold mt-1 ${infra.crit ? 'text-crit' : infra.warn ? 'text-warn' : 'text-ink'}`}>{title}</div>
        </div>
        <div className="hud hud-tc hidden lg:flex">
          {[['CPU', kpi.cpu != null ? `${kpi.cpu.toFixed(0)}%` : '—'], ['MEM', kpi.mem != null ? `${kpi.mem.toFixed(0)}%` : '—'], ['LAT', kpi.lat != null ? `${Math.round(kpi.lat)} ms` : '—'], ['ALERTAS', kpi.alerts ?? '—']].map(([l, v]) => (
            <div key={l} className="kpi-tick"><span>{l}</span><b>{v}</b></div>
          ))}
        </div>
        <div className="hud hud-tr flex gap-2">
          <a href="#/ejecutiva" className="hud-btn hidden sm:inline-flex">▦ Vista ejecutiva</a>
          <a href="#/3d" className="hud-btn">⛶ Centro de mando</a>
          <button type="button" onClick={toggle} className="hud-btn" aria-pressed={on}>{on ? 'Desactivar 3D' : 'Activar 3D'}</button>
        </div>
        <div className="hud hud-bl flex gap-2 flex-wrap">
          <Stat label="Servidores" {...count('server')} />
          <Stat label="Sitios web" {...count('site')} />
          <Stat label="Red / agencias" {...count('agency')} />
        </div>
        {on && (
          <div className="hud hud-br text-[10.5px] text-muted flex gap-3 items-center">
            <span><i className="dot3d bg-ok" />Operando</span><span><i className="dot3d bg-warn" />Revisar</span><span><i className="dot3d bg-crit" />Falla</span>
            <span className="hidden md:inline text-faint">· arrastra para rotar · clic en un nodo</span>
          </div>
        )}
      </div>
    </section>
  );
}
