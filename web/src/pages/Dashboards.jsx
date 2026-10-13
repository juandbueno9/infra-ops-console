// Vista ejecutiva: tarjetas holográficas, rack 3D de servidores, anillo 3D de disponibilidad
// y tarjetas giratorias por servidor. Todo con los datos reales de Prometheus.
import { Suspense, lazy, useMemo, useState } from 'react';
import { last } from '../lib/format.js';
import { linkState, diagnose } from '../lib/network.js';
import { pulseTone } from '../hooks/useFleetRows.js';
import { HoloKpi, ServerFlipCard, SiteCard3D } from '../components/cards3d.jsx';
import { IAlert, ICube, IGlobe, INetwork, IServer } from '../components/icons.jsx';
import { SiteGroups, useSiteHosts } from '../components/SiteGroups.jsx';
import { NasCard, nasItems, useSynology } from '../components/Synology.jsx';
import { azureItems, useAzure } from '../components/AzurePanel.jsx';
import { ConnectedList, isNewSeen, useFirstSeen } from '../components/Connected.jsx';
import { useHostActions } from '../hooks/useHostActions.jsx';

const ServerTowers3D = lazy(() => import('../components/ServerTowers3D.jsx').then((m) => ({ default: m.ServerTowers3D })));
const Logo3D = lazy(() => import('../components/Logo3D.jsx').then((m) => ({ default: m.Logo3D })));
const Building3D = lazy(() => import('../components/Building3D.jsx').then((m) => ({ default: m.Building3D })));
const NetworkMap = lazy(() => import('../components/NetworkMap.jsx').then((m) => ({ default: m.NetworkMap })));
const Donut3D = lazy(() => import('../components/Charts3D.jsx').then((m) => ({ default: m.Donut3D })));
const Loading = ({ h }) => <div className="grid place-items-center text-xs text-muted bg-[#041014]" style={{ height: h }}>Cargando gráfico 3D…</div>;

