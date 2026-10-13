import { lazy, Suspense, useMemo, useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { LEVEL } from '../lib/analyze.js';
import { ago, clock, last, pct, since } from '../lib/format.js';
import { useHostActions } from '../hooks/useHostActions.jsx';
import { goHost } from '../hooks/useHashRoute.js';
import { KpiCard, Sparkline } from '../components/charts.jsx';
import { HostMenu } from '../components/HostMenu.jsx';
import { Badge, Count, Empty, Meter, Panel, Pulse } from '../components/ui.jsx';
import { IBellOff, ISearch } from '../components/icons.jsx';
import { AlertsTable, PageHead, WebTable } from '../components/tables.jsx';
import { pulseTone } from '../hooks/useFleetRows.js';
import { InfraHero } from '../components/InfraHero.jsx';
import { ServerFlipCard } from '../components/cards3d.jsx';
import { WindowsPanel } from '../components/Windows.jsx';
import { SynologyPanel, nasItems, useSynology } from '../components/Synology.jsx';
import { AzurePanel, azureItems, useAzure } from '../components/AzurePanel.jsx';

const ServerTowers3D = lazy(() => import('../components/ServerTowers3D.jsx').then((m) => ({ default: m.ServerTowers3D })));

const readPref = (k, d) => { try { return localStorage.getItem('infra.' + k) || d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem('infra.' + k, v); } catch { /* sin almacenamiento */ } };

function StatusBadge({ r }) {
  if (r.muted) return <Badge tone="off"><IBellOff size={12} />Silenciado</Badge>;
  if (r.s.up !== 1) return <Badge tone="crit">Sin respuesta</Badge>;
  return <Badge tone={LEVEL[r.a.level].tone}>{LEVEL[r.a.level].label}</Badge>;
}
const Alerts = ({ a }) => {
  const c = a.A.filter((x) => x[0] === 'bad').length, w = a.A.length - c;
  return <span className="inline-flex gap-1 justify-end">{c > 0 && <Count n={c} tone="crit" />}{w > 0 && <Count n={w} tone="warn" />}{!c && !w && <Count n={0} />}</span>;
};

export function Fleet({ data, model, net }) {
  const act = useHostActions();
  const nas = useSynology(60);
  const az = useAzure(60);
  const [filter, setFilter] = useState(() => readPref('filter', 'all'));
  const [view, setView] = useState(() => readPref('view', 'table'));
  const [q, setQ] = useState('');

  const { all, crit, warn, alerts, online, count: cnt } = model;
  const n = all.length;
  const K = data?.kpi || {};
  const up = all.filter((r) => r.s.up === 1);
  const avg = (f) => { const v = up.map((r) => r.s[f]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const cpuNow = last(K.cpu) ?? avg('cpu'), memNow = last(K.mem) ?? avg('memP'), latNow = last(K.lat), errNow = last(K.err);
  const d = (arr, now) => (now != null && ago(arr, 15) != null ? now - ago(arr, 15) : null);

  const rows = all.filter((r) => (filter === 'all' || r.eff === filter) && (!q || r.s.inst.toLowerCase().includes(q.toLowerCase())));
  const web = data?.web || [];
  const towers = useMemo(() => [
    ...all.map((r) => ({
      id: r.s.inst, kind: 'server', label: r.s.host || r.s.inst, tone: pulseTone(r), href: `#/s/${encodeURIComponent(r.s.inst)}`,
      values: r.s.up === 1 ? { cpu: r.s.cpu, mem: r.s.memP, disk: r.s.fsP } : {},
      note: r.s.up !== 1 ? 'Sin respuesta del agente' : r.a.A.length ? `${r.a.A.length} alerta(s)` : 'Sin alertas',
    })),
    ...azureItems(az.data, act.alias),
    ...nasItems(nas.data, act.alias),
  ], [all, nas.data, az.data, act.alias]);
  const setF = (v) => { setFilter(v); writePref('filter', v); };
  const setV = (v) => { setView(v); writePref('view', v); };

  return (
    <>
      <PageHead title="Resumen de infraestructura"
        sub={`${n} hosts · ${online} en línea${Object.keys(act.shared.hidden).length ? ` · ${Object.keys(act.shared.hidden).length} oculto(s)` : ''}${cnt('mute') ? ` · ${cnt('mute')} silenciado(s)` : ''}`} />

      <InfraHero model={model} web={web} net={net} offline={!data} kpi={{ cpu: cpuNow, mem: memNow, lat: latNow, alerts: crit + warn }} />

      {towers.length > 0 && (
        <Panel title="Servidores" meta="Estado en vivo · clic en un gabinete para ver el detalle" className="mb-4" bodyClass="p-3">
          <div className="screen3d dark-zone">
            <Suspense fallback={<div className="grid place-items-center text-xs text-muted bg-[#041014]" style={{ height: 440 }}>Cargando servidores 3D…</div>}>
              <ServerTowers3D items={towers} height={440} />
            </Suspense>
          </div>
        </Panel>
      )}

      <AzurePanel st={az} />
      <WindowsPanel />
      <SynologyPanel st={nas} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
        <KpiCard label="Hosts en línea" lead={<Pulse tone={online === n ? 'ok' : 'crit'} />} value={online} unit={` / ${n}`} foot={online === n ? 'Todos los agentes responden' : `${n - online} sin respuesta`} />
        <KpiCard label="CPU promedio" value={cpuNow != null ? cpuNow.toFixed(1) : '—'} unit="%" delta={d(K.cpu, cpuNow)} spark={K.cpu} color="#1FA9C0" foot="Media de la flota · 2 h" />
        <KpiCard label="Memoria promedio" value={memNow != null ? memNow.toFixed(1) : '—'} unit="%" delta={d(K.mem, memNow)} spark={K.mem} color="#A3E635" foot="Media de la flota · 2 h" />
        <KpiCard label="Latencia web" value={latNow != null ? Math.round(latNow) : '—'} unit={latNow != null ? ' ms' : ''} deltaUnit="%"
          delta={latNow != null && ago(K.lat, 15) ? ((latNow - ago(K.lat, 15)) / ago(K.lat, 15)) * 100 : null} spark={K.lat} color="#22D3EE" foot={latNow != null ? 'Media de sondas Blackbox' : 'Sin sondas Blackbox'} />
        <KpiCard label="Tasa de errores web" value={errNow != null ? errNow.toFixed(1) : '—'} unit={errNow != null ? '%' : ''} delta={d(K.err, errNow)} spark={K.err} color="#1FA9C0" foot={errNow != null ? 'Sondas fallidas · 10 min' : 'Sin sondas Blackbox'} />
        <KpiCard label="Alertas activas" lead={<Pulse tone={crit ? 'crit' : warn ? 'warn' : 'ok'} />} value={crit + warn}
          foot={<><span className="text-crit">{crit} críticas</span> · <span className="text-warn">{warn} atención</span></>} />
      </div>

      <section className="panel mb-4">
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line flex-wrap">
          <h2 className="m-0 text-[13px] font-semibold text-ink mr-1">Hosts</h2>
          <div className="seg" role="group" aria-label="Filtrar por estado">
            {[['all', 'Todos', n], ['bad', 'Críticos', cnt('bad')], ['warn', 'Atención', cnt('warn')], ['ok', 'Saludables', cnt('ok')]].map(([k, l, c]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setF(k)}>{l} <span className="font-mono text-[11px] text-faint">{c}</span></button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px]">
            <ISearch size={14} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar host…" aria-label="Filtrar hosts" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-44" />
          </label>
          <div className="flex-1" />
          <div className="seg" role="group" aria-label="Vista">
            <button type="button" aria-pressed={view === 'table'} onClick={() => setV('table')}>Tabla</button>
            <button type="button" aria-pressed={view === 'cards'} onClick={() => setV('cards')}>Tarjetas</button>
          </div>
        </div>

        {!rows.length ? <Empty>{n ? 'Ningún host coincide con el filtro.' : data ? 'No hay hosts con node_exporter en Prometheus.' : 'Cargando…'}</Empty>
          : view === 'table' ? (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Host</th><th>Estado</th><th>CPU</th><th>Memoria</th><th>Disco /</th><th className="num">Carga</th><th className="num">Servicios</th><th className="num">Contenedores</th><th className="num">Sesiones</th><th className="num">Alertas</th><th className="num">Uptime</th><th>CPU · 1 h</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => { const s = r.s, sd = (s.svcDown || []).length; return (
                    <tr key={s.inst} className={`cursor-pointer ${r.muted ? 'opacity-55' : ''}`} onClick={() => goHost(s.inst)}>
                      <td><div className="flex items-center gap-2.5"><Pulse tone={pulseTone(r)} /><div><div className="font-mono text-[12.5px] font-medium text-ink whitespace-nowrap"><EditName k={s.inst} orig={s.hostOrig || s.host} /></div><div className="font-mono text-[11px] text-faint whitespace-nowrap">{s.itype || '—'} · {s.az || '—'}</div></div></div></td>
                      <td><StatusBadge r={r} /></td>
                      <td><Meter value={s.cpu} base="#1FA9C0" /></td><td><Meter value={s.memP} base="#A3E635" /></td><td><Meter value={s.fsP} base="#22D3EE" /></td>
                      <td className="num">{s.load?.[0] != null ? s.load[0].toFixed(2) : '—'}<span className="text-faint">{s.cpus ? ` / ${s.cpus}` : ''}</span></td>
                      <td className={`num ${sd ? 'text-crit' : ''}`}>{s.svcTotal != null ? `${s.svcTotal - sd}/${s.svcTotal}` : '—'}</td>
                      <td className={`num ${s.ctrBad?.length ? 'text-crit' : ''}`}>{s.ctrTotal ? `${s.ctrRunning}/${s.ctrTotal}` : '—'}</td>
                      <td className="num">{(s.sessions || []).length}</td>
                      <td className="num"><Alerts a={r.a} /></td>
                      <td className="num">{since(s.boot)}</td>
                      <td><Sparkline values={s.spark} color={r.muted ? '#64748B' : '#1FA9C0'} /></td>
                      <td className="w-10" onClick={(e) => e.stopPropagation()}><HostMenu host={s} /></td>
                    </tr>); })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4 p-4">
              {rows.map((r) => <ServerFlipCard key={r.s.inst} r={r} />)}
            </div>
          )}
      </section>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Alertas activas" meta={`${crit} críticas · ${warn} atención`} className="col-span-12 xl:col-span-7" bodyClass="overflow-auto max-h-[440px]">
          <AlertsTable alerts={alerts} />
          {alerts.length > 12 && <a href="#/alertas" className="block text-center text-xs text-info py-2.5 border-t border-line no-underline hover:underline">Ver todas las alertas →</a>}
        </Panel>
        <Panel title="Sitios web y certificados" meta={web.length ? `${web.filter((w) => w.ok).length}/${web.length} en línea` : ''} className="col-span-12 xl:col-span-5" bodyClass="overflow-auto max-h-[440px]">
          <WebTable web={web} />
        </Panel>
      </div>
      {data?.at && <div className="sr-only">Actualizado {clock(data.at)}</div>}
    </>
  );
}
