// Centro de mando 3D a pantalla completa (para la pantalla de la oficina).
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useNames } from '../components/EditName.jsx';
import { buildInfraNodes } from '../lib/infra3d.js';
import { diagnose } from '../lib/network.js';
const Scene3D = lazy(() => import('../components/Scene3D.jsx').then((m) => ({ default: m.Scene3D })));
const Logo3D = lazy(() => import('../components/Logo3D.jsx').then((m) => ({ default: m.Logo3D })));
const Loading3D = ({ h }) => <div className="grid place-items-center text-xs text-muted bg-[#041014]" style={{ height: h }}>Cargando vista 3D…</div>;

export function CommandCenter({ model, web, net }) {
  const ref = useRef(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const names = useNames();
  const infra = useMemo(() => buildInfraNodes(model, web, net, names), [model, web, net, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = infra.nodes.filter((n) => n.tone === 'crit' || n.tone === 'warn').sort((a, b) => (a.tone === 'crit' ? -1 : 1) - (b.tone === 'crit' ? -1 : 1));
  const [, rTitle] = diagnose(net?.route || {}, net?.agencies || []);
  const full = () => (!document.fullscreenElement ? ref.current?.requestFullscreen?.() : document.exitFullscreen?.());

  return (
    <div ref={ref} className="cmd3d dark-zone relative rounded-xl overflow-hidden bg-[#041014]" style={{ height: 'calc(100vh - 130px)', minHeight: 520 }}>
      <Suspense fallback={<Loading3D h="100%" />}><Scene3D nodes={infra.nodes} health={infra.health} height="100%" className="absolute inset-0" /></Suspense>
      <div className="hud hud-tl">
        <div className="flex items-center gap-2"><Suspense fallback={null}><Logo3D variant="mark" transparent height={46} className="w-[46px] -ml-1" /></Suspense>
          <div className="text-[10px] uppercase tracking-[.25em] text-info/90">Infra Ops · Centro de mando</div></div>
        <div className={`text-3xl font-semibold mt-1 ${infra.crit ? 'text-crit' : infra.warn ? 'text-warn' : 'text-ink'}`}>
          {infra.crit ? `${infra.crit} falla(s) activa(s)` : infra.warn ? `${infra.warn} punto(s) por revisar` : 'Todo operando'}
        </div>
        <div className="text-sm text-muted mt-1">{rTitle}</div>
      </div>
      <div className="hud hud-tr text-right">
        <div className="font-mono text-2xl text-ink tabular-nums">{new Date(now).toLocaleTimeString('es-CO', { hour12: false, timeZone: 'America/Bogota' })}</div>
        <div className="text-xs text-muted">{((t) => t[0].toUpperCase() + t.slice(1))(new Date(now).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' }))}</div>
        <button type="button" onClick={full} className="hud-btn mt-2">⛶ Pantalla completa</button>
      </div>
      <div className="hud hud-bl max-w-[420px] w-[calc(100%-32px)]">
        <div className="text-[10px] uppercase tracking-[.2em] text-muted mb-1.5">Atención</div>
        {problems.length ? (
          <ul className="space-y-1 max-h-[34vh] overflow-auto pr-1">
            {problems.slice(0, 12).map((n) => (
              <li key={n.id}><a href={n.href} className="hud-row">
                <span className="dot3d shrink-0" style={{ background: n.tone === 'crit' ? '#EF4444' : '#F59E0B', boxShadow: `0 0 10px ${n.tone === 'crit' ? '#EF4444' : '#F59E0B'}` }} />
                <span className="text-ink truncate">{n.label}</span><span className="text-muted text-[11px] truncate ml-auto">{n.detail}</span>
              </a></li>
            ))}
          </ul>
        ) : <div className="text-ok text-sm">Sin problemas activos</div>}
      </div>
      <div className="hud hud-br flex gap-2">
        {[['Servidores', 'server'], ['Sitios', 'site'], ['Red', 'agency']].map(([l, k]) => {
          const list = infra.nodes.filter((n) => n.kind === k), bad = list.filter((n) => n.tone === 'crit').length;
          return <div key={k} className="hud-chip text-center min-w-[92px]"><div className="text-[10px] uppercase tracking-[.14em] text-muted">{l}</div><div className={`font-mono text-xl font-semibold ${bad ? 'text-crit' : 'text-ok'}`}>{list.length - bad}<span className="text-muted text-sm">/{list.length}</span></div></div>;
        })}
      </div>
    </div>
  );
}
