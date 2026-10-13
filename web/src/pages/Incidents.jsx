// Incidentes: qué pasó, desde cuándo, quién lo atiende y cómo se resolvió (con línea de tiempo auditada).
import { useEffect, useState } from 'react';
import { useCanEdit } from '../lib/me.js';
import { DEMO } from '../config.js';
import { incidentsApi, promAlerts } from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { useToast } from '../components/Toasts.jsx';
import { KpiCard } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';

const SEV = { critica: ['Crítica', 'crit'], alta: ['Alta', 'warn'], media: ['Media', 'info'], baja: ['Baja', 'off'] };
const ST = { abierto: ['Abierto', 'crit'], investigando: ['Investigando', 'warn'], mitigado: ['Mitigado', 'info'], resuelto: ['Resuelto', 'ok'] };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const durTxt = (a, b) => { const m = Math.max(0, ((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60000); return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };

// Modo demo: incidentes en memoria
let demoStore = [
  { id: 'a1b2c3d4', title: 'empresa.com intermitente (hosting externo)', severity: 'alta', service: 'empresa.com', source: 'alerta', status: 'investigando', startedAt: new Date(Date.now() - 5 * 3600e3).toISOString(), resolvedAt: null, owner: 'ana.admin', createdBy: 'ana.admin',
    timeline: [{ at: new Date(Date.now() - 5 * 3600e3).toISOString(), by: 'ana.admin', kind: 'creado', text: 'Uptime 96.9 % y ~3 s de respuesta. Se abre caso con el proveedor del hosting.' }, { at: new Date(Date.now() - 4 * 3600e3).toISOString(), by: 'ana.admin', kind: 'estado', text: 'Cambió a «investigando»' }] },
  { id: 'e5f6a7b8', title: 'Certificado de vault por vencer', severity: 'media', service: 'vault.empresa.com', source: 'manual', status: 'resuelto', startedAt: new Date(Date.now() - 50 * 3600e3).toISOString(), resolvedAt: new Date(Date.now() - 46 * 3600e3).toISOString(), owner: 'carlos.ops', createdBy: 'ana.admin', cause: 'La renovación webroot fallaba porque el puerto 80 no llegaba a Let’s Encrypt.',
    timeline: [{ at: new Date(Date.now() - 50 * 3600e3).toISOString(), by: 'ana.admin', kind: 'creado', text: 'Quedan 23 días' }, { at: new Date(Date.now() - 46 * 3600e3).toISOString(), by: 'carlos.ops', kind: 'estado', text: 'Cambió a «resuelto»' }] },
];
const api = DEMO ? {
  list: async () => [...demoStore].sort((a, b) => (a.status === 'resuelto') - (b.status === 'resuelto') || (b.startedAt > a.startedAt ? 1 : -1)),
  create: async (b) => { const i = { id: Math.random().toString(16).slice(2, 10), status: 'abierto', owner: 'demo', createdBy: 'demo', startedAt: new Date().toISOString(), resolvedAt: null, ...b, timeline: [{ at: new Date().toISOString(), by: 'demo', kind: 'creado', text: b.detail || 'Incidente abierto' }] }; demoStore.push(i); return i; },
  update: async (id, b) => { const i = demoStore.find((x) => x.id === id); const at = new Date().toISOString(); if (b.status && b.status !== i.status) { i.status = b.status; i.resolvedAt = b.status === 'resuelto' ? at : null; i.timeline.push({ at, by: 'demo', kind: 'estado', text: `Cambió a «${b.status}»` }); } if (b.note) i.timeline.push({ at, by: 'demo', kind: 'nota', text: b.note }); if (b.cause !== undefined) i.cause = b.cause; if (b.owner !== undefined) i.owner = b.owner; return { ...i }; },
} : incidentsApi;
const loadAlerts = () => (DEMO ? Promise.resolve([{ labels: { alertname: 'SitioLento', instance: 'https://empresa.com/', severidad: 'advertencia' }, annotations: { resumen: 'https://empresa.com/ tarda 3.1 s en responder' }, state: 'firing', activeAt: new Date(Date.now() - 7200e3).toISOString() }]) : promAlerts());

function NewIncident({ initial, onCancel, onCreate }) {
  const [f, setF] = useState({ title: '', severity: 'media', service: '', detail: '', ...initial });
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  return (
    <Panel title="Nuevo incidente" className="mb-4" bodyClass="p-4 grid gap-3 md:grid-cols-2">
      <label className="md:col-span-2 text-xs text-muted">Título<input autoFocus value={f.title} onChange={set('title')} maxLength={160} className="inp w-full mt-1 font-sans" placeholder="Qué está pasando" /></label>
      <label className="text-xs text-muted">Severidad<select value={f.severity} onChange={set('severity')} className="inp w-full mt-1 font-sans">{Object.entries(SEV).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="text-xs text-muted">Servicio afectado<input value={f.service} onChange={set('service')} maxLength={120} className="inp w-full mt-1" placeholder="crm.empresa.com, core-database…" /></label>
      <label className="md:col-span-2 text-xs text-muted">Descripción<textarea value={f.detail} onChange={set('detail')} rows={3} maxLength={2000} className="inp w-full mt-1 h-auto py-2 font-sans" placeholder="Síntomas, impacto, primeras acciones" /></label>
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-[30px] px-3 rounded-lg border border-line text-xs text-ink2">Cancelar</button>
        <button type="button" disabled={!f.title.trim()} onClick={() => onCreate(f)} className="h-[30px] px-4 rounded-lg bg-info text-white text-xs font-semibold disabled:opacity-40">Abrir incidente</button>
      </div>
    </Panel>
  );
}

function Detail({ inc, onUpdate }) {
  const [note, setNote] = useState('');
  const [cause, setCause] = useState(inc.cause || '');
  useEffect(() => { setCause(inc.cause || ''); setNote(''); }, [inc.id]);
  return (
    <Panel title={inc.title} meta={`#${inc.id}`} className="sticky top-4" bodyClass="p-4">
      <div className="flex flex-wrap gap-2 mb-3">
        <Badge tone={SEV[inc.severity]?.[1]}>{SEV[inc.severity]?.[0]}</Badge><Badge tone={ST[inc.status]?.[1]}>{ST[inc.status]?.[0]}</Badge>
        <span className="text-xs text-muted">{inc.service}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px] mb-3">
        <div><dt className="text-faint text-[11px]">Inicio</dt><dd className="font-mono">{fmt(inc.startedAt)}</dd></div>
        <div><dt className="text-faint text-[11px]">Duración</dt><dd className="font-mono">{durTxt(inc.startedAt, inc.resolvedAt)}{!inc.resolvedAt && ' · en curso'}</dd></div>
        <div><dt className="text-faint text-[11px]">Responsable</dt><dd>{inc.owner || '—'}</dd></div>
        <div><dt className="text-faint text-[11px]">Abierto por</dt><dd>{inc.createdBy}</dd></div>
      </dl>
      <div className="seg mb-3 flex-wrap" role="group" aria-label="Estado">
        {Object.entries(ST).map(([k, [l]]) => <button key={k} type="button" aria-pressed={inc.status === k} onClick={() => onUpdate(inc.id, { status: k })}>{l}</button>)}
      </div>
      <label className="text-xs text-muted block mb-3">Causa raíz
        <textarea value={cause} onChange={(e) => setCause(e.target.value)} onBlur={() => cause !== (inc.cause || '') && onUpdate(inc.id, { cause })} rows={2} maxLength={2000} className="inp w-full mt-1 h-auto py-2 font-sans" placeholder="Se guarda al salir del campo" />
      </label>
      <div className="text-xs text-muted mb-1.5">Línea de tiempo</div>
      <ol className="border-l border-line2 ml-1.5 mb-3 max-h-[300px] overflow-auto">
        {inc.timeline.map((t, i) => (
          <li key={i} className="pl-3 pb-2.5 relative">
            <span className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${t.kind === 'estado' ? 'bg-warn' : t.kind === 'creado' ? 'bg-crit' : 'bg-info'}`} />
            <div className="text-[11px] text-faint">{fmt(t.at)} · {t.by}</div>
            <div className="text-[12.5px] text-ink2 whitespace-pre-wrap">{t.text}</div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { onUpdate(inc.id, { note }); setNote(''); } }} maxLength={2000} className="inp flex-1 font-sans" placeholder="Agregar nota (Enter)" />
        <button type="button" disabled={!note.trim()} onClick={() => { onUpdate(inc.id, { note }); setNote(''); }} className="h-[30px] px-3 rounded-lg border border-line text-xs text-ink2 disabled:opacity-40">Agregar</button>
      </div>
    </Panel>
  );
}

export function Incidents() {
  const canEdit = useCanEdit();
  const toast = useToast();
  const list = usePolling(() => api.list(), 30, []);
  const alerts = usePolling(loadAlerts, 30, []);
  const [filter, setFilter] = useState('activos');
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const items = list.data || [];
  const active = items.filter((i) => i.status !== 'resuelto');
  const rows = filter === 'activos' ? active : filter === 'resueltos' ? items.filter((i) => i.status === 'resuelto') : items;
  const current = items.find((i) => i.id === sel) || rows[0];
  const firing = (alerts.data || []).filter((a) => a.state === 'firing' && a.labels.alertname !== 'Watchdog');
  const mttr = (() => { const r = items.filter((i) => i.resolvedAt); return r.length ? r.reduce((t, i) => t + (Date.parse(i.resolvedAt) - Date.parse(i.startedAt)), 0) / r.length / 60000 : null; })();

  const create = async (f) => {
    try { const i = await api.create(f); toast.success('Incidente abierto', `#${i.id} · ${i.title}`); setDraft(null); setSel(i.id); list.refresh(); }
    catch (e) { toast.error('No se pudo abrir el incidente', e.message, { details: e.details }); }
  };
  const update = async (id, body) => {
    try { await api.update(id, body); list.refresh(); if (body.status) toast.success('Incidente actualizado', `Estado: ${ST[body.status][0]}`); }
    catch (e) { toast.error('No se pudo actualizar', e.message, { details: e.details }); }
  };

  return (
    <>
      <PageHead title="Incidentes" sub="Registro de incidentes: seguimiento, responsables, línea de tiempo y causa raíz (todo queda auditado)">
        {canEdit && <button type="button" onClick={() => setDraft({})} className="h-[30px] px-3 rounded-lg bg-info text-white text-xs font-semibold">+ Nuevo incidente</button>}
      </PageHead>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Incidentes activos" lead={<Pulse tone={active.length ? 'crit' : 'ok'} />} value={active.length} foot={active.filter((i) => i.severity === 'critica').length + ' crítico(s)'} />
        <KpiCard label="Alertas sin incidente" lead={<Pulse tone={firing.length ? 'warn' : 'ok'} />} value={firing.length} foot="Reglas de Prometheus disparadas" />
        <KpiCard label="Tiempo medio de resolución" value={mttr == null ? '—' : mttr < 60 ? Math.round(mttr) : (mttr / 60).toFixed(1)} unit={mttr == null ? '' : mttr < 60 ? ' min' : ' h'} foot="MTTR, incidentes resueltos" />
        <KpiCard label="Total registrados" value={items.length} foot="Histórico" />
      </div>
      {draft && <NewIncident initial={draft} onCancel={() => setDraft(null)} onCreate={create} />}
      {firing.length > 0 && (
        <Panel title="Alertas activas" meta="abre un incidente para darle seguimiento" className="mb-4" bodyClass="overflow-x-auto">
          <table className="tbl"><tbody>
            {firing.map((a, k) => (
              <tr key={k}>
                <td><Badge tone={a.labels.severidad === 'critica' ? 'crit' : a.labels.severidad === 'advertencia' ? 'warn' : 'info'}>{a.labels.alertname}</Badge></td>
                <td className="text-ink2">{a.annotations?.resumen}</td>
                <td className="text-xs text-faint whitespace-nowrap">desde {fmt(a.activeAt)}</td>
                <td className="text-right"><button type="button" onClick={() => setDraft({ title: a.annotations?.resumen || a.labels.alertname, severity: a.labels.severidad === 'critica' ? 'critica' : 'alta', service: (a.labels.instance || a.labels.agencia || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), detail: `Alerta ${a.labels.alertname} activa desde ${fmt(a.activeAt)}`, source: 'alerta' })} className="text-xs text-info hover:underline whitespace-nowrap">Abrir incidente</button></td>
              </tr>
            ))}
          </tbody></table>
        </Panel>
      )}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_420px] items-start">
        <section className="panel">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
            <div className="seg" role="group" aria-label="Filtro">
              {[['activos', 'Activos', active.length], ['resueltos', 'Resueltos', items.length - active.length], ['todos', 'Todos', items.length]].map(([k, l, c]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="text-faint text-[11px]">{c}</span></button>)}
            </div>
          </div>
          <table className="tbl"><thead><tr><th>Incidente</th><th>Severidad</th><th>Estado</th><th>Responsable</th><th className="num">Duración</th></tr></thead><tbody>
            {rows.length ? rows.map((i) => (
              <tr key={i.id} onClick={() => setSel(i.id)} className={`cursor-pointer ${current?.id === i.id ? 'bg-surface2' : ''}`}>
                <td><div className="text-ink font-medium">{i.title}</div><div className="text-[11px] text-faint font-mono">#{i.id} · {i.service || 'sin servicio'} · {fmt(i.startedAt)}</div></td>
                <td><Badge tone={SEV[i.severity]?.[1]}>{SEV[i.severity]?.[0]}</Badge></td>
                <td><Badge tone={ST[i.status]?.[1]}>{ST[i.status]?.[0]}</Badge></td>
                <td className="text-xs">{i.owner || '—'}</td>
                <td className="num">{durTxt(i.startedAt, i.resolvedAt)}</td>
              </tr>
            )) : <tr><td colSpan={5}><Empty>{list.loading ? 'Cargando…' : filter === 'activos' ? 'Sin incidentes activos.' : 'Sin incidentes.'}</Empty></td></tr>}
          </tbody></table>
        </section>
        {current ? <Detail inc={current} onUpdate={update} /> : <Panel bodyClass="p-6"><Empty>Selecciona un incidente</Empty></Panel>}
      </div>
    </>
  );
}
