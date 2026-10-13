// Centro de seguridad (SOC) con datos REALES: puntaje de seguridad, riesgo por equipo, hallazgos con acción
// recomendada, línea de tiempo, vulnerabilidades y paso a incidente (Evento → Hallazgo → Incidente → Analista).
import { useEffect, useMemo, useState } from 'react';
import { useCanEdit } from '../lib/me.js';
import { DEMO } from '../config.js';
import { incidentsApi, promAlerts, q, safe } from '../lib/api.js';
import { loadScans } from '../lib/scans.js';
import { CATS, SEV, assetRisk, buildFindings, securityScore } from '../lib/soc.js';
import { loadClones } from '../components/Clones.jsx';
import { useSynology } from '../components/Synology.jsx';
import { useAzure } from '../components/AzurePanel.jsx';
import { NetScanPanel } from '../components/NetScan.jsx';
import { useToast } from '../components/Toasts.jsx';
import { KpiCard } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { IRefresh } from '../components/icons.jsx';

const KIND = { servidor: 'Servidor', nas: 'NAS', azure: 'Azure', sitio: 'Sitio web', vpn: 'VPN', agencia: 'Agencia', wifi: 'Wi-Fi', equipo: 'Equipo', dominio: 'Dominio', regla: 'Regla' };
const INC_SEV = { crit: 'critica', warn: 'alta', info: 'media' };
const fmt = (ts) => new Date(ts).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const j = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

