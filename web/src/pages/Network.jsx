// Red y agencias: estado de la conexión SD-WAN de cada agencia (ping desde AWS por la VPN).
import { Suspense, lazy, useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { diagnose, internetState, linkState } from '../lib/network.js';
import { dur } from '../lib/format.js';
import { KpiCard, Sparkline } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { UptimeBars, pctUp, upTone } from '../components/UptimeBars.jsx';
import { ISearch } from '../components/icons.jsx';

const NetworkMap = lazy(() => import('../components/NetworkMap.jsx').then((m) => ({ default: m.NetworkMap })));

const ms = (v) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const lossTone = (l) => (l == null ? 'text-faint' : l === 0 ? 'text-ok' : l <= 0.05 ? 'text-warn' : 'text-crit');

function Hop({ title, sub, st, ms, u24, bars, last, partial }) {
  const tone = st == null ? 'off' : st ? 'ok' : partial ? 'warn' : 'crit';
  return (
    <>
      <div className={`flex-1 min-w-[180px] rounded-lg border p-3 ${tone === 'crit' ? 'border-crit/60 bg-crit/5' : tone === 'warn' ? 'border-warn/50 bg-warn/5' : tone === 'ok' ? 'border-line bg-bg1' : 'border-line border-dashed bg-bg1/40'}`}>
        <div className="flex items-center gap-2 text-ink font-medium text-[13px]"><Pulse tone={tone} />{title}</div>
        <div className="font-mono text-[11px] text-faint mt-0.5 truncate">{sub}</div>
        <div className="flex items-baseline justify-between mt-2">
          <span className={`font-mono text-[15px] ${tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{st == null ? 'Sin monitorear' : st || partial ? ms : 'CAÍDO'}</span>
          {u24 != null && <span className={`text-[11px] ${upTone(u24)}`}>24 h {pctUp(u24, 2)}</span>}
        </div>
        {bars && <div className="mt-2"><UptimeBars values={bars} /></div>}
      </div>
      {!last && <div className="hidden md:flex items-center text-faint px-1" aria-hidden="true">→</div>}
    </>
  );
}

function RoutePanel({ route = {}, agencies = [] }) {
  const [tone, title, detail] = diagnose(route, agencies);
  const ag = agencies.length ? agencies.filter((a) => a.ok).length : null;
  return (
    <Panel title="Ruta de conexión · en vivo" meta="se revisa cada 15 s" className="mb-4" bodyClass="p-4">
      <div className={`flex items-start gap-3 rounded-lg px-3.5 py-2.5 mb-3 ${tone === 'crit' ? 'bg-crit/10 border border-crit/40' : tone === 'ok' ? 'bg-ok/10 border border-ok/30' : 'bg-bg1 border border-line'}`} role="status" aria-live="polite">
        <Pulse tone={tone} className="mt-1.5" />
        <div><div className={`font-semibold ${tone === 'crit' ? 'text-crit' : 'text-ink'}`}>{title}</div><div className="text-xs text-muted mt-0.5">{detail}</div></div>
      </div>
      <div className="flex flex-col md:flex-row gap-2 md:gap-0 md:items-stretch">
        <Hop title="Monitoreo AWS" sub="app-server · us-east-1" st ms="origen" />
        {(() => { const st = internetState(route), direct = route.internet?.ok;
          return <Hop title="Internet sede principal" sub={`${route.internet?.target || '203.0.113.10'}${!direct && st ? ' · confirmado por la VPN' : ''}`}
            st={route.internet || route.vpn ? st : null} ms={direct ? ms(route.internet.ms) : st ? 'En línea' : 'Sin datos'} u24={direct ? route.internet.u24 : route.vpn?.u24} bars={direct ? route.internet.bars : route.vpn?.bars} />; })()}
        <Hop title="VPN AWS ↔ sede" sub={route.vpn?.target || '192.168.10.254'} st={route.vpn ? route.vpn.ok : null} ms={ms(route.vpn?.ms)} u24={route.vpn?.u24} bars={route.vpn?.bars} />
        <Hop title="Agencias (SD-WAN)" sub={ag == null ? 'pendiente de alcance desde AWS' : `${ag} de ${agencies.length} en línea`} st={ag == null ? null : ag === agencies.length} partial={ag > 0} ms={`${ag} / ${agencies.length}`} last />
      </div>
    </Panel>
  );
}

export function Network({ data, route, loading, error }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState('table');
  const list = data || [];
  const rows = list.filter((a) => !q || `${a.name} ${a.city} ${a.ip} ${a.subnet}`.toLowerCase().includes(q.toLowerCase()));
  const up = list.filter((a) => a.ok).length, degraded = list.filter((a) => linkState(a)[1] === 'warn').length;
  const rtts = list.map((a) => a.rtt).filter((v) => v != null);
  const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
  // Solo las agencias que tienen historial de 24 h (las que se leen del FortiGate no lo tienen y no deben contar como 0 %)
  const withU = list.filter((a) => a.u24 != null);
  const u24 = withU.length ? withU.reduce((t, a) => t + a.u24, 0) / withU.length : null;

  return (
    <>
      <PageHead title="Red y agencias" sub="Conexión SD-WAN de cada agencia, medida con ping cada 30 s desde AWS a través de la VPN">
        <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px]">
          <ISearch size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar agencia, ciudad, IP…" aria-label="Buscar agencia" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-52" />
        </label>
        <div className="seg" role="group" aria-label="Vista">
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabla</button>
          <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Tarjetas</button>
        </div>
      </PageHead>
      <div className="mb-4"><Suspense fallback={<div className="h-[720px] grid place-items-center text-xs text-muted panel">Cargando mapa…</div>}><NetworkMap agencies={data || []} route={route || {}} height={720} /></Suspense></div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Agencias en línea" lead={<Pulse tone={!list.length ? 'off' : up === list.length ? 'ok' : 'crit'} />} value={up} unit={` / ${list.length}`}
          foot={list.length - up ? `${list.length - up} sin conexión ahora` : list.length ? 'Todas conectadas' : 'Sin datos'} />
        <KpiCard label="Degradadas" lead={<Pulse tone={degraded ? 'warn' : 'ok'} />} value={degraded} foot="Pérdida > 5 % o latencia > 150 ms" />
        <KpiCard label="Latencia media" value={avgRtt != null ? Math.round(avgRtt) : '—'} unit={avgRtt != null ? ' ms' : ''} foot="AWS → agencia (ida y vuelta)" />
        <KpiCard label="Disponibilidad 24 h" value={pctUp(u24, 2)} foot={withU.length === list.length ? 'Promedio de todas las agencias' : `Promedio de ${withU.length} con historial · las de FortiGate muestran el estado actual`} />
      </div>

      <RoutePanel route={route} agencies={list} />

      {error && !list.length ? (
        <Panel className="mb-4" bodyClass="p-4 text-[12.5px] text-muted">No se pudo consultar Prometheus: {error.message}</Panel>
      ) : !list.length ? (
        <Panel className="mb-4" bodyClass="p-5 text-[12.5px] text-ink2 space-y-2">
          <p className="m-0 text-ink font-medium">{loading ? 'Cargando…' : 'Las agencias todavía no se alcanzan desde AWS.'}</p>
          {!loading && <p className="m-0">El servidor de monitoreo llega a la LAN de la sede (192.168.10.254) pero no a las redes 192.168.11–25 de las agencias ni a la administración del FortiGate. Para verlas en tiempo real hay que permitir ese tráfico por la VPN-AWS o instalar una sonda en la sede (ver guía). Cuando haya alcance, vuelve a ejecutar <span className="font-mono text-ink">deploy/aplicar-prometheus.sh</span>.</p>}
        </Panel>
      ) : view === 'table' ? (
        <section className="panel mb-4 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Agencia</th><th>Dirección</th><th>Red / IP monitoreada</th><th className="min-w-[200px]">Últimas 24 h</th><th className="num">Latencia</th><th>Última hora</th><th className="num">Pérdida 1 h</th><th className="num">24 h</th><th className="num">7 días</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.length ? rows.map((a) => { const [lbl, tone] = linkState(a); return (
                <tr key={a.ip}>
                  <td><div className="flex items-center gap-2.5"><Pulse tone={tone} /><div><div className="text-ink font-medium whitespace-nowrap"><EditName k={`ag:${a.ip}`} orig={a.name} /></div>{a.city && a.city !== a.name && <div className="text-[11px] text-faint">{a.city}</div>}</div></div></td>
                  <td className="text-xs text-muted max-w-[220px]">{a.address || '—'}</td>
                  <td><div className="font-mono text-ink text-[12px]">{a.src === 'fortigate' ? a.subnet : a.ip}</div><div className="font-mono text-[11px] text-faint">{a.src === 'fortigate' ? <span className="text-info">vía FortiGate{a.via ? ` · ${a.via}` : ''}</span> : a.subnet}</div></td>
                  <td><UptimeBars values={a.bars} /></td>
                  <td className="num">{ms(a.rtt)}</td>
                  <td><Sparkline values={a.spark} color={tone === 'ok' ? '#10B981' : '#F59E0B'} /></td>
                  <td className={`num ${lossTone(a.loss1)}`} title={a.links?.length ? a.links.map((l) => `${l.member}: ${l.up ? `${l.latency ?? '?'} ms · pérdida ${l.loss ?? '?'}%` : 'caído'}`).join('\n') : undefined}>{a.loss1 == null ? '—' : `${(a.loss1 * 100).toFixed(a.loss1 && a.loss1 < 0.1 ? 1 : 0)}%`}</td>
                  <td className={`num ${upTone(a.u24)}`}>{pctUp(a.u24, 2)}</td>
                  <td className={`num ${upTone(a.u7)}`}>{pctUp(a.u7, 2)}</td>
                  <td><Badge tone={tone}>{lbl}{!a.ok && a.downFor != null ? ` · ${dur(a.downFor)}` : ''}</Badge></td>
                </tr>); }) : <tr><td colSpan={10}><Empty>Ninguna agencia coincide con la búsqueda.</Empty></td></tr>}
            </tbody>
          </table>
        </section>
      ) : (
        <div className="grid gap-3 mb-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((a) => { const [lbl, tone] = linkState(a); return (
            <section key={a.ip} className={`panel p-3.5 ${tone === 'crit' ? 'border-crit/60' : tone === 'warn' ? 'border-warn/50' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div><div className="flex items-center gap-2 text-ink font-medium"><Pulse tone={tone} /><EditName k={`ag:${a.ip}`} orig={a.name} /></div><div className="text-[11px] text-faint mt-0.5">{a.address || a.city}</div></div>
                <Badge tone={tone}>{lbl}</Badge>
              </div>
              <div className="flex items-end justify-between mb-2">
                <div><div className="font-mono text-lg text-ink">{ms(a.rtt)}</div><div className="text-[11px] text-faint font-mono">{a.ip}</div></div>
                <Sparkline values={a.spark} color={tone === 'ok' ? '#10B981' : '#F59E0B'} className="w-[110px] h-[30px]" />
              </div>
              <UptimeBars values={a.bars} />
              <div className="flex justify-between text-[11px] text-muted mt-1.5"><span>24 h <b className={upTone(a.u24)}>{pctUp(a.u24, 2)}</b></span><span>Pérdida 1 h <b className={lossTone(a.loss1)}>{a.loss1 == null ? '—' : `${(a.loss1 * 100).toFixed(0)}%`}</b></span></div>
            </section>); })}
        </div>
      )}
      <p className="text-xs text-faint">El ping sale del servidor de monitoreo en AWS, pasa por la VPN-AWS del FortiGate principal y llega a cada agencia por SD-WAN. Si todas caen a la vez, el problema está en la VPN hacia AWS o en la sede principal, no en las agencias.</p>
    </>
  );
}
