// Explorar: consultas libres a Prometheus (PromQL) con gráfica y tabla, como el Explore de Grafana.
import { useMemo, useState } from 'react';
import { DEMO } from '../config.js';
import { q, qr } from '../lib/api.js';
import { PageHead } from '../components/tables.jsx';
import { Empty, Panel } from '../components/ui.jsx';

const COLORS = ['#1FA9C0', '#10B981', '#F59E0B', '#A3E635', '#22D3EE', '#EC4899', '#84CC16', '#F97316'];
const RANGES = { '15m': [15, 15], '1h': [60, 30], '6h': [360, 120], '24h': [1440, 300], '7d': [10080, 1800] };
const EXAMPLES = [
  ['CPU por servidor (%)', '100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100'],
  ['Memoria usada (%)', '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'],
  ['Días hasta llenar el disco /', 'node_filesystem_avail_bytes{mountpoint="/"} / clamp_min(-deriv(node_filesystem_avail_bytes{mountpoint="/"}[6h]), 1) / 86400'],
  ['Tiempo de respuesta de sitios (s)', 'probe_duration_seconds{job=~"blackbox_http.*"}'],
  ['Días para vencer certificados', '(probe_ssl_earliest_cert_expiry - time()) / 86400'],
  ['Tráfico de red recibido (MB/s)', 'sum by (instance) (rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[5m])) / 1e6'],
  ['Reinicios de contenedores (1 h)', 'increase(infra_container_restarts_total[1h])'],
  ['Consultas MySQL por segundo', 'rate(mysql_global_status_queries[5m])'],
];
const labelOf = (m) => { const e = Object.entries(m).filter(([k]) => k !== '__name__'); return e.length ? e.map(([k, v]) => `${k}="${v}"`).join(', ') : m.__name__ || 'valor'; };
const fmtV = (v) => (Math.abs(v) >= 1e6 ? v.toExponential(2) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));
const readHist = () => { try { return JSON.parse(localStorage.getItem('infra.explore') || '[]'); } catch { return []; } };