function Gauge({ value, tone }) {
  const c = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444' }[tone] || '#64748B', r = 52, L = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 130 130" className="w-[130px] h-[130px] shrink-0" role="img" aria-label={`Puntaje ${value} de 100`}>
      <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(148,163,184,.15)" strokeWidth="11" />
      <circle cx="65" cy="65" r={r} fill="none" stroke={c} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(L * value) / 100} ${L}`} transform="rotate(-90 65 65)" style={{ filter: `drop-shadow(0 0 6px ${c})` }} />
      <text x="65" y="66" textAnchor="middle" fontSize="34" fontWeight="700" fill="currentColor" className="text-ink font-mono">{value}</text>
      <text x="65" y="88" textAnchor="middle" fontSize="11" fill="#94A3B8">de 100</text>
    </svg>
  );
}

export function Soc({ model, data }) {
  const toast = useToast();
  const canEdit = useCanEdit();
  const nas = useSynology(60), az = useAzure(60);
  const [src, setSrc] = useState({});
  const [incs, setIncs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fSev, setFSev] = useState('all'), [fCat, setFCat] = useState('all'), [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [big, setBig] = useState(false);

  const load = async () => {
    setLoading(true);
    const f2bQ = DEMO ? Promise.resolve(demoF2b()) : Promise.all(['infra_fail2ban_up', 'infra_fail2ban_banned', 'infra_fail2ban_banned_total', 'infra_fail2ban_banned_ip'].map((e) => safe(q(e)))).then(([up, banned, total, ips]) => ({ up, banned, total, ips }));
    const [scans, alerts, clones, fg, fgt, list, f2b] = await Promise.all([
      loadScans(24).catch(() => null), promAlerts().catch(() => []), loadClones().catch(() => null),
      DEMO ? null : j('api/fortigate/status'), DEMO ? null : j('api/fortigate/traffic'), (DEMO ? Promise.resolve([]) : incidentsApi.list()).catch(() => []), f2bQ.catch(() => null),
    ]);
    setSrc({ scans, alerts, clones, fg, fgt, f2b }); setIncs(list || []); setLoading(false);
  };
  useEffect(() => { load(); const t = setInterval(load, 5 * 60e3); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const findings = useMemo(() => {
    const f = buildFindings({ ...src, model, web: data?.web || [], nas: nas.data, azure: az.data });
    for (const x of src.f2b?.up || []) if (+x.value[1] !== 1) { const host = (model?.all || []).find((r) => r.s.inst === x.metric.instance)?.s.host || x.metric.instance; f.unshift({ id: `f2b|${host}`, sev: 'warn', cat: 'ataques', asset: host, assetKind: 'servidor', title: 'fail2ban detenido: los bloqueos automáticos no están funcionando', source: 'fail2ban', ts: null, action: 'En el servidor: sudo systemctl start fail2ban && sudo fail2ban-client status' }); }
    return f;
  }, [src, model, data, nas.data, az.data]);
  const score = useMemo(() => securityScore(findings), [findings]);
  const risk = useMemo(() => assetRisk(findings), [findings]);
  const openIncs = incs.filter((i) => i.status !== 'resuelto');
  const incByTitle = Object.fromEntries(openIncs.map((i) => [i.title, i]));
  const crit = findings.filter((f) => f.sev === 'crit').length, high = findings.filter((f) => f.sev === 'warn').length;
  const newDev = findings.filter((f) => /equipo nuevo/i.test(f.title)).length;
  const rows = findings.filter((f) => (fSev === 'all' || f.sev === fSev) && (fCat === 'all' || f.cat === fCat) && (!q || `${f.title} ${f.asset} ${f.detail || ''} ${f.source}`.toLowerCase().includes(q.toLowerCase())));

  const timeline = useMemo(() => {
    const ev = findings.filter((f) => f.ts && Date.now() - f.ts < 7 * 86400e3 && f.source !== 'Agente del servidor').map((f) => ({ ts: f.ts, sev: f.sev, text: f.title, sub: `${f.asset} · ${f.source}`, href: f.href }));
    for (const i of incs) for (const t of i.timeline || []) ev.push({ ts: Date.parse(t.at), sev: 'inc', text: `Incidente #${i.id} · ${t.kind}: ${i.title}`, sub: `${t.by || ''}${t.text && t.kind !== 'creado' ? ` · ${t.text}` : ''}`, href: '#/incidentes' });
    return ev.filter((e) => Date.now() - e.ts < 7 * 86400e3).sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, [findings, incs]);

  const hostOf = (inst) => (model?.all || []).find((r) => r.s.inst === inst)?.s.host || String(inst || '').replace(/:\d+$/, '');
  const F2 = src.f2b;
  const f2bIps = (F2?.ips || []).map((x) => ({ ip: x.metric.ip, jail: x.metric.jail, host: hostOf(x.metric.instance) }));
  const f2bNow = (F2?.banned || []).reduce((t, x) => t + +x.value[1], 0), f2bTot = (F2?.total || []).reduce((t, x) => t + +x.value[1], 0);
  const f2bHosts = (F2?.up || []).map((x) => ({ host: hostOf(x.metric.instance), up: +x.value[1] === 1 }));
  const vulns = (model?.all || []).flatMap((r) => (r.s.pkgs || []).filter((p) => p.security).map((p) => ({ host: r.s.host || r.s.inst, inst: r.s.inst, ...p })));

  const openIncident = async (f) => {
    try {
      const inc = await incidentsApi.create({ title: f.title.slice(0, 160), severity: INC_SEV[f.sev], service: f.asset, source: 'soc', detail: `${f.detail ? `${f.detail}\n` : ''}Fuente: ${f.source}\nAcción recomendada: ${f.action}` });
      toast.success('Incidente abierto', `#${inc.id} · ${inc.title}`, { action: { label: 'Ver', fn: () => { location.hash = '#/incidentes'; } } });
      setIncs((l) => [inc, ...l]);
    } catch (e) { toast.error('No se pudo abrir el incidente', e.message); }
  };

  const printReport = () => {
    const w = window.open('', '_blank'); if (!w) return;
    const now = new Date().toLocaleString('es-CO');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte de seguridad · la empresa</title><style>body{font:13px/1.45 system-ui,sans-serif;color:#1e293b;margin:32px}h1{color:#1E3A8A;margin:0}h2{color:#2F7CF6;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:26px}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}.big{font-size:44px;font-weight:700}.crit{color:#dc2626}.warn{color:#d97706}.ok{color:#059669}small{color:#64748b}</style></head><body>
<h1>Reporte de postura de seguridad</h1><small>Infra Ops · generado ${esc(now)} · datos reales del centro de monitoreo</small>
<h2>Puntaje de seguridad</h2><div class="big ${score.grade[1]}">${score.score}/100</div><div>${esc(score.grade[0])} · ${crit} críticos · ${high} altos · ${openIncs.length} incidentes abiertos</div>
<table><tr><th>Categoría</th><th>Hallazgos</th><th>Resta</th></tr>${score.parts.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.n}</td><td>−${p.minus.toFixed(0)}</td></tr>`).join('')}</table>
<h2>Equipos con mayor riesgo</h2><table><tr><th>Equipo</th><th>Tipo</th><th>Riesgo</th><th>Principales hallazgos</th></tr>${risk.slice(0, 10).map((a) => `<tr><td>${esc(a.asset)}</td><td>${esc(KIND[a.kind] || a.kind)}</td><td>${a.risk}</td><td>${esc(a.top.slice(0, 3).join(' · '))}</td></tr>`).join('')}</table>
<h2>Hallazgos críticos y altos</h2><table><tr><th>Severidad</th><th>Hallazgo</th><th>Equipo</th><th>Acción recomendada</th></tr>${findings.filter((f) => f.sev !== 'info').map((f) => `<tr><td class="${f.sev}">${SEV[f.sev][0]}</td><td>${esc(f.title)}<br><small>${esc(f.source)}</small></td><td>${esc(f.asset)}</td><td>${esc(f.action)}</td></tr>`).join('') || '<tr><td colspan="4">Sin hallazgos críticos ni altos.</td></tr>'}</table>
<h2>Incidentes abiertos</h2><table><tr><th>#</th><th>Título</th><th>Severidad</th><th>Estado</th><th>Desde</th></tr>${openIncs.map((i) => `<tr><td>${esc(i.id)}</td><td>${esc(i.title)}</td><td>${esc(i.severity)}</td><td>${esc(i.status)}</td><td>${esc(fmt(Date.parse(i.startedAt)))}</td></tr>`).join('') || '<tr><td colspan="5">Ninguno.</td></tr>'}</table>
<h2>Parches de seguridad pendientes</h2><div>${vulns.length} paquetes en ${new Set(vulns.map((v) => v.host)).size} servidores.</div>
<script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  };

  return (
    <>
      <PageHead title="Centro de seguridad (SOC)" sub="Datos reales de servidores, red, FortiGate, Azure, NAS y sitios web · cada hallazgo con acción recomendada">
        <button type="button" className="btn" onClick={printReport}>Reporte PDF</button>
        <button type="button" className="btn" onClick={load} disabled={loading}><IRefresh size={14} />{loading ? 'Revisando…' : 'Actualizar'}</button>
      </PageHead>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <Panel title="Puntaje de seguridad" className="col-span-12 xl:col-span-5" bodyClass="p-4 flex items-center gap-5">
          <Gauge value={score.score} tone={score.grade[1]} />
          <div className="flex-1 min-w-0">
            <Badge tone={score.grade[1]}>{score.grade[0]}</Badge>
            <div className="text-[11px] text-faint mt-2 mb-1">Qué resta puntos</div>
            {score.parts.length ? score.parts.slice(0, 6).map((p) => (
              <button key={p.cat} type="button" onClick={() => setFCat(fCat === p.cat ? 'all' : p.cat)} className={`w-full flex items-center gap-2 text-[12px] py-0.5 text-left ${fCat === p.cat ? 'text-info' : 'text-ink2'}`}>
                <span className="flex-1 truncate">{p.label} <span className="text-faint">({p.n})</span></span>
                <span className="w-24 h-1.5 rounded-full bg-line/60 overflow-hidden"><i className="block h-full bg-crit/80" style={{ width: `${(p.minus / 25) * 100}%` }} /></span>
                <span className="font-mono text-crit w-8 text-right">−{p.minus.toFixed(0)}</span>
              </button>)) : <div className="text-ok text-[12.5px]">Sin hallazgos: todo en orden.</div>}
          </div>
        </Panel>
        <div className="col-span-12 xl:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard label="Hallazgos críticos" lead={<Pulse tone={crit ? 'crit' : 'ok'} />} value={crit} foot="Requieren acción hoy" />
          <KpiCard label="Hallazgos altos" lead={<Pulse tone={high ? 'warn' : 'ok'} />} value={high} foot="Planear esta semana" />
          <KpiCard label="Incidentes abiertos" lead={<Pulse tone={openIncs.length ? 'warn' : 'ok'} />} value={openIncs.length} foot={<a href="#/incidentes" className="text-info">Ver incidentes →</a>} />
          <KpiCard label="Equipos con riesgo" value={risk.filter((a) => a.risk >= 35).length} unit={` / ${risk.length}`} foot="Riesgo alto (≥ 35)" />
          <KpiCard label="Equipos nuevos en la red" lead={<Pulse tone={newDev ? 'warn' : 'ok'} />} value={newDev} foot="Últimos 7 días (FortiGate)" />
          <KpiCard label="Parches de seguridad" value={vulns.length} foot={`En ${new Set(vulns.map((v) => v.host)).size} servidor(es)`} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <Panel title="Equipos con mayor riesgo" meta={`${risk.length} con hallazgos`} className="col-span-12 xl:col-span-5" bodyClass="overflow-auto max-h-[420px]">
          {risk.length ? (
            <table className="tbl"><thead><tr><th>Equipo</th><th>Riesgo</th><th className="num">C/A/M</th></tr></thead>
              <tbody>{risk.slice(0, 25).map((a) => (
                <tr key={a.asset} className={a.href ? 'cursor-pointer' : ''} onClick={() => { setQ(a.asset); setFCat('all'); setFSev('all'); }}>
                  <td><div className="text-ink text-[12.5px] truncate max-w-[220px]" title={a.top.join('\n')}>{a.asset}</div><div className="text-[10.5px] text-faint">{KIND[a.kind] || a.kind}</div></td>
                  <td className="w-40"><div className="flex items-center gap-2"><span className="flex-1 h-1.5 rounded-full bg-line/60 overflow-hidden"><i className={`block h-full ${a.risk >= 70 ? 'bg-crit' : a.risk >= 35 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${a.risk}%` }} /></span><span className="font-mono text-[11.5px] w-7 text-right">{a.risk}</span></div></td>
                  <td className="num text-[11.5px]"><span className="text-crit">{a.crit}</span>/<span className="text-warn">{a.warn}</span>/<span className="text-faint">{a.info}</span></td>
                </tr>))}</tbody></table>
          ) : <Empty>{loading ? 'Revisando…' : 'Ningún equipo con hallazgos.'}</Empty>}
        </Panel>
        <Panel title="Línea de tiempo de seguridad" meta="últimos 7 días" className="col-span-12 xl:col-span-7" bodyClass="overflow-auto max-h-[420px] p-3">
          {timeline.length ? <ol className="relative border-l border-line ml-2">{timeline.map((e, i) => (
            <li key={i} className="ml-4 mb-2.5"><span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${e.sev === 'crit' ? 'bg-crit' : e.sev === 'warn' ? 'bg-warn' : e.sev === 'inc' ? 'bg-info' : 'bg-faint'}`} />
              <div className="text-[10.5px] text-faint font-mono">{fmt(e.ts)}</div>
              {e.href ? <a href={e.href} className="text-[12.5px] text-ink hover:underline">{e.text}</a> : <div className="text-[12.5px] text-ink">{e.text}</div>}
              <div className="text-[11px] text-faint">{e.sub}</div></li>))}</ol> : <Empty>Sin eventos con fecha en los últimos 7 días.</Empty>}
        </Panel>
      </div>

      <Panel title="Hallazgos" meta={`${rows.length} de ${findings.length}`} className="mb-4" bodyClass={big ? 'overflow-x-auto' : 'overflow-x-auto max-h-[620px]'}
        actions={<div className="flex items-center gap-2 flex-wrap">
          <div className="seg" role="group" aria-label="Severidad">{[['all', 'Todas'], ['crit', 'Críticos'], ['warn', 'Altos'], ['info', 'Medios']].map(([k, l]) => <button key={k} type="button" aria-pressed={fSev === k} onClick={() => setFSev(k)}>{l}</button>)}</div>
          <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="bg-bg1 border border-line rounded-md h-[26px] px-1.5 text-[12px] text-ink" aria-label="Categoría"><option value="all">Todas las categorías</option>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar hallazgo" className="bg-bg1 border border-line rounded-md h-[26px] px-2 text-[12px] text-ink outline-none w-40" />
          <button type="button" className="text-[11.5px] text-info hover:underline" onClick={() => setBig(!big)}>{big ? 'Reducir' : 'Ampliar'}</button>
        </div>}>
        {rows.length ? (
          <table className="tbl"><thead><tr><th>Severidad</th><th>Hallazgo</th><th>Equipo</th><th>Categoría</th><th>Fuente</th><th /></tr></thead>
            <tbody>{rows.map((f) => {
              const op = open === f.id, inc = incByTitle[f.title.slice(0, 160)];
              return [
                <tr key={f.id} className="cursor-pointer" onClick={() => setOpen(op ? null : f.id)}>
                  <td><Badge tone={SEV[f.sev][1]}>{SEV[f.sev][0]}</Badge></td>
                  <td className="text-ink text-[12.5px] max-w-[420px]">{f.title}{f.detail ? <div className="text-[11px] text-faint truncate">{f.detail}</div> : null}</td>
                  <td className="text-[12px]">{f.href ? <a href={f.href} onClick={(e) => e.stopPropagation()} className="text-ink hover:underline">{f.asset}</a> : f.asset}<div className="text-[10.5px] text-faint">{KIND[f.assetKind] || ''}</div></td>
                  <td className="text-[11.5px] text-ink2">{CATS[f.cat]}</td>
                  <td className="text-[11px] text-faint">{f.source}</td>
                  <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{inc ? <a href="#/incidentes" className="text-[11.5px] text-ok">Incidente #{inc.id}</a> : !canEdit ? null : <button type="button" className="text-[11.5px] text-info hover:underline" onClick={() => openIncident(f)}>Abrir incidente</button>}</td>
                </tr>,
                op && <tr key={f.id + '-a'} className="bg-bg1/50"><td /><td colSpan={5} className="py-2.5 text-[12.5px]"><b className="text-info">Acción recomendada: </b><span className="text-ink2">{f.action}</span></td></tr>,
              ];
            })}</tbody></table>
        ) : <Empty>{loading ? 'Revisando todas las fuentes…' : 'Sin hallazgos con estos filtros.'}</Empty>}
      </Panel>

      <NetScanPanel hosts={Object.fromEntries((model?.all || []).flatMap((r) => [[r.s.inst, r.s.host], [r.s.host, r.s.host]]))} />

      <Panel title="Bloqueos automáticos (fail2ban)" meta={f2bHosts.length ? `${f2bHosts.filter((h) => h.up).length}/${f2bHosts.length} servidor(es) protegidos · ${f2bNow} IP bloqueadas ahora · ${f2bTot} desde que se activó` : 'sin datos'} className="mb-4" bodyClass="overflow-auto max-h-[380px]">
        {!f2bHosts.length ? (
          <div className="p-4 text-[12.5px] text-ink2">fail2ban aún no envía datos al panel. En el servidor ejecuta una vez <span className="font-mono text-ink">sudo bash fail2ban-metricas.sh</span> (carpeta deploy del proyecto). Solo lee el estado de fail2ban cada minuto.</div>
        ) : (<>
          <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-line text-[12px]">{f2bHosts.map((h) => <Badge key={h.host} tone={h.up ? 'ok' : 'crit'}>{h.host} · {h.up ? 'activo' : 'detenido'}</Badge>)}</div>
          {f2bIps.length ? (
            <table className="tbl"><thead><tr><th>IP bloqueada</th><th>Motivo</th><th>Servidor</th><th /></tr></thead>
              <tbody>{f2bIps.map((x) => (
                <tr key={x.jail + x.ip + x.host}><td className="font-mono text-ink">{x.ip}</td>
                  <td className="text-[12px]">{x.jail === 'sshd' ? 'Contraseñas SSH fallidas' : x.jail === 'nginx-infra-rutas' ? 'Pidió rutas peligrosas (.env, .git, wp-login…)' : x.jail}</td>
                  <td className="text-[12px]">{x.host}</td>
                  <td className="text-right"><a href={`https://www.abuseipdb.com/check/${x.ip}`} target="_blank" rel="noreferrer" className="text-[11.5px] text-info hover:underline">Reputación ›</a></td></tr>))}</tbody></table>
          ) : <Empty>Ninguna IP bloqueada en este momento. Los robots se bloquean 1 hora cuando piden 3 rutas peligrosas en 10 minutos.</Empty>}
        </>)}
      </Panel>

      <Panel title="Vulnerabilidades (parches de seguridad pendientes)" meta={`${vulns.length} paquetes`} className="mb-4" bodyClass="overflow-auto max-h-[380px]">
        {vulns.length ? (
          <table className="tbl"><thead><tr><th>Servidor</th><th>Paquete</th><th>Versión corregida</th><th>CVE</th></tr></thead>
            <tbody>{vulns.slice(0, 300).map((v) => (
              <tr key={v.inst + v.name}><td><a href={`#/s/${encodeURIComponent(v.inst)}`} className="font-mono text-ink hover:underline text-[12px]">{v.host}</a></td><td className="font-mono text-[12px]">{v.name}</td><td className="font-mono text-[11.5px] text-faint">{v.version}</td>
                <td><a href={`https://ubuntu.com/security/cves?package=${encodeURIComponent(v.name)}`} target="_blank" rel="noreferrer" className="text-[11.5px] text-info hover:underline">Ver CVE y gravedad ›</a></td></tr>))}</tbody></table>
        ) : <Empty>Sin parches de seguridad pendientes (o el agente aún no reporta paquetes).</Empty>}
      </Panel>
      <p className="text-[11px] text-faint mb-6">El puntaje resta 6 puntos por hallazgo crítico, 2 por alto y 0,5 por medio, con un máximo de 25 por categoría. Fuentes conectadas: agentes de servidores, registros (Loki), reglas de alerta, sondas web, FortiGate, Azure, NAS Synology y vigilancia de dominios. Pendiente: Wazuh (requiere acceso de solo lectura a su API).</p>
    </>
  );
}

function demoF2b() {
  const m = (metric, v) => ({ metric: { instance: '172.31.33.88:9100', ...metric }, value: [0, String(v)] });
  return { up: [m({}, 1)], banned: [m({ jail: 'nginx-infra-rutas' }, 2), m({ jail: 'sshd' }, 0)], total: [m({ jail: 'nginx-infra-rutas' }, 9), m({ jail: 'sshd' }, 1)], ips: [m({ jail: 'nginx-infra-rutas', ip: '203.0.113.41' }, 1), m({ jail: 'nginx-infra-rutas', ip: '203.0.113.42' }, 1)] };
}
