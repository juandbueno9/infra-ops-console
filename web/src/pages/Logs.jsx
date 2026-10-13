// Logs centralizados: buscar en nginx, Apache, contenedores, auth.log y syslog de todos los servidores.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { LOG_RANGES, SOURCES, lineLevel, loadLogFacets, loadLogs } from '../lib/logs.js';
import { usePolling } from '../hooks/usePolling.js';
import { KpiCard, LineChart } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { ISearch } from '../components/icons.jsx';

const fmtTs = (ts) => new Date(ts * 1000).toLocaleString('es-CO', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function Highlight({ text, term }) {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="bg-warn/30 text-ink rounded-sm">{text.slice(i, i + term.length)}</mark><Highlight text={text.slice(i + term.length)} term={term} /></>;
}

export function Logs() {
  const [f, setF] = useState({ range: '1h', servidor: '', job: '', tipo: '', contenedor: '', text: '', onlyErrors: false, limit: 500 });
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState(null);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v, ...(k === 'job' && v !== 'docker' ? { contenedor: '' } : {}) }));
  useEffect(() => { const t = setTimeout(() => set('text', draft.trim()), 400); return () => clearTimeout(t); }, [draft]);

  const facets = usePolling(loadLogFacets, 300, []);
  const key = JSON.stringify(f);
  const data = usePolling(() => loadLogs(f), live ? 5 : 0, [key]);
  const d = data.data;
  const levels = useMemo(() => (d?.lines || []).reduce((a, l) => { const k = lineLevel(l.line); a[k || 'ok']++; return a; }, { crit: 0, warn: 0, ok: 0 }), [d]);

  return (
    <>
      <PageHead title="Logs" sub="Búsqueda centralizada en los logs de todos los servidores (nginx, Apache, contenedores, accesos y sistema)">
        <button type="button" onClick={() => setLive((v) => !v)} aria-pressed={live}
          className={`h-[30px] px-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${live ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-bg1 text-muted'}`}>
          <Pulse tone={live ? 'ok' : 'off'} />{live ? 'En vivo · cada 5 s' : 'Pausado'}
        </button>
      </PageHead>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Líneas en el rango" value={d ? d.lines.length.toLocaleString('es-CO') : '—'} unit={d?.limitHit ? '+' : ''} foot={d?.limitHit ? `Se muestran las ${f.limit} más recientes` : LOG_RANGES[f.range].label} />
        <KpiCard label="Errores" lead={<Pulse tone={d?.stats.errors ? 'crit' : 'ok'} />} value={d ? d.stats.errors.toLocaleString('es-CO') : '—'} foot="error, crit, fatal, excepciones, 5xx" />
        <KpiCard label="Respuestas 5xx (web)" lead={<Pulse tone={d?.stats.http5xx ? 'warn' : 'ok'} />} value={d ? d.stats.http5xx.toLocaleString('es-CO') : '—'} foot="nginx y Apache, en el rango" />
        <KpiCard label="Intentos SSH fallidos" lead={<Pulse tone={d?.stats.sshFail > 20 ? 'warn' : 'ok'} />} value={d ? d.stats.sshFail.toLocaleString('es-CO') : '—'} foot="auth.log, en el rango" />
      </div>

      <section className="panel mb-4">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line">
          <select className="inp font-sans" value={f.range} onChange={(e) => set('range', e.target.value)} aria-label="Rango">
            {Object.entries(LOG_RANGES).map(([k, r]) => <option key={k} value={k}>Últimos {r.label}</option>)}
          </select>
          <select className="inp font-sans" value={f.servidor} onChange={(e) => set('servidor', e.target.value)} aria-label="Servidor">
            <option value="">Todos los servidores</option>
            {(facets.data?.servidores || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="inp font-sans" value={f.job} onChange={(e) => set('job', e.target.value)} aria-label="Fuente">
            {SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {f.job === 'docker' && (
            <select className="inp font-sans" value={f.contenedor} onChange={(e) => set('contenedor', e.target.value)} aria-label="Contenedor">
              <option value="">Todos los contenedores</option>
              {(facets.data?.contenedores || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {['nginx', 'apache'].includes(f.job) && (
            <div className="seg" role="group" aria-label="Tipo">
              {[['', 'Todo'], ['acceso', 'Accesos'], ['error', 'Errores']].map(([k, l]) => <button key={k} type="button" aria-pressed={f.tipo === k} onClick={() => set('tipo', k)}>{l}</button>)}
            </div>
          )}
          <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px] flex-1 min-w-[220px]">
            <ISearch size={14} className="text-faint" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Buscar texto: IP, usuario, URL, mensaje…" aria-label="Buscar en logs" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-full" />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink2 cursor-pointer select-none">
            <input type="checkbox" checked={f.onlyErrors} onChange={(e) => set('onlyErrors', e.target.checked)} className="accent-[#EF4444]" /> Solo errores
          </label>
        </div>
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between text-xs text-muted mb-1"><span>Volumen de líneas</span><span className="font-mono text-faint truncate max-w-[60%]" title={d?.query}>{d?.query}</span></div>
          <LineChart series={d?.volume} label="Líneas" max="auto" fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v))} tipFmt={(v) => `${Math.round(v)} líneas`} height={120} color="#A3E635" />
        </div>
      </section>

      <section className="panel">
        <header className="panel-h">
          <h2>Líneas</h2>
          <span className="panel-meta">{d ? `${d.lines.length} · ${levels.crit} error · ${levels.warn} advertencia` : ''} · clic para ver etiquetas</span>
        </header>
        {data.error && !d ? (
          <Empty>No se pudo consultar Loki: {data.error.message}. ¿Está instalado el stack (deploy/stack) y el túnel abierto con el puerto 3100?</Empty>
        ) : !d ? <Empty>Cargando…</Empty> : !d.lines.length ? <Empty>Sin líneas para estos filtros en {LOG_RANGES[f.range].label.toLowerCase()}.</Empty> : (
          <div className="overflow-auto max-h-[calc(100vh-420px)] min-h-[300px] font-mono text-[12px]">
            <table className="w-full border-collapse">
              <tbody>
                {d.lines.map((l, i) => {
                  const lv = lineLevel(l.line), k = l.ns + i;
                  return (
                    <Fragment key={k}>
                      <tr onClick={() => setOpen(open === k ? null : k)} className={`cursor-pointer border-b border-line/50 hover:bg-surface2 ${lv === 'crit' ? 'bg-crit/[0.06]' : lv === 'warn' ? 'bg-warn/[0.04]' : ''}`}>
                        <td className={`w-1 p-0 ${lv === 'crit' ? 'bg-crit' : lv === 'warn' ? 'bg-warn' : 'bg-transparent'}`} />
                        <td className="px-3 py-1 whitespace-nowrap text-faint align-top">{fmtTs(l.ts)}</td>
                        <td className="px-2 py-1 whitespace-nowrap align-top"><span className="text-muted">{l.labels.servidor}</span></td>
                        <td className="px-2 py-1 whitespace-nowrap align-top"><Badge tone={l.labels.job === 'auth' ? 'info' : l.labels.job === 'docker' ? 'sg' : 'off'}>{l.labels.contenedor || l.labels.job}{l.labels.tipo === 'error' ? ' · error' : ''}</Badge></td>
                        <td className={`px-2 py-1 break-all ${lv === 'crit' ? 'text-[#FCA5A5]' : lv === 'warn' ? 'text-[#FCD34D]' : 'text-ink2'}`}><Highlight text={l.line} term={f.text} /></td>
                      </tr>
                      {open === k && (
                        <tr className="bg-bg1"><td /><td colSpan={4} className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">{Object.entries(l.labels).filter(([, v]) => v).map(([a, v]) => <span key={a} className="text-[11px] border border-line rounded px-1.5 py-0.5"><span className="text-faint">{a}=</span><span className="text-ink">{v}</span></span>)}</div>
                          <div className="text-[11px] text-faint mt-1.5">{new Date(l.ts * 1000).toISOString()} · ns {l.ns}</div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-faint mt-2">Los logs se guardan 30 días en Loki. Cada consulta queda en la auditoría (una vez cada 30 min por usuario).</p>
    </>
  );
}
