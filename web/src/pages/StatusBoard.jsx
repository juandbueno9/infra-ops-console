// Estado de servicios: vista resumida para una pantalla en la oficina o para revisar de un vistazo.
import { useRef } from 'react';
import { pulseTone } from '../hooks/useFleetRows.js';
import { goHost, goSite } from '../hooks/useHashRoute.js';
import { diagnose } from '../lib/network.js';
import { Pulse } from '../components/ui.jsx';

const toneBg = { ok: 'border-ok/30 bg-ok/[0.06]', warn: 'border-warn/40 bg-warn/[0.07]', crit: 'border-crit/50 bg-crit/[0.10]', off: 'border-line bg-bg1' };

function Tile({ tone, title, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-lg border px-3 py-2.5 hover:brightness-125 transition ${toneBg[tone] || toneBg.off}`}>
      <div className="flex items-center gap-2 text-ink text-[13px] font-medium truncate"><Pulse tone={tone} />{title}</div>
      <div className="text-[11px] text-muted mt-0.5 truncate">{sub}</div>
    </button>
  );
}

export function StatusBoard({ model, sites, net }) {
  const ref = useRef(null);
  const siteList = sites || [];
  const agencies = net?.agencies || [], route = net?.route || {};
  const [rTone, rTitle] = diagnose(route, agencies);
  const probs = [
    ...siteList.filter((s) => !s.ok).map((s) => `${s.name} caído`),
    ...model.all.filter((r) => r.s.up !== 1).map((r) => `${r.s.host || r.s.inst} sin respuesta`),
    ...(rTone === 'crit' ? [rTitle] : []),
  ];
  const warns = model.all.filter((r) => pulseTone(r) === 'warn').length + siteList.filter((s) => s.ok && s.ssl != null && s.ssl / 86400 < 21).length;
  const overall = probs.length ? 'crit' : warns ? 'warn' : 'ok';
  const full = () => { const el = ref.current; if (!document.fullscreenElement) el?.requestFullscreen?.(); else document.exitFullscreen?.(); };

  return (
    <div ref={ref} className="bg-bg min-h-full p-1">
      <div className={`rounded-xl border px-5 py-4 mb-5 flex items-center gap-4 ${toneBg[overall]}`}>
        <span className={`w-4 h-4 rounded-full ${overall === 'ok' ? 'bg-ok' : overall === 'warn' ? 'bg-warn' : 'bg-crit animate-pulse'}`} aria-hidden="true" />
        <div className="flex-1">
          <div className="text-xl font-semibold text-ink">{overall === 'ok' ? 'Todos los sistemas operan con normalidad' : overall === 'warn' ? 'Operando, con puntos por revisar' : `${probs.length} problema(s) activo(s)`}</div>
          <div className="text-sm text-muted mt-0.5">{probs.length ? probs.slice(0, 4).join(' · ') + (probs.length > 4 ? ` · +${probs.length - 4}` : '') : `${siteList.length} sitios · ${model.all.length} servidores · ${agencies.length || 'sin'} agencias monitoreadas`}</div>
        </div>
        <div className="text-right text-xs text-faint font-mono">{new Date().toLocaleString('es-CO', { hour12: false })}</div>
        <button type="button" onClick={full} className="h-[30px] px-3 rounded-lg border border-line bg-bg1 text-xs text-ink2 no-print">Pantalla completa</button>
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Sitios web</h2>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 mb-6">
        {siteList.length ? siteList.map((s) => {
          const d = s.ssl != null ? Math.floor(s.ssl / 86400) : null;
          const tone = !s.ok ? 'crit' : s.flaky || (d != null && d < 21) ? 'warn' : 'ok';
          return <Tile key={s.target} tone={tone} title={s.name.split('/')[0]} sub={!s.ok ? 'Caído' : s.flaky ? 'Intermitente' : `${s.dur != null ? Math.round(s.dur * 1000) + ' ms' : ''}${d != null ? ` · SSL ${d} d` : ''}`} onClick={() => goSite(s.target)} />;
        }) : <div className="text-xs text-faint col-span-full">Cargando sitios…</div>}
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Servidores</h2>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 mb-6">
        {model.all.map((r) => <Tile key={r.s.inst} tone={pulseTone(r)} title={r.s.host || r.s.inst} sub={r.s.up !== 1 ? 'Sin respuesta' : r.muted ? 'Silenciado' : `CPU ${r.s.cpu != null ? Math.round(r.s.cpu) : '—'}% · Mem ${r.s.memP != null ? Math.round(r.s.memP) : "—"}% · Disco ${r.s.fsP != null ? Math.round(r.s.fsP) : "—"}%`} onClick={() => goHost(r.s.inst)} />)}
      </div>

      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">Red</h2>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Tile tone={route.vpn ? (route.vpn.ok ? 'ok' : 'crit') : 'off'} title="VPN AWS ↔ sede" sub={route.vpn ? (route.vpn.ok ? `${Math.round(route.vpn.ms || 0)} ms` : 'Caída') : 'Sin monitorear'} onClick={() => { location.hash = '#/red'; }} />
        {agencies.map((a) => <Tile key={a.ip} tone={a.ok ? 'ok' : 'crit'} title={a.name} sub={a.ok ? `${a.rtt != null ? Math.round(a.rtt) + ' ms' : ''}` : 'Sin conexión'} onClick={() => { location.hash = '#/red'; }} />)}
        {!agencies.length && <div className="text-xs text-faint self-center">Agencias pendientes (requiere cambio en el FortiGate)</div>}
      </div>
    </div>
  );
}