function MultiLine({ series }) {
  const [hx, setHx] = useState(null);
  const W = 900, H = 280, pl = 56, pr = 12, pt = 10, pb = 24, w = W - pl - pr, h = H - pt - pb;
  const all = series.flatMap((s) => s.values);
  if (!all.length) return <Empty>Sin datos en este rango.</Empty>;
  const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
  let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
  if (lo > 0 && lo < hi * 0.5) lo = 0; if (hi === lo) { hi += 1; lo -= lo ? 1 : 0; }
  const X = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * w, Y = (v) => pt + h - ((v - lo) / (hi - lo)) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const tf = (t) => new Date(t * 1000).toLocaleString('es-CO', t1 - t0 > 86400 ? { day: '2-digit', month: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false });
  const near = hx == null ? null : series.map((s) => s.values.reduce((b, p) => (Math.abs(p[0] - hx) < Math.abs(b[0] - hx) ? p : b), s.values[0]));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }} preserveAspectRatio="none"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const vx = ((e.clientX - r.left) / r.width) * W; setHx(vx < pl ? null : t0 + ((vx - pl) / w) * (t1 - t0)); }} onMouseLeave={() => setHx(null)}>
        {ticks.map((v, i) => <g key={i}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="#263349" strokeDasharray={i ? '2 4' : undefined} /><text x={pl - 6} y={Y(v) + 3} textAnchor="end" className="fill-faint text-[10px] font-mono">{fmtV(v)}</text></g>)}
        {[0, 1, 2, 3, 4].map((i) => { const t = t0 + ((t1 - t0) * i) / 4; return <text key={i} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-faint text-[10px] font-mono">{tf(t)}</text>; })}
        {series.map((s, i) => <polyline key={i} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" points={s.values.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} />)}
        {hx != null && <line x1={X(hx)} x2={X(hx)} y1={pt} y2={pt + h} stroke="#94A3B8" opacity=".5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {near && (
        <div className="absolute top-2 right-2 bg-[#0a1a1f] border border-line2 rounded-md px-2.5 py-1.5 font-mono text-[11px] max-w-[60%] pointer-events-none">
          <div className="text-faint mb-0.5">{new Date(near[0][0] * 1000).toLocaleString('es-CO', { hour12: false })}</div>
          {near.slice(0, 8).map((p, i) => <div key={i} className="truncate"><span style={{ color: COLORS[i % COLORS.length] }}>●</span> {fmtV(p[1])} <span className="text-faint">{series[i].label}</span></div>)}
        </div>
      )}
    </div>
  );
}

export function Explore() {
  const [expr, setExpr] = useState(EXAMPLES[0][1]);
  const [range, setRange] = useState('1h');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(readHist);

  const run = async (e = expr, r = range) => {
    if (!e.trim()) return;
    setBusy(true); setErr(null);
    try {
      if (DEMO) {
        const now = Date.now() / 1000, [mins, step] = RANGES[r];
        const mk = (name, b) => ({ label: `instance="${name}"`, values: Array.from({ length: Math.floor((mins * 60) / step) }, (_, k) => [now - mins * 60 + k * step, b + b * 0.3 * Math.sin(k / 6 + b)]) });
        const s = [mk('app-server', 58), mk('core-fineract', 32), mk('core-database', 44)];
        setRes({ series: s, instant: s.map((x) => ({ label: x.label, value: x.values.at(-1)[1] })) });
      } else {
        const [mins, step] = RANGES[r];
        const [rr, ii] = await Promise.all([qr(e, mins, step), q(e)]);
        setRes({ series: rr.slice(0, 8).map((s) => ({ label: labelOf(s.metric), values: s.values.map(([t, v]) => [+t, +v]).filter((p) => isFinite(p[1])) })), total: rr.length,
          instant: ii.map((x) => ({ label: labelOf(x.metric), value: +x.value[1] })).sort((a, b) => b.value - a.value) });
      }
      const h = [e, ...hist.filter((x) => x !== e)].slice(0, 12);
      setHist(h); try { localStorage.setItem('infra.explore', JSON.stringify(h)); } catch { /* sin almacenamiento */ }
    } catch (x) { setErr(x.details || x.message); setRes(null); }
    setBusy(false);
  };
  const legend = useMemo(() => res?.series || [], [res]);

  return (
    <>
      <PageHead title="Explorar" sub="Consultas libres a Prometheus (PromQL). Solo lectura: nada de lo que escribas aquí cambia el sistema." />
      <section className="panel mb-4 p-4">
        <textarea value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
          rows={3} spellCheck={false} aria-label="Consulta PromQL"
          className="w-full bg-bg1 border border-line rounded-lg p-3 font-mono text-[13px] text-ink outline-none focus:border-info resize-y" />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button type="button" onClick={() => run()} disabled={busy} className="h-[30px] px-4 rounded-lg bg-info text-white text-xs font-semibold hover:bg-info/90 disabled:opacity-50">{busy ? 'Consultando…' : 'Ejecutar'}</button>
          <span className="text-[11px] text-faint">Ctrl/⌘ + Enter</span>
          <div className="seg ml-2" role="group" aria-label="Rango">
            {Object.keys(RANGES).map((k) => <button key={k} type="button" aria-pressed={range === k} onClick={() => { setRange(k); if (res) run(expr, k); }}>{k}</button>)}
          </div>
          <select className="inp font-sans ml-auto max-w-[320px]" value="" onChange={(e) => { if (e.target.value) { setExpr(e.target.value); run(e.target.value); } }} aria-label="Ejemplos">
            <option value="">Ejemplos útiles…</option>
            {EXAMPLES.map(([l, x]) => <option key={l} value={x}>{l}</option>)}
          </select>
        </div>
        {hist.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{hist.slice(0, 6).map((h) => <button key={h} type="button" onClick={() => { setExpr(h); run(h); }} className="text-[11px] font-mono text-muted border border-line rounded px-2 py-0.5 hover:text-ink hover:border-line2 max-w-[360px] truncate" title={h}>{h}</button>)}</div>}
      </section>
      {err && <Panel className="mb-4" bodyClass="p-4"><pre className="m-0 text-crit font-mono text-[12px] whitespace-pre-wrap">{err}</pre></Panel>}
      {res && (
        <>
          <Panel title="Gráfica" meta={res.total > 8 ? `mostrando 8 de ${res.total} series` : `${legend.length} serie(s)`} className="mb-4" bodyClass="p-3">
            <MultiLine series={legend} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">{legend.map((s, i) => <span key={i} className="text-[11px] font-mono text-muted truncate max-w-[420px]"><span style={{ color: COLORS[i % COLORS.length] }}>●</span> {s.label}</span>)}</div>
          </Panel>
          <Panel title="Valores actuales" meta={`${res.instant.length} resultado(s)`} bodyClass="overflow-auto max-h-[400px]">
            <table className="tbl"><thead><tr><th>Serie</th><th className="num">Valor</th></tr></thead><tbody>
              {res.instant.length ? res.instant.map((x, i) => <tr key={i}><td className="font-mono text-xs text-ink2 break-all">{x.label}</td><td className="num text-ink">{fmtV(x.value)}</td></tr>) : <tr><td colSpan={2}><Empty>La consulta no devolvió resultados.</Empty></td></tr>}
            </tbody></table>
          </Panel>
        </>
      )}
    </>
  );
}