function Screen({ title, meta, children, className = '', offline = false }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-h"><h2>{title}</h2>{meta != null && <span className="panel-meta">{meta}</span>}</header>
      <div className="p-3">
        <div className="screen3d dark-zone">
          <span className="hud-corner tl" /><span className="hud-corner tr" /><span className="hud-corner bl" /><span className="hud-corner br" />
          {children}
          {offline && (
            <div className="absolute inset-0 z-20 grid place-items-center pointer-events-none">
              <div className="glass-tip text-center max-w-[300px]">
                <div className="text-warn font-semibold text-[13px]">Sin datos de Prometheus</div>
                <div className="text-[12px] text-ink2 mt-1">Abre el túnel en otra terminal para ver los datos en vivo:</div>
                <code className="block mt-2 font-mono text-[12px] text-info">npm run tunnel</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const Legend = ({ items }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 pt-3 text-[11.5px]">
    {items.map(([l, n, c]) => <span key={l} className="flex items-center gap-1.5 text-muted"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />{l}<b className="font-mono text-ink">{n}</b></span>)}
  </div>
);

export function Dashboards({ data, model, net }) {
  const [siteF, setSiteF] = useState('all');
  const web = data?.web || [];
  const hosts = useSiteHosts(web);
  const nas = useSynology(60);
  const az = useAzure(60);
  const K = data?.kpi || {};
  const { all, crit, warn } = model;
  const up = all.filter((r) => r.s.up === 1);
  const avg = (f) => { const v = up.map((r) => r.s[f]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const cpu = last(K.cpu) ?? avg('cpu'), mem = last(K.mem) ?? avg('memP'), lat = last(K.lat);
  const diskMax = up.reduce((m, r) => (r.s.fsP != null && r.s.fsP > (m ?? -1) ? r.s.fsP : m), null);
  const diskHost = up.find((r) => r.s.fsP === diskMax)?.s.host;
  const webOk = web.filter((w) => w.ok).length;
  const sslWarn = web.filter((w) => w.ok && w.ssl != null && w.ssl / 86400 < 21).length;
  const agencies = net?.agencies || [], route = net?.route || {};
  const [rTone, rTitle] = diagnose(route, agencies);

  // Disponibilidad global de componentes (servidores + sitios + red)
  const comps = [
    ...all.map((r) => pulseTone(r)),
    ...web.map((w) => (!w.ok ? 'crit' : w.ssl != null && w.ssl / 86400 < 21 ? 'warn' : 'ok')),
    ...(route.vpn ? [route.vpn.ok ? 'ok' : 'crit'] : []),
    ...agencies.map((a) => linkState(a)[1]),
  ];
  const cOk = comps.filter((t) => t === 'ok').length, cWarn = comps.filter((t) => t === 'warn').length, cCrit = comps.filter((t) => t === 'crit').length;
  const availPct = comps.length ? ((cOk + cWarn) / comps.length) * 100 : null;

  const act = useHostActions();
  const rackBase = useMemo(() => [
    ...all.map((r) => ({
      id: r.s.inst, label: r.s.host || r.s.inst, origLabel: r.s.hostOrig || r.s.host || r.s.inst, tone: pulseTone(r), href: `#/s/${encodeURIComponent(r.s.inst)}`,
      kind: /azure/i.test(r.s.job || '') || /^172\.0\./.test(r.s.inst) ? 'azure' : r.s.az ? 'aws' : 'server', sub: r.s.itype || (r.s.inst || '').replace(/:\d+$/, ''),
      values: r.s.up === 1 ? { cpu: r.s.cpu, mem: r.s.memP, disk: r.s.fsP } : {},
      note: r.s.up !== 1 ? 'Sin respuesta del agente' : r.a.A.length ? `${r.a.A.length} alerta(s)` : 'Sin alertas',
    })),
    ...azureItems(az.data, act.alias),
    ...nasItems(nas.data, act.alias).map((n) => ({ ...n, origLabel: (nas.data?.nas || []).find((x) => `nas:${x.host}` === n.id)?.name, aliasKey: n.id, sub: n.id.replace('nas:', ''), values: { cpu: n.values.cpu, mem: n.values.mem, disk: n.values.disk } })),
  ], [all, nas.data, az.data, act.alias]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = useFirstSeen(rackBase.map((i) => i.id));
  const barItems = useMemo(() => rackBase.map((i) => ({ ...i, isNew: isNewSeen(seen[i.id]) })), [rackBase, seen]);

  const sites = web.filter((w) => siteF === 'all' || (siteF === 'bad' ? !w.ok || (w.ssl != null && w.ssl / 86400 < 21) : w.ok));
  const sorted = [...sites].sort((a, b) => (a.ok - b.ok) || ((a.ssl ?? 1e12) - (b.ssl ?? 1e12)));

  return (
    <>
      <section className="brand-banner panel mb-4 overflow-hidden">
        <div className="grid grid-cols-12 items-stretch">
          <div className="col-span-12 md:col-span-6 2xl:col-span-4 dark-zone bg-[#040814] relative">
            <Suspense fallback={<div className="h-[270px]" />}><Logo3D height={270} download /></Suspense>
          </div>
          <div className="col-span-12 md:col-span-6 2xl:col-span-4 px-6 py-6 flex flex-col justify-center banner-copy">
            <div className="text-[10.5px] uppercase tracking-[.28em] text-info font-semibold flex items-center gap-2"><span className="live-dot" />Infra Ops · Observabilidad en vivo</div>
            <h1 className="m-0 mt-2 text-[30px] font-bold tracking-tight leading-tight">Vista ejecutiva</h1>
            <p className="m-0 mt-1.5 text-muted text-[13px]">Vista ejecutiva en tiempo real de servidores, sitios web, sede y agencias. Arrastra los gráficos para rotarlos, pasa el ratón para ver el detalle y haz clic para abrir.</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className={`badge badge-${cCrit ? 'crit' : cWarn ? 'warn' : 'ok'}`}>{cCrit ? `${cCrit} con falla` : cWarn ? `${cWarn} por revisar` : 'Todo operando'}</span>
              <span className="badge badge-info">{all.length} servidores · {web.length} sitios · 16 agencias</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <a href="#/3d" className="btn no-underline h-[28px] px-3 text-[11.5px]"><ICube size={13} />Centro de mando</a>
              <a href="#/red" className="btn no-underline h-[28px] px-3 text-[11.5px]"><INetwork size={13} />Mapa de red</a>
            </div>
          </div>
          <div className="col-span-12 2xl:col-span-4 dark-zone bg-[#041014] relative min-h-[270px]">
            <Suspense fallback={<div className="h-[270px]" />}><Building3D route={route} agencies={agencies} height={270} /></Suspense>
            <div className="absolute left-3 top-3 z-10 pointer-events-none">
              <div className="text-[10px] uppercase tracking-[.22em] text-info/90 font-semibold">Gemelo digital</div>
              <div className="text-[13px] text-ink font-semibold">Sede principal · Bogotá</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 min-[1760px]:grid-cols-6 gap-4 mb-4">
        <HoloKpi label="Disponibilidad" icon={<ICube size={13} />} value={availPct != null ? availPct.toFixed(1) : '—'} unit="%" gauge={availPct} tone={cCrit ? 'crit' : cWarn ? 'warn' : 'ok'}
          foot={`${cOk + cWarn} de ${comps.length} componentes arriba`} />
        <HoloKpi label="CPU flota" icon={<IServer size={13} />} value={cpu != null ? cpu.toFixed(1) : '—'} unit="%" gauge={cpu} spark={K.cpu} sparkColor="#1FA9C0" foot={`${up.length}/${all.length} servidores en línea`} />
        <HoloKpi label="Memoria flota" icon={<IServer size={13} />} value={mem != null ? mem.toFixed(1) : '—'} unit="%" gauge={mem} spark={K.mem} sparkColor="#A3E635" foot="Promedio de la flota" />
        <HoloKpi label="Disco más lleno" icon={<IServer size={13} />} value={diskMax != null ? diskMax.toFixed(0) : '—'} unit="%" gauge={diskMax} foot={diskHost || 'Sin datos'} />
        <HoloKpi label="Latencia web" icon={<IGlobe size={13} />} value={lat != null ? Math.round(lat) : '—'} unit={lat != null ? 'ms' : ''} gauge={lat != null ? Math.min(lat, 2000) : null} gaugeMax={2000}
          gaugeLabel={`${webOk}/${web.length}`} tone={lat == null ? 'off' : lat > 1500 ? 'crit' : lat > 800 ? 'warn' : 'ok'} spark={K.lat} sparkColor="#22D3EE" foot={`${webOk} de ${web.length} sitios en línea`} />
        <HoloKpi label="Alertas activas" icon={<IAlert size={13} />} value={crit + warn} tone={crit ? 'crit' : warn ? 'warn' : 'ok'} gauge={crit + warn ? Math.min(100, (crit / (crit + warn)) * 100) : 0}
          gaugeLabel={crit ? `${crit} crít.` : 'OK'} foot={<><span className="text-crit">{crit} críticas</span> · <span className="text-warn">{warn} atención</span></>} />
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <Screen title="Rack de servidores" meta={`${barItems.length} equipo(s) conectados · cada servidor nuevo aparece aquí`} className="col-span-12 xl:col-span-8" offline={!data}>
          <Suspense fallback={<Loading h={520} />}><ServerTowers3D items={barItems} height={520} /></Suspense>
          <ConnectedList items={barItems} seen={seen} />
        </Screen>
        <div className="col-span-12 xl:col-span-4 flex flex-col gap-4">
          <Screen title="Disponibilidad global" meta={`${comps.length} componentes`} offline={!data}>
            <Suspense fallback={<Loading h={250} />}>
              <Donut3D height={250} center={{ value: availPct != null ? `${availPct.toFixed(0)}%` : '—', caption: 'arriba' }}
                segments={[{ key: 'ok', label: 'Operando', value: cOk, tone: 'ok' }, { key: 'warn', label: 'Por revisar', value: cWarn, tone: 'warn' }, { key: 'crit', label: 'Con falla', value: cCrit, tone: 'crit' }]} />
            </Suspense>
            <Legend items={[['Operando', cOk, '#10B981'], ['Por revisar', cWarn, '#F59E0B'], ['Con falla', cCrit, '#EF4444']]} />
          </Screen>
          <Screen title="Sitios web" meta={sslWarn ? `${sslWarn} SSL por vencer` : 'SSL al día'} offline={!data}>
            <Suspense fallback={<Loading h={200} />}>
              <Donut3D height={200} href="#/sitios" center={{ value: `${webOk}/${web.length}`, caption: 'en línea' }}
                segments={[{ key: 'ok', label: 'En línea', value: webOk - sslWarn, tone: 'ok' }, { key: 'ssl', label: 'SSL por vencer', value: sslWarn, tone: 'warn' }, { key: 'down', label: 'Caídos', value: web.length - webOk, tone: 'crit' }]} />
            </Suspense>
          </Screen>
        </div>
      </div>

      <section className="mb-4">
        <div className="flex items-center gap-2.5 mb-3"><IServer size={16} className="text-info" /><h2 className="m-0 text-[14px] font-semibold text-ink">Servidores</h2>
          <span className="text-[11.5px] text-faint">Pulsa ⟲ para girar la tarjeta y ver el detalle</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-4">
          {all.map((r) => <ServerFlipCard key={r.s.inst} r={r} />)}
          {(nas.data?.nas || []).map((n) => <NasCard key={n.host} n={n} />)}
          {!all.length && <div className="text-muted text-sm">{data ? 'No hay servidores con node_exporter.' : 'Esperando datos de Prometheus…'}</div>}
        </div>
      </section>

      <section className="mb-4">
        <div className="flex items-center gap-2.5 mb-3 flex-wrap"><IGlobe size={16} className="text-info" /><h2 className="m-0 text-[14px] font-semibold text-ink">Sitios web y certificados</h2>
          <div className="seg ml-2" role="group" aria-label="Filtrar sitios">
            {[['all', 'Todos', web.length], ['bad', 'Con novedad', web.filter((w) => !w.ok || (w.ssl != null && w.ssl / 86400 < 21)).length], ['ok', 'En línea', webOk]].map(([k, l, c]) => (
              <button key={k} type="button" aria-pressed={siteF === k} onClick={() => setSiteF(k)}>{l} <span className="font-mono text-[11px] text-faint">{c}</span></button>
            ))}
          </div>
        </div>
        {sorted.length ? <SiteGroups web={sorted} all={all} hosts={hosts} /> : <div className="text-muted text-sm">{web.length ? 'Ningún sitio coincide.' : 'Sin sondas Blackbox.'}</div>}
      </section>

      <section>
        <div className="flex items-center gap-2.5 mb-3"><INetwork size={16} className="text-info" /><h2 className="m-0 text-[14px] font-semibold text-ink">Red y conectividad</h2>
          <span className={`text-[11.5px] ${rTone === 'crit' ? 'text-crit' : rTone === 'warn' ? 'text-warn' : 'text-faint'}`}>{rTitle}</span></div>
        <Suspense fallback={<div className="h-[560px] panel grid place-items-center text-xs text-muted">Cargando mapa…</div>}><NetworkMap agencies={agencies} route={route} height={560} /></Suspense>
      </section>
    </>
  );
}
