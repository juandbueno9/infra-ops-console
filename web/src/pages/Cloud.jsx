// Costos AWS y almacenamiento S3 (solo lectura).
//  - Facturación: Cost Explorer (mes en curso por día y servicio, 6 meses, pronóstico de cierre).
//  - S3: tamaño y objetos por bucket (métricas diarias de CloudWatch) y revisión de seguridad de cada bucket.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { DEMO } from '../config.js';
import { STORAGE_CLASS, bytes, costFindings, dayReasons, periodCompare, explainUsage, loadBilling, loadBudget, loadFx, loadS3, moneyFmt, s3Growth, saveBudget, savingsAnalysis, summarizeBilling, svcName } from '../lib/aws.js';
import { useTheme } from '../lib/theme.js';
import { Sparkline } from '../components/charts.jsx';
import { HoloKpi } from '../components/cards3d.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel } from '../components/ui.jsx';
import { IRefresh } from '../components/icons.jsx';

const Donut3D = lazy(() => import('../components/Charts3D.jsx').then((m) => ({ default: m.Donut3D })));
// Paleta categórica validada (orden fijo; el color sigue al servicio/bucket, no a su posición)
const VIZ_DARK = ['#1fa9c0', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const VIZ_LIGHT = ['#2F7CF6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
const OTHER = '#64748B';
const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'hace instantes' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
const pctTxt = (v) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`);

function useAws(loader) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const load = async (force = false) => {
    setSt((s) => ({ ...s, loading: true }));
    try { setSt({ loading: false, data: await loader(force), error: null }); } catch (e) { setSt((s) => ({ loading: false, data: s.data, error: e.message })); }
  };
  useEffect(() => { load(); const t = setInterval(() => load(), 10 * 60e3); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [st, load];
}

// ---------------------------------------------------------------- gráficos
/** Barras diarias apiladas por servicio (mes en curso). series: [{key,name,color}] */
function DailyStack({ days, series, dim, openDays, m, height = 260, onPick, picked }) {
  const usd = m.fmt, usd0 = m.fmt0;
  const [hov, setHov] = useState(null);
  const ref = useRef(null);
  const W = 760, H = height, pl = 56, pr = 10, pt = 12, pb = 26, w = W - pl - pr, h = H - pt - pb;
  const K = m.k || 1, maxD = Math.max(1, ...days.map((d) => d.total)) * K;
  const magD = 10 ** Math.floor(Math.log10(maxD)), topD = Math.ceil((maxD * 1.12) / (magD / 2)) * (magD / 2), top = topD / K;
  const Y = (v) => pt + h - (v / top) * h, bw = w / dim, gap = Math.max(2, bw * 0.28);
  const keys = series.map((s) => s.key);
  const segs = (d) => {
    const vals = series.map((s) => (s.key === '__other' ? Object.entries(d.services).filter(([k]) => !keys.includes(k)).reduce((t, [, v]) => t + v, 0) : d.services[s.key] || 0));
    let acc = 0;
    return vals.map((v, i) => { const y0 = acc; acc += v; return { s: series[i], v, y0, y1: acc }; }).filter((x) => x.v > 0);
  };
  return (
    <div className="relative" onMouseLeave={() => setHov(null)}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height }} role="img" aria-label="Gasto diario por servicio, mes en curso">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pl} x2={W - pr} y1={Y(top * f)} y2={Y(top * f)} className="stroke-line" strokeDasharray={f ? '2 4' : undefined} />
            <text x={pl - 8} y={Y(top * f) + 3} textAnchor="end" className="fill-faint text-[10px] font-mono">{m.axis(topD * f)}</text>
          </g>
        ))}
        {Array.from({ length: dim }, (_, i) => i + 1).filter((dd) => dd === 1 || dd % 5 === 0 || dd === dim).map((dd) => (
          <text key={dd} x={pl + (dd - 0.5) * bw} y={H - 8} textAnchor="middle" className="fill-faint text-[10px] font-mono">{dd}</text>
        ))}
        {days.map((d) => {
          const dd = +d.date.slice(8, 10), x = pl + (dd - 1) * bw + gap / 2, bwi = bw - gap, list = segs(d), partial = !!openDays?.has(d.date);
          return (
            <g key={d.date} opacity={(hov && hov.date !== d.date) || (picked && !hov && picked !== d.date) ? 0.55 : 1}>
              {list.map((sg, k) => {
                const yTop = Y(sg.y1), yBot = Y(sg.y0) - (k ? 2 : 0), hh = Math.max(0, yBot - yTop), last = k === list.length - 1, r = last ? Math.min(4, bwi / 2, hh) : 0;
                const dPath = `M${x},${yBot}L${x},${yTop + r}Q${x},${yTop} ${x + r},${yTop}L${x + bwi - r},${yTop}Q${x + bwi},${yTop} ${x + bwi},${yTop + r}L${x + bwi},${yBot}Z`;
                return <path key={sg.s.key} d={dPath} fill={sg.s.color} opacity={partial ? 0.55 : 1} />;
              })}
              {picked === d.date && <rect x={pl + (dd - 1) * bw + 1} y={pt} width={bw - 2} height={h} rx="3" fill="none" className="stroke-info" strokeDasharray="3 3" />}
              <rect x={pl + (dd - 1) * bw} y={pt} width={bw} height={h} fill="transparent" style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(d.date)} onMouseMove={(e) => { const r = ref.current.getBoundingClientRect(); setHov({ date: d.date, d, list, x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, partial }); }} />
            </g>
          );
        })}
      </svg>
      {hov && (
        <div className="absolute z-20 pointer-events-none bg-bg1 border border-line2 rounded-lg px-3 py-2 shadow-xl text-[11.5px] min-w-[210px]" style={{ left: Math.min(hov.W - 230, hov.x + 14), top: Math.max(0, hov.y - 40) }}>
          <div className="text-faint font-mono text-[10.5px]">{new Date(hov.d.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}{hov.partial ? ' · aún no cerrado en AWS' : ''}</div>
          {[...hov.list].reverse().map((sg) => <div key={sg.s.key} className="flex items-center gap-2 mt-1"><i className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: sg.s.color }} /><span className="text-ink2 truncate flex-1">{sg.s.name}</span><b className="font-mono text-ink">{usd(sg.v)}</b></div>)}
          <div className="flex justify-between border-t border-line mt-1.5 pt-1.5 text-ink"><span>Total</span><b className="font-mono">{usd(hov.d.total)}</b></div>
          {onPick && <div className="text-[10.5px] text-info mt-1">Clic para ver el motivo de este día</div>}
          {m.second?.(hov.d.total) && <div className="text-right font-mono text-faint text-[10.5px]">{m.second(hov.d.total)}</div>}
        </div>
      )}
    </div>
  );
}

/** Barras mensuales (una serie). El mes en curso muestra lo gastado + el pronóstico en contorno. */
function MonthlyBars({ months, forecast, m: money, height = 220, curM: cm }) {
  const usd = money.fmt, usd0 = money.fmt0;
  const [hov, setHov] = useState(null);
  const W = 420, H = height, pl = 54, pr = 8, pt = 14, pb = 26, w = W - pl - pr, h = H - pt - pb;
  const curM = cm || new Date().toISOString().slice(0, 7);
  const K = money.k || 1, maxD = Math.max(1, ...months.map((m) => (m.month === curM && forecast ? Math.max(m.total, forecast) : m.total))) * K;
  const magD = 10 ** Math.floor(Math.log10(maxD)), topD = Math.ceil((maxD * 1.1) / (magD / 2)) * (magD / 2), top = topD / K;
  const Y = (v) => pt + h - (v / top) * h, bw = w / months.length, gap = bw * 0.34;
  const bar = (x, y, bwi, yb) => { const r = Math.min(4, bwi / 2, yb - y); return `M${x},${yb}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + bwi - r},${y}Q${x + bwi},${y} ${x + bwi},${y + r}L${x + bwi},${yb}Z`; };
  return (
    <div className="relative" onMouseLeave={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height }} role="img" aria-label="Gasto mensual, últimos 6 meses">
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={pl} x2={W - pr} y1={Y(top * f)} y2={Y(top * f)} className="stroke-line" strokeDasharray={f ? '2 4' : undefined} />
            <text x={pl - 8} y={Y(top * f) + 3} textAnchor="end" className="fill-faint text-[10px] font-mono">{money.axis(topD * f)}</text></g>
        ))}
        {months.map((m, i) => {
          const x = pl + i * bw + gap / 2, bwi = bw - gap, cur = m.month === curM;
          const label = new Date(m.month + '-15').toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
          return (
            <g key={m.month} onMouseEnter={() => setHov({ m, i, cur })}>
              {cur && forecast > m.total && <path d={bar(x, Y(forecast), bwi, Y(0))} fill="none" className="stroke-info" strokeDasharray="4 3" strokeWidth="1.5" />}
              <path d={bar(x, Y(m.total), bwi, Y(0))} className="fill-info" opacity={hov && hov.i !== i ? 0.5 : cur ? 0.75 : 1} />
              <text x={x + bwi / 2} y={H - 8} textAnchor="middle" className={`text-[10.5px] font-mono ${cur ? 'fill-ink' : 'fill-faint'}`}>{label}</text>
              <rect x={pl + i * bw} y={pt} width={bw} height={h} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {hov && (
        <div className="absolute z-20 pointer-events-none bg-bg1 border border-line2 rounded-lg px-3 py-2 shadow-xl text-[11.5px]" style={{ left: `${Math.min(70, ((hov.i + 0.5) / months.length) * 100)}%`, top: 0 }}>
          <div className="text-faint font-mono text-[10.5px] capitalize">{new Date(hov.m.month + '-15').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</div>
          <div className="text-ink">{hov.cur ? 'Gastado' : 'Total'} <b className="font-mono">{usd(hov.m.total)}</b>{money.second?.(hov.m.total) && <span className="text-faint font-mono"> · {money.second(hov.m.total)}</span>}</div>
          {hov.cur && forecast != null && <div className="text-info">Pronóstico <b className="font-mono">{usd(forecast)}</b></div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- configuración pendiente
function Setup({ error }) {  // eslint-disable-line react/prop-types
  const policy = 'deploy/aws/iam-facturacion.json';
  return (
    <Panel title="Conectar AWS (facturación y S3)" className="mb-4" bodyClass="p-5 text-[13px] space-y-3">
      {error && <div className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-crit text-[12.5px]">{error}</div>}
      <ol className="list-decimal pl-5 space-y-2 text-ink2">
        <li>En la consola de AWS → <b className="text-ink">IAM → Políticas → Crear política</b> (pestaña JSON) y pega el contenido de <code className="font-mono text-info">{policy}</code>. Nómbrala <code className="font-mono text-info">Monitoreo-Facturacion-SoloLectura</code>.</li>
        <li><b className="text-ink">IAM → Usuarios → Crear usuario</b> <code className="font-mono text-info">Monitoreo-Facturacion</code>, <b>sin</b> acceso a la consola, y adjúntale esa política.</li>
        <li>En el usuario → <b className="text-ink">Credenciales de seguridad → Crear clave de acceso</b> → “Aplicación que se ejecuta fuera de AWS”.</li>
        <li>Agrega las claves en <code className="font-mono text-info">server/.env</code> (nunca en el navegador ni en git):
          <pre className="mt-1.5 bg-bg1 border border-line rounded-lg p-2.5 font-mono text-[12px] text-ink overflow-x-auto">{'AWS_ACCESS_KEY_ID=AKIA...\nAWS_SECRET_ACCESS_KEY=...\nAWS_REGION=us-east-1'}</pre></li>
        <li>Instala el SDK y reinicia: <code className="font-mono text-info">npm --prefix server install</code> y luego <code className="font-mono text-info">npm run dev</code>.</li>
        <li>Si Cost Explorer nunca se ha abierto en la cuenta, actívalo en <b className="text-ink">Billing → Cost Explorer</b> (los datos pueden tardar hasta 24 h la primera vez).</li>
      </ol>
      <p className="text-muted text-[12px]">Todo es de solo lectura: el usuario no puede leer el contenido de los archivos de S3 ni cambiar nada. Cost Explorer cobra USD 0,01 por consulta; el panel guarda los datos 6 horas (≈ USD 1–2 al mes).</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- ahorro diario
/** Barras de ahorro por día: verde = se gastó menos que la línea base, rojo = más. */
function SavingsBars({ series, base, m, height = 190 }) {
  const [hov, setHov] = useState(null);
  const W = 760, H = height, pl = 56, pr = 10, pt = 12, pb = 26, w = W - pl - pr, h = H - pt - pb;
  const vals = series.map((d) => (d.saving != null ? d.saving : 0));
  const K = m.k || 1, mx = Math.max(1, ...vals.map(Math.abs)) * 1.15, top = mx, Y = (v) => pt + h / 2 - (v / top) * (h / 2);
  const bw = w / Math.max(1, series.length), gap = Math.max(2, bw * 0.3);
  return (
    <div className="relative" onMouseLeave={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height }} role="img" aria-label="Ahorro diario frente a la línea base">
        {[1, 0.5, 0, -0.5, -1].map((f) => (
          <g key={f}><line x1={pl} x2={W - pr} y1={Y(top * f)} y2={Y(top * f)} className="stroke-line" strokeDasharray={f ? '2 4' : undefined} />
            <text x={pl - 8} y={Y(top * f) + 3} textAnchor="end" className="fill-faint text-[10px] font-mono">{m.axis(+(top * f * K).toFixed(top * K < 10 ? 1 : 0))}</text></g>
        ))}
        {series.map((d, i) => {
          const x = pl + i * bw + gap / 2, bwi = bw - gap;
          if (d.saving == null) return <rect key={d.date} x={x} y={Y(0) - 1} width={bwi} height={2} className="fill-faint" opacity=".5" />;
          const y0 = Y(0), y1 = Y(d.saving), pos = d.saving >= 0;
          return (
            <g key={d.date} opacity={hov && hov.d.date !== d.date ? 0.55 : d.closed && !d.monthStart ? 1 : 0.45}>
              <rect x={x} y={Math.min(y0, y1)} width={bwi} height={Math.max(1, Math.abs(y1 - y0))} rx="2" className={pos ? 'fill-ok' : 'fill-crit'} />
              <rect x={pl + i * bw} y={pt} width={bw} height={h} fill="transparent" onMouseMove={() => setHov({ d, i })} />
            </g>
          );
        })}
        {series.map((d, i) => (i === 0 || i === series.length - 1 || +d.date.slice(8) % 5 === 0) && <text key={d.date + 't'} x={pl + (i + 0.5) * bw} y={H - 8} textAnchor="middle" className="fill-faint text-[10px] font-mono">{d.date.slice(8)}</text>)}
      </svg>
      {hov && (
        <div className="absolute z-20 pointer-events-none bg-bg1 border border-line2 rounded-lg px-3 py-2 shadow-xl text-[11.5px] min-w-[220px]" style={{ left: `${Math.min(68, ((hov.i + 0.5) / series.length) * 100)}%`, top: 0 }}>
          <div className="text-faint font-mono text-[10.5px]">{new Date(hov.d.date + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}{!hov.d.closed ? ' · aún no cerrado' : ''}{hov.d.monthStart ? ' · día 1 (cobros mensuales)' : ''}</div>
          <div className="flex justify-between gap-3 mt-1 text-ink2"><span>Gasto del día</span><b className="font-mono text-ink">{m.fmt(hov.d.total)}</b></div>
          <div className="flex justify-between gap-3 text-ink2"><span>Línea base</span><b className="font-mono text-ink">{m.fmt(base)}</b></div>
          {hov.d.saving != null && <div className={`flex justify-between gap-3 border-t border-line mt-1 pt-1 ${hov.d.saving >= 0 ? 'text-ok' : 'text-crit'}`}><span>{hov.d.saving >= 0 ? 'Ahorro' : 'Gasto extra'}</span><b className="font-mono">{m.fmt(Math.abs(hov.d.saving))}</b></div>}
          {hov.d.saving == null && <div className="text-faint mt-1">Antes de las optimizaciones</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- reportes
const csvCell = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const num2 = (v) => (v == null ? '' : (+v).toFixed(2).replace('.', ','));
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** CSV (Excel en español: separador ";" y coma decimal) con el detalle diario por concepto, más el normal y la diferencia. */
function exportCsv(B, trm) {
  const rows = (B?.dailyUsage || []).filter((r) => r[1] !== 'Tax');
  const dates = [...new Set(rows.map((r) => r[0]))].sort();
  const lines = [['Fecha', 'Servicio', 'Concepto', 'Tipo de uso AWS', 'Costo USD', 'Costo COP', 'Normal 7 días USD', 'Diferencia USD'].join(';')];
  const cacheR = {};
  for (const d of dates) cacheR[d] = Object.fromEntries((dayReasons(B, d, 999)?.all || []).map((x) => [x.key, x]));
  for (const [d, svc, ut, c] of rows) {
    const r = cacheR[d]?.[`${svc}|${ut}`];
    lines.push([d, svcName(svc), explainUsage({ service: svc, usageType: ut }).label, ut, num2(c), trm ? Math.round(c * trm) : '', num2(r?.normal), num2(r ? r.delta : null)].map(csvCell).join(';'));
  }
  download(`consumo-aws-detalle-${B?.today || 'hoy'}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}
/** Reporte imprimible (Guardar como PDF desde el diálogo de impresión). */
function printReport({ sum, sav, B, S, findings, M, trm }) {
  const f = M.fmt, esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cop = (v) => (trm && v != null ? ` <small>(${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v * trm)})</small>` : '');
  const mes = new Date(sum.curM + '-15T12:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const usage = (sum.usage || []).slice(0, 15).map((u) => ({ ...u, ex: explainUsage(u) }));
  const picos = (sum.closed || []).slice(-14).map((d) => dayReasons(B, d.date, 3)).filter((r) => r && r.prevDays >= 3 && r.normal > 0 && r.delta > r.normal * 0.2);
  const buckets = (S?.buckets || []).map((b) => ({ b, g: s3Growth(b) })).filter((x) => x.g).sort((a, c) => c.g.avg7 - a.g.avg7).slice(0, 10);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de consumo AWS · ${esc(mes)}</title><style>
    body{font:12.5px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:28px 34px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 8px;border-bottom:2px solid #2F7CF6;padding-bottom:4px}
    .sub{color:#64748b;margin:2px 0 14px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.k{border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}.k b{display:block;font-size:17px}.k span{color:#64748b;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:4px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#475569}td.n,th.n{text-align:right;white-space:nowrap}
    .ok{color:#047857}.bad{color:#b91c1c}small{color:#64748b}.note{color:#64748b;font-size:11px;margin-top:6px}@media print{body{margin:12mm}h2{break-after:avoid}tr{break-inside:avoid}}
  </style></head><body>
  <h1>Reporte de consumo AWS · Infra Ops</h1><div class="sub">${esc(mes)} · generado el ${new Date().toLocaleString('es-CO')} · datos de AWS Cost Explorer${B?.today ? ` hasta el ${esc(B.today)}` : ''}</div>
  <div class="kpis"><div class="k"><span>Gastado este mes</span><b>${f(sum.mtd)}</b>${cop(sum.mtd)}</div><div class="k"><span>Pronóstico de cierre</span><b>${f(sum.forecast)}</b>${cop(sum.forecast)}</div>
  <div class="k"><span>Mes anterior</span><b>${f(sum.prev?.total)}</b>${cop(sum.prev?.total)}</div><div class="k"><span>Ahorro diario promedio</span><b class="${(sav?.avgDaily || 0) >= 0 ? 'ok' : 'bad'}">${sav?.avgDaily != null ? f(sav.avgDaily) : '—'}</b>${sav?.monthly != null ? `<small>≈ ${f(sav.monthly)} al mes</small>` : '<small>esperando días cerrados</small>'}</div></div>
  ${sav ? `<h2>Ahorro frente a la línea base</h2><div class="note">Línea base: mediana diaria del ${esc(sav.baseFrom)} al ${esc(sav.baseTo)} = ${f(sav.baseTotal)} por día. Optimizaciones desde el ${esc(sav.from)}. Sin impuestos ni el día 1 de cada mes.</div>
  <table><tr><th>Concepto</th><th class="n">Antes (diario)</th><th class="n">Ahora (diario)</th><th class="n">Diferencia diaria</th></tr>${[...sav.savers.slice(0, 8), ...sav.risers.slice(0, 5)].map((x) => `<tr><td>${esc(x.label)}<br><small>${esc(svcName(x.service))}</small></td><td class="n">${f(x.before)}</td><td class="n">${f(x.now)}</td><td class="n ${x.saving >= 0 ? 'ok' : 'bad'}">${x.saving >= 0 ? '−' : '+'}${f(Math.abs(x.saving))}</td></tr>`).join('')}</table>` : ''}
  <h2>Gasto por servicio</h2><table><tr><th>Servicio</th><th class="n">Este mes</th><th class="n">Mes anterior</th><th class="n">%</th></tr>${sum.services.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${f(x.mtd)}</td><td class="n">${x.prev ? f(x.prev) : '—'}</td><td class="n">${((x.mtd / (sum.mtd || 1)) * 100).toFixed(1)}%</td></tr>`).join('')}</table>
  <h2>Lo que más cobra (por concepto)</h2><table><tr><th>Concepto</th><th class="n">Este mes</th><th class="n">Mes anterior</th><th>Qué hacer</th></tr>${usage.map((u) => `<tr><td>${esc(u.ex.label)}<br><small>${esc(u.usageType)}</small></td><td class="n">${f(u.cur)}</td><td class="n">${u.prev ? f(u.prev) : '—'}</td><td><small>${esc(u.ex.tip)}</small></td></tr>`).join('')}</table>
  <h2>Días con más gasto de lo normal y su motivo</h2>${picos.length ? `<table><tr><th>Día</th><th class="n">Gasto</th><th class="n">Normal</th><th>Motivo principal</th></tr>${picos.map((r) => `<tr><td>${esc(r.date)}</td><td class="n">${f(r.total)}</td><td class="n">${f(r.normal)}</td><td>${r.items.filter((x) => x.delta > 0).map((x) => `${esc(x.label)} <b class="bad">+${f(x.delta)}</b>`).join('<br>')}</td></tr>`).join('')}</table>` : '<div class="note">Sin días fuera de lo normal en las últimas dos semanas.</div>'}
  ${findings.length ? `<h2>Alertas de costo</h2><ul>${findings.map((x) => `<li><b>${esc(x.title)}</b> — ${esc(x.detail)}</li>`).join('')}</ul>` : ''}
  ${buckets.length ? `<h2>Crecimiento del almacenamiento S3</h2><table><tr><th>Bucket</th><th class="n">Tamaño</th><th class="n">Último día</th><th class="n">Promedio diario (7 d)</th><th class="n">Ritmo al mes</th></tr>${buckets.map(({ b, g }) => `<tr><td>${esc(b.name)}${g.spike ? ' <b class="bad">⚠ fuera de lo normal</b>' : ''}</td><td class="n">${bytes(b.sizeBytes)}</td><td class="n">${g.last.delta >= 0 ? '+' : '−'}${bytes(Math.abs(g.last.delta))}</td><td class="n">${g.avg7 >= 0 ? '+' : '−'}${bytes(Math.abs(g.avg7))}</td><td class="n">${g.perMonth >= 0 ? '+' : '−'}${bytes(Math.abs(g.perMonth))}</td></tr>`).join('')}</table>` : ''}
  <div class="note">Cost Explorer tarda 24–48 h en cerrar cada día; las cifras de los dos últimos días pueden cambiar.</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { download(`reporte-consumo-aws-${sum.curM}.html`, html, 'text/html'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ---------------------------------------------------------------- página
export function Cloud() {
  const [bill, reloadBill] = useAws(loadBilling);
  const [st3, reloadS3] = useAws(loadS3);
  const [q, setQ] = useState('');
  const [, theme] = useTheme();
  const [cur, setCur] = useState(() => { try { return localStorage.getItem('infra.moneda') || 'AMBAS'; } catch { return 'AMBAS'; } });
  const [fx, setFx] = useState(null);
  const [budget, setBudget] = useState(null);
  const [budgetEdit, setBudgetEdit] = useState(null);
  const [openU, setOpenU] = useState(null);
  const [pickDay, setPickDay] = useState(null);
  const [cmpMode, setCmpMode] = useState('week');
  const [cmpAll, setCmpAll] = useState(false);
  useEffect(() => {
    const fxLoad = () => loadFx().then(setFx).catch((e) => setFx((f) => (f?.rate ? { ...f, stale: true } : { error: e.message })));
    fxLoad(); loadBudget().then((b) => setBudget(b?.usd ?? null)).catch(() => {});
    const t = setInterval(fxLoad, 60 * 60e3); // la TRM se revisa cada hora
    return () => clearInterval(t);
  }, []);
  const changeCur = (c) => { setCur(c); try { localStorage.setItem('infra.moneda', c); } catch { /* sin almacenamiento */ } };
  const M = moneyFmt(cur, fx?.rate);
  const usd = M.fmt, usd0 = M.fmt0;
  const cop = M.second || (() => null);
  const Two = ({ v }) => (<>{usd(v)}{cop(v) && <span className="block text-[10.5px] text-faint font-mono">{cop(v)}</span>}</>);
  const fxDelta = fx?.rate && fx?.prev ? fx.rate - fx.prev : null;
  const VIZ = theme === 'light' ? VIZ_LIGHT : VIZ_DARK;
  const B = bill.data, S = st3.data;
  const sum = useMemo(() => summarizeBilling(B), [B]);
  const notConfigured = B?.configured === false || S?.configured === false;

  // Series: los 5 servicios con más gasto + "Otros" (color fijo por servicio en esta vista)
  const series = useMemo(() => {
    if (!sum) return [];
    const top = sum.services.slice(0, 5).map((s, i) => ({ key: s.key, name: s.name, color: VIZ[i], dark: VIZ_DARK[i] }));
    return sum.services.length > 5 ? [...top, { key: '__other', name: 'Otros', color: OTHER, dark: OTHER }] : top;
  }, [sum, VIZ]);
  const colorOf = (k) => series.find((s) => s.key === k)?.color || OTHER;

  const buckets = (S?.buckets || []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()));
  const totalBytes = (S?.buckets || []).reduce((t, b) => t + (b.sizeBytes || 0), 0);
  const totalObj = (S?.buckets || []).reduce((t, b) => t + (b.objects || 0), 0);
  const risk = (b) => [b.isPublic && ['crit', 'Público'], b.publicBlock === 'none' && ['crit', 'Sin bloqueo público'], b.publicBlock === 'partial' && ['warn', 'Bloqueo parcial'], b.encryption === 'none' && ['warn', 'Sin cifrado']].filter(Boolean);
  const risky = (S?.buckets || []).filter((b) => risk(b).length);
  const s3Cost = sum?.services.find((s) => s.key === 'Amazon Simple Storage Service')?.mtd ?? null;
  const growth = (b) => { const h = b.history || []; if (h.length < 8) return null; const a = h[Math.max(0, h.length - 31)][1], z = h[h.length - 1][1]; return a ? ((z - a) / a) * 100 : null; };
  const topB = (S?.buckets || []).slice(0, 5), restB = (S?.buckets || []).slice(5).reduce((t, b) => t + (b.sizeBytes || 0), 0);
  const day = sum?.day ?? new Date().getDate();
  const sav = useMemo(() => savingsAnalysis(B), [B]);
  const lastClosed = sum?.yesterday?.date || null;
  const cmp = useMemo(() => (B ? periodCompare(B, pickDay) : null), [B, pickDay]);
  const cmpBase = useMemo(() => (B ? periodCompare(B) : null), [B]); // última semana cerrada, para la tabla de conceptos
  const growthRows = useMemo(() => (S?.buckets || []).map((b) => ({ b, g: s3Growth(b) })).filter((x) => x.g), [S]);
  const s3Spikes = growthRows.filter((x) => x.g.spike);
  const s3Day = growthRows.reduce((t, x) => t + x.g.last.delta, 0), s3Month = growthRows.reduce((t, x) => t + x.g.perMonth, 0);
  const prevPace = sum?.prev ? sum.prev.total : null;

  return (
    <>
      <PageHead title="Costos AWS y almacenamiento S3" sub={`Facturación de la cuenta y buckets de S3 · solo lectura${DEMO ? ' · datos de demostración' : ''}`}>
        <div className="seg" role="group" aria-label="Moneda">
          {[['AMBAS', 'USD + COP'], ['USD', 'USD'], ['COP', 'COP']].map(([c, l]) => <button key={c} type="button" aria-pressed={cur === c} onClick={() => changeCur(c)} title={c === 'USD' ? 'Moneda en que factura AWS' : fx?.rate ? `Convertido con ${fx.source}` : fx?.error || 'Cargando TRM…'}>{l}</button>)}
        </div>
        {fx?.rate ? (
          <span className="flex items-center gap-1.5 text-[11px] font-mono px-2 h-[26px] rounded-md border border-line bg-bg1" title={`${fx.source}${fx.date ? ` · vigente desde ${fx.date}` : ''} · se revisa cada hora`}>
            <span className="text-muted">TRM</span><b className="text-ink">{fx.rate.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            {fxDelta != null && <span className={fxDelta > 0 ? 'text-crit' : fxDelta < 0 ? 'text-ok' : 'text-faint'} title="Frente a la TRM anterior (si sube el dólar, AWS sale más caro en pesos)">{fxDelta > 0 ? '▲' : fxDelta < 0 ? '▼' : '='} {Math.abs(fxDelta).toLocaleString('es-CO', { maximumFractionDigits: 2 })}</span>}
            {fx.date && <span className="text-faint">· {new Date(fx.date + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span>}
          </span>
        ) : <span className="text-[11px] text-warn" title={fx?.error || ''}>{fx?.error ? 'No se pudo obtener la TRM' : 'Consultando TRM…'}</span>}
        <span className="text-[11.5px] text-faint font-mono">{B?.cachedAt ? `facturación ${ago(B.cachedAt)}` : ''}{S?.cachedAt ? ` · S3 ${ago(S.cachedAt)}` : ''}</span>
        <button type="button" className="btn" disabled={!sum} onClick={() => printReport({ sum, sav, B, S, findings: costFindings(sum, budget), M, trm: fx?.rate })} title="Reporte de consumo listo para imprimir o guardar como PDF">Reporte PDF</button>
        <button type="button" className="btn" disabled={!B?.dailyUsage?.length} onClick={() => exportCsv(B, fx?.rate)} title="Detalle diario por concepto (últimos 45 días) para Excel">Detalle CSV</button>
        <button type="button" className="btn" onClick={() => { reloadBill(true); reloadS3(true); }} disabled={bill.loading || st3.loading} title="Consulta de nuevo a AWS (máximo cada 10 min; Cost Explorer cobra USD 0,01 por consulta)">
          <IRefresh size={14} className={bill.loading || st3.loading ? 'animate-spin' : ''} />Actualizar
        </button>
      </PageHead>

      {notConfigured && <Setup />}
      {!notConfigured && (bill.error || st3.error || B?.error || S?.error) && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn">
          {bill.error || B?.error ? <div>Facturación: {bill.error || B.error}{B?.stale ? ' (se muestran los últimos datos guardados)' : ''}</div> : null}
          {st3.error || S?.error ? <div>S3: {st3.error || S.error}{S?.stale ? ' (se muestran los últimos datos guardados)' : ''}</div> : null}
        </div>
      )}

      {/* ---------------- Facturación ---------------- */}
      <h2 className="text-[14px] font-semibold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-info shadow-[0_0_8px_#5AB8FF]" />Facturación AWS</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <HoloKpi label={sum?.showingPrev ? `Gastado en ${new Date(sum.curM + '-15T12:00:00').toLocaleDateString('es-CO', { month: 'long' })} (cerrado)` : 'Gastado este mes'} value={sum ? usd(sum.mtd) : '—'} sub={sum ? cop(sum.mtd) : null} tone="off" gauge={sum ? (day / sum.dim) * 100 : undefined} gaugeLabel={sum ? `día ${day}` : undefined}
          foot={sum?.prev ? `Mes anterior completo: ${usd(sum.prev.total)}` : 'Mes en curso'} spark={sum?.monthDays.map((d) => d.total)} sparkColor="#1fa9c0" />
        {sum?.showingPrev ? (
          <HoloKpi label={`Pronóstico de ${new Date(sum.todayUTC.slice(0, 7) + '-15T12:00:00').toLocaleDateString('es-CO', { month: 'long' })}`} value={sum.nextForecast != null ? usd(sum.nextForecast) : '—'} sub={sum.nextForecast != null ? cop(sum.nextForecast) : null}
            tone={sum.nextForecast != null ? (sum.nextForecast > sum.mtd * 1.03 ? 'warn' : 'ok') : 'off'} gauge={sum.nextForecast != null && sum.mtd ? Math.min(150, (sum.nextForecast / sum.mtd) * 100) : undefined} gaugeMax={150}
            gaugeLabel={sum.nextForecast != null && sum.mtd ? pctTxt(((sum.nextForecast - sum.mtd) / sum.mtd) * 100) : undefined} foot="Modelo de AWS para el mes que empieza · vs el mes cerrado" />
        ) : (
        <HoloKpi label="Pronóstico de cierre" value={sum?.forecast != null ? usd(sum.forecast) : '—'} sub={sum?.forecast != null ? cop(sum.forecast) : null}
          tone={sum?.forecast != null && prevPace ? (sum.forecast > prevPace * 1.15 ? 'crit' : sum.forecast > prevPace * 1.03 ? 'warn' : 'ok') : 'off'}
          gauge={sum?.forecast != null && prevPace ? Math.min(150, (sum.forecast / prevPace) * 100) : undefined} gaugeMax={150}
          gaugeLabel={sum?.forecast != null && prevPace ? pctTxt(((sum.forecast - prevPace) / prevPace) * 100) : undefined}
          foot={sum?.forecastLow != null ? `Rango probable ${usd0(sum.forecastLow)} – ${usd0(sum.forecastHigh)} · vs mes anterior` : sum ? 'Estimado por el ritmo diario' : ''} />
        )}
        <HoloKpi label="Último día cerrado" value={sum?.yesterday ? usd(sum.yesterday.total) : '—'} sub={sum?.yesterday ? cop(sum.yesterday.total) : null} tone="off"
          foot={sum?.yesterday ? `${new Date(sum.yesterday.date + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} · promedio diario ${usd(sum.avgDay)}` : 'AWS cierra cada día en 24–48 h'} />
        <HoloKpi label="Servicio con más gasto" value={sum?.services[0] ? usd(sum.services[0].mtd) : '—'} sub={sum?.services[0] ? cop(sum.services[0].mtd) : null} tone="off"
          foot={sum?.services[0] ? `${sum.services[0].name} · ${Math.round((sum.services[0].mtd / (sum.mtd || 1)) * 100)}% del mes` : ''} />
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <Panel title="Gasto diario por servicio" meta={sum ? `${new Date(sum.curM + '-15T12:00:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })} · ${sum.showingPrev ? 'mes cerrado' : 'clic en un día para ver el motivo'}` : ''} className="col-span-12 xl:col-span-8" bodyClass="p-4">
          {sum ? (<>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2 text-[11.5px]">
              {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-ink2"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
            </div>
            <DailyStack days={sum.monthDays} series={series} dim={sum.dim} openDays={sum.openDays} m={M} onPick={setPickDay} picked={pickDay || lastClosed} />
          </>) : <Empty>{bill.loading ? 'Consultando Cost Explorer…' : 'Sin datos de facturación.'}</Empty>}
        </Panel>
        <section className="panel col-span-12 xl:col-span-4">
          <header className="panel-h"><h2>Distribución del mes</h2><span className="panel-meta">{sum ? `${usd(sum.mtd)}${cop(sum.mtd) ? ` · ${cop(sum.mtd)}` : ''}` : ''}</span></header>
          <div className="p-3">
            <div className="screen3d dark-zone">
              {sum && sum.services.length ? (
                <Suspense fallback={<div className="h-[250px]" />}>
                  <Donut3D height={250} fmt={usd} center={{ value: usd0(sum.mtd), caption: 'este mes' }}
                    segments={series.map((s) => ({ key: s.key, label: s.name, color: s.dark, value: +(s.key === '__other' ? sum.services.slice(5).reduce((t, x) => t + x.mtd, 0) : sum.services.find((x) => x.key === s.key)?.mtd || 0).toFixed(2) }))} />
                </Suspense>
              ) : <div className="h-[250px] grid place-items-center text-xs text-muted">Sin datos</div>}
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- Ahorro diario y motivo del día ---------------- */}
      <h2 className="text-[14px] font-semibold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-ok shadow-[0_0_8px_#10B981]" />Ahorro diario</h2>
      {sav ? (<>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
          <HoloKpi label="Ahorro último día cerrado" value={sav.last ? usd(sav.last.saving) : '—'} sub={sav.last ? cop(sav.last.saving) : null} tone={!sav.last ? 'off' : sav.last.saving >= 0 ? 'ok' : 'crit'}
            foot={sav.last ? `${new Date(sav.last.date + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} · gastó ${usd(sav.last.total)} vs base ${usd(sav.baseTotal)}` : `AWS cierra cada día en 24–48 h · ${sav.pending.length} día(s) en espera`} />
          <HoloKpi label="Ahorro promedio diario" value={sav.avgDaily != null ? usd(sav.avgDaily) : '—'} sub={sav.avgDaily != null ? cop(sav.avgDaily) : null} tone={sav.avgDaily == null ? 'off' : sav.avgDaily >= 0 ? 'ok' : 'crit'} foot={sav.days ? `${sav.days} día(s) medido(s) desde el ${sav.from.slice(8)}/${sav.from.slice(5, 7)}` : 'Esperando el primer día cerrado'} />
          <HoloKpi label="Ahorro proyectado al mes" value={sav.monthly != null ? usd(sav.monthly) : '—'} sub={sav.monthly != null ? cop(sav.monthly) : null} tone={sav.monthly == null ? 'off' : sav.monthly >= 0 ? 'ok' : 'crit'} foot="Promedio diario × 30 · S3 sigue bajando hasta diciembre" />
          <HoloKpi label="Ahorro acumulado" value={sav.days ? usd(sav.cumulative) : '—'} sub={sav.days ? cop(sav.cumulative) : null} tone={!sav.days ? 'off' : sav.cumulative >= 0 ? 'ok' : 'crit'} foot={`Línea base ${usd(sav.baseTotal)}/día · mediana ${sav.baseFrom.slice(5)} a ${sav.baseTo.slice(5)}`} />
        </div>
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Panel title="Ahorro por día frente a la línea base" meta="verde = gastó menos · rojo = gastó más" className="col-span-12 xl:col-span-7" bodyClass="p-4">
            <SavingsBars series={sav.series} base={sav.baseTotal} m={M} />
            <div className="text-[11px] text-faint mt-2">Sin impuestos ni el día 1 de cada mes (AWS carga ese día los cobros mensuales). Las barras claras aún no están cerradas en AWS.</div>
          </Panel>
          <Panel title="De dónde sale el ahorro" meta={sav.days ? 'diario · antes vs últimos días' : 'esperando días cerrados'} className="col-span-12 xl:col-span-5" bodyClass="overflow-auto max-h-[300px]">
            {sav.savers.length || sav.risers.length ? (
              <table className="tbl">
                <thead><tr><th>Concepto</th><th className="num">Antes</th><th className="num">Ahora</th><th className="num">Diferencia</th></tr></thead>
                <tbody>
                  {[...sav.savers.slice(0, 8), ...sav.risers.slice(0, 5)].map((x) => (
                    <tr key={x.key}><td><div className="text-ink text-[12px]">{x.label}</div><div className="text-[10.5px] text-faint">{svcName(x.service)}</div></td>
                      <td className="num">{usd(x.before)}</td><td className="num">{usd(x.now)}</td>
                      <td className={`num font-semibold ${x.saving >= 0 ? 'text-ok' : 'text-crit'}`}>{x.saving >= 0 ? '▼ ' : '▲ '}{usd(Math.abs(x.saving))}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>Aparece cuando AWS cierre el primer día después de las optimizaciones ({sav.from}).</Empty>}
          </Panel>
        </div>
      </>) : <div className="panel p-4 mb-4 text-[12.5px] text-muted">{bill.loading ? 'Calculando ahorro…' : 'Pulsa “Actualizar” para cargar el detalle diario y calcular el ahorro (se necesitan al menos 5 días antes de las optimizaciones).'}</div>}

      {cmp && (() => {
        const fd = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        const fr = (lbl) => lbl.split(' → ').map(fd).join(' – ');
        const M = { day: ['Día', 'Último día cerrado vs el día anterior'], week: ['Semana', 'Últimos 7 días vs los 7 anteriores'], month: ['Mes', 'Mes a la fecha vs los mismos días del mes anterior'] };
        const P = cmp[cmpMode];
        const Delta = ({ d, pct, big }) => (d == null ? <span className="text-faint">—</span> : <span className={`font-mono ${big ? 'text-[13px]' : ''} ${Math.abs(d) < 0.01 ? 'text-faint' : d > 0 ? 'text-crit' : 'text-ok'}`}>{Math.abs(d) < 0.01 ? '= igual' : `${d > 0 ? '▲ +' : '▼ −'}${usd(Math.abs(d))}`}{pct != null && Math.abs(d) >= 0.01 ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</span>);
        const hasDay1 = P.cur.some((d) => d.endsWith('-01')) !== P.prev.some((d) => d.endsWith('-01'));
        const rows = cmpAll ? P.items : P.items.slice(0, 15);
        return (
          <div className="grid grid-cols-12 gap-4 mb-6">
            <Panel title="Comparativo de consumo" meta={`referencia: ${fd(cmp.ref)}${pickDay ? ' (elegido en el gráfico)' : ' · último día cerrado'}`} className="col-span-12" bodyClass="overflow-x-auto"
              actions={<div className="flex items-center gap-2">{pickDay && <button type="button" className="text-[11.5px] text-info hover:underline" onClick={() => setPickDay(null)}>Volver al último día cerrado</button>}<div className="seg" role="group" aria-label="Periodo">{Object.entries(M).map(([k, [l]]) => <button key={k} type="button" aria-pressed={cmpMode === k} onClick={() => setCmpMode(k)}>{l}</button>)}</div></div>}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3">
                {Object.entries(M).map(([k, [l, desc]]) => { const x = cmp[k]; return (
                  <button key={k} type="button" onClick={() => setCmpMode(k)} className={`text-left rounded-xl border p-3 transition-colors ${cmpMode === k ? 'border-info bg-info/10' : 'border-line bg-bg1 hover:border-line2'}`}>
                    <div className="flex justify-between text-[11px] uppercase tracking-wide text-faint"><span>{l}</span><span className="normal-case tracking-normal">{desc}</span></div>
                    <div className="flex items-baseline justify-between mt-2 gap-3">
                      <div><div className="text-[10.5px] text-faint">{k === 'day' ? fd(x.curLabel) : fr(x.curLabel)}</div><div className="font-mono text-ink text-[18px]">{usd(x.total)}</div>{cop(x.total) && <div className="text-[10.5px] text-faint font-mono">{cop(x.total)}</div>}</div>
                      <div className="text-right"><div className="text-[10.5px] text-faint">{k === 'day' ? fd(x.prevLabel) : fr(x.prevLabel)}</div><div className="font-mono text-ink2 text-[14px]">{x.prev.length ? usd(x.prevTotal) : '—'}</div></div>
                    </div>
                    <div className="mt-1.5">{x.prev.length ? <Delta d={x.delta} pct={x.pct} big /> : <span className="text-[11px] text-faint">Aún no hay datos del periodo anterior</span>}{x.prev.length > 0 && !x.complete && <span className="text-[10.5px] text-faint ml-2">(periodo anterior incompleto)</span>}</div>
                  </button>); })}
              </div>
              {hasDay1 && <div className="mx-3 mb-2 text-[11.5px] text-warn">Uno de los dos periodos incluye el día 1 del mes, cuando AWS carga cobros mensuales fijos: esa diferencia es normal.</div>}
              {P.items.length ? (
                <table className="tbl">
                  <thead><tr><th>Concepto</th><th className="num">{M[cmpMode][0] === 'Día' ? fd(P.curLabel) : 'Actual'}</th><th className="num">{M[cmpMode][0] === 'Día' ? fd(P.prevLabel) : 'Anterior'}</th><th className="num">Diferencia</th><th>Qué significa</th></tr></thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.key}><td><div className="text-ink">{x.label}</div><div className="text-[10.5px] text-faint font-mono">{svcName(x.service)} · {x.usageType}</div></td>
                        <td className="num text-ink"><Two v={x.cur} /></td><td className="num">{usd(x.prev)}</td>
                        <td className="num whitespace-nowrap"><Delta d={x.delta} pct={x.prev ? (x.delta / x.prev) * 100 : null} /></td>
                        <td className="text-[11.5px] text-muted max-w-[420px]">{x.tip}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>No hay consumo en este periodo.</Empty>}
              {P.items.length > 15 && <div className="text-center py-2 border-t border-line"><button type="button" className="btn h-[26px] text-[12px]" onClick={() => setCmpAll(!cmpAll)}>{cmpAll ? 'Ver solo los 15 que más cambiaron' : `Ver los ${P.items.length} conceptos`}</button></div>}
            </Panel>
          </div>
        );
      })()}

      <div className="grid grid-cols-12 gap-4 mb-6">
        <Panel title="Gasto por servicio" meta="mes en curso vs mes anterior" className="col-span-12 xl:col-span-7" bodyClass="overflow-x-auto">
          {sum?.services.length ? (
            <table className="tbl">
              <thead><tr><th>Servicio</th><th className="num">Este mes</th><th>Participación</th><th className="num">Mes anterior</th><th className="num">Ritmo vs anterior</th></tr></thead>
              <tbody>
                {sum.services.map((s) => {
                  const pace = (sum.closed.reduce((t, d) => t + (d.services[s.key] || 0), 0) / Math.max(1, sum.closed.length)) * sum.dim, d = s.prev ? ((pace - s.prev) / s.prev) * 100 : null;
                  return (
                    <tr key={s.key}>
                      <td><div className="flex items-center gap-2"><i className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colorOf(s.key) }} /><span className="text-ink">{s.name}</span></div><div className="text-[10.5px] text-faint pl-[18px] truncate max-w-[300px]">{s.key}</div></td>
                      <td className="num text-ink"><Two v={s.mtd} /></td>
                      <td className="min-w-[140px]"><div className="h-1.5 rounded-full bg-line/60 overflow-hidden"><i className="block h-full rounded-full" style={{ width: `${(s.mtd / (sum.mtd || 1)) * 100}%`, background: colorOf(s.key) }} /></div><span className="text-[10.5px] text-faint font-mono">{((s.mtd / (sum.mtd || 1)) * 100).toFixed(1)}%</span></td>
                      <td className="num">{s.prev ? <Two v={s.prev} /> : '—'}</td>
                      <td className={`num ${d == null ? 'text-faint' : d > 15 ? 'text-crit' : d > 3 ? 'text-warn' : 'text-ok'}`}>{d == null ? (sum.showingPrev ? '—' : 'nuevo') : `${d > 0 ? '▲' : '▼'} ${pctTxt(d)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>{bill.loading ? 'Cargando…' : 'Sin datos.'}</Empty>}
        </Panel>
        <Panel title="Últimos 6 meses" meta={sum?.forecast != null ? `cierre estimado ${usd0(sum.forecast)}` : ''} className="col-span-12 xl:col-span-5" bodyClass="p-4">
          {sum?.months.length ? <MonthlyBars months={sum.months} forecast={sum.forecast} m={M} curM={sum.curM} /> : <Empty>Sin datos.</Empty>}
          <div className="text-[11px] text-faint mt-2">Barra punteada = pronóstico de cierre del mes en curso{sum?.forecastSource === 'aws' ? ' (modelo de AWS)' : ' (ritmo diario)'}.</div>
        </Panel>
      </div>

      {/* ---------------- Dónde se va el dinero ---------------- */}
      {sum && (() => {
        const usage = (sum.usage || []).map((u) => ({ ...u, ex: explainUsage(u) }));
        const findings = costFindings(sum, budget);
        const saving = usage.reduce((t, u) => t + (u.ex.save ? u.cur * u.ex.save : 0), 0);
        const savingMonth = sum.closed.length ? (saving / sum.closed.length) * sum.dim : saving;
        const bPct = budget ? (sum.forecast / budget) * 100 : null;
        return (<>
          <h2 className="text-[14px] font-semibold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-info shadow-[0_0_8px_#5AB8FF]" />¿Qué está cobrando más y dónde ahorrar?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
            <HoloKpi label="Ahorro posible (estimado)" value={usage.length ? usd(savingMonth) : '—'} sub={usage.length ? cop(savingMonth) : null} tone={savingMonth > 50 ? 'warn' : 'ok'} foot={usage.length ? `al mes · ${Math.round((savingMonth / (sum.forecast || 1)) * 100)}% del gasto proyectado` : 'Se calcula con el detalle por tipo de uso'} />
            <HoloKpi label="Alertas de costo" value={findings.length} tone={findings.some((f) => f.tone === 'crit') ? 'crit' : findings.length ? 'warn' : 'ok'} foot={findings[0]?.title || 'Sin picos ni crecimientos raros'} />
            <div className="panel p-4">
              <div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[.12em] text-muted font-semibold">Presupuesto mensual</div>
                {budgetEdit == null ? <button type="button" className="text-[11.5px] text-info hover:underline" onClick={() => setBudgetEdit(budget ?? '')}>{budget ? 'Cambiar' : 'Definir'}</button> : null}</div>
              {budgetEdit != null ? (
                <form className="flex items-center gap-2 mt-2" onSubmit={async (e) => { e.preventDefault(); const v = budgetEdit === '' ? null : Number(budgetEdit); const r = await saveBudget(v).catch(() => null); if (r) setBudget(r.usd); setBudgetEdit(null); }}>
                  <span className="text-muted text-[12px]">US$</span><input autoFocus type="number" min="0" step="10" value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)} className="inp w-32" aria-label="Presupuesto en dólares" />
                  <button type="submit" className="btn h-[30px]">Guardar</button><button type="button" className="text-[11.5px] text-muted" onClick={() => setBudgetEdit(null)}>Cancelar</button>
                </form>
              ) : budget ? (<>
                <div className="flex items-baseline gap-2 mt-1.5"><span className="font-mono text-[22px] text-ink font-semibold">{usd(budget)}</span>{cop(budget) && <span className="font-mono text-[11.5px] text-muted">{cop(budget)}</span>}<span className={`font-mono text-[12px] ${bPct > 100 ? 'text-crit' : bPct > 90 ? 'text-warn' : 'text-ok'}`}>pronóstico {Math.round(bPct)}%</span></div>
                <div className="relative h-2 rounded-full bg-line/60 mt-2 overflow-hidden">
                  <i className="absolute inset-y-0 left-0 rounded-full bg-info" style={{ width: `${Math.min(100, (sum.mtd / budget) * 100)}%` }} />
                  <i className="absolute inset-y-0 w-[2px] bg-warn" style={{ left: `${Math.min(99.5, bPct)}%` }} title="Pronóstico de cierre" />
                </div>
                <div className="text-[11px] text-faint mt-1.5">Gastado {Math.round((sum.mtd / budget) * 100)}% · la línea ámbar es el pronóstico de cierre</div>
              </>) : <div className="text-[12px] text-muted mt-2">Define un tope mensual (en US$) y el panel te avisa si el pronóstico lo va a superar. Se guarda para todo el equipo.</div>}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4 mb-6">
            <Panel title="Lo que más cobra este mes (por tipo de uso)" meta="clic en una fila para ver qué hacer" className="col-span-12 xl:col-span-8" bodyClass="overflow-x-auto max-h-[560px]">
              {usage.length ? (
                <table className="tbl">
                  <thead><tr><th>#</th><th>Concepto</th><th className="num">Este mes</th><th className="num">Mes anterior</th><th className="num">Ritmo</th><th className="num">Últ. 7 días</th><th className="num">vs 7 días ant.</th><th className="num">Ahorro posible</th><th>Qué hacer</th></tr></thead>
                  <tbody>
                    {usage.slice(0, 25).map((u, i) => {
                      const pace = sum.closed.length ? (u.cur / sum.monthDays.length) * sum.dim : u.cur, d = u.prev ? ((pace - u.prev) / u.prev) * 100 : null, k = `${u.service}|${u.usageType}`, open = openU === k;
                      return [
                        <tr key={k} className="cursor-pointer" onClick={() => setOpenU(open ? null : k)}>
                          <td className="text-faint font-mono text-[11px]">{i + 1}</td>
                          <td><div className="text-ink">{u.ex.label}</div><div className="text-[10.5px] text-faint font-mono truncate max-w-[340px]">{svcName(u.service)} · {u.usageType}</div></td>
                          <td className="num text-ink"><Two v={u.cur} /></td>
                          <td className="num">{u.prev ? <Two v={u.prev} /> : '—'}</td>
                          <td className={`num ${d == null ? 'text-faint' : d > 15 ? 'text-crit' : d > 3 ? 'text-warn' : 'text-ok'}`}>{d == null ? (sum.showingPrev ? '—' : 'nuevo') : Math.abs(d) < 1 ? '= igual' : `${d > 0 ? '▲ +' : '▼ '}${d.toFixed(0)}%`}</td>
                          {(() => { const w = cmpBase?.week.byKey[k]; const dd = w && w.prev ? ((w.cur - w.prev) / w.prev) * 100 : null; return (<>
                            <td className="num">{w ? usd(w.cur) : '—'}</td>
                            <td className={`num ${dd == null ? 'text-faint' : dd > 10 ? 'text-crit' : dd > 3 ? 'text-warn' : dd < -3 ? 'text-ok' : 'text-faint'}`}>{dd == null ? (w?.cur ? 'nuevo' : '—') : Math.abs(dd) < 1 ? '= igual' : `${dd > 0 ? '▲ +' : '▼ '}${dd.toFixed(0)}%`}</td>
                          </>); })()}
                          <td className={`num ${u.ex.save ? 'text-warn' : 'text-faint'}`}>{u.ex.save ? (() => { const v = (u.cur / Math.max(1, sum.monthDays.length)) * sum.dim * u.ex.save; return <>≈ {usd(v)}/mes{cop(v) && <span className="block text-[10.5px] text-faint">{cop(v)}</span>}</>; })() : '—'}</td>
                          <td className="whitespace-nowrap">{u.ex.action ? <span className={`text-[11.5px] ${u.ex.save ? 'text-ink2' : 'text-muted'}`}>{u.ex.action} ›</span> : null}</td>
                        </tr>,
                        open && <tr key={k + '-d'} className="sub-row"><td /><td colSpan={8} className="text-[12px] text-ink2 py-2.5">{u.ex.tip}{u.qty ? <span className="block text-[11px] text-faint font-mono mt-1">Uso este mes: {u.qty.toLocaleString('es-CO')} {u.unit}</span> : null}</td></tr>,
                      ];
                    })}
                  </tbody>
                </table>
              ) : <Empty>{B?.usage === null ? 'No se pudo leer el detalle por tipo de uso.' : 'Pulsa “Actualizar” para cargar el detalle por tipo de uso.'}</Empty>}
            </Panel>
            <Panel title="Alertas de costo" meta={`${findings.length}`} className="col-span-12 xl:col-span-4" bodyClass="p-3 space-y-2 max-h-[560px] overflow-auto">
              {findings.length ? findings.map((f, i) => (
                <div key={i} className={`rounded-lg border px-3 py-2.5 ${f.tone === 'crit' ? 'border-crit/50 bg-crit/10' : f.tone === 'warn' ? 'border-warn/40 bg-warn/[.07]' : 'border-line bg-bg1'}`}>
                  <div className={`text-[12.5px] font-semibold ${f.tone === 'crit' ? 'text-crit' : f.tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{f.tone === 'crit' ? '⚠ ' : f.tone === 'warn' ? '▲ ' : '● '}{f.title}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">{f.detail}{f.amount ? ` (${usd(f.amount)}${cop(f.amount) ? ` · ${cop(f.amount)}` : ''})` : ''}</div>
                </div>
              )) : <div className="text-[12px] text-ok px-1">● Sin picos, crecimientos raros ni servicios nuevos.</div>}
              <div className="text-[11px] text-faint border-t border-line pt-2 mt-1">Recomendado en AWS (gratis): activar <b className="text-ink2">Cost Anomaly Detection</b> con aviso por correo y <b className="text-ink2">Compute Optimizer</b> para sugerencias de tamaño.</div>
            </Panel>
          </div>
        </>);
      })()}

      {/* ---------------- S3 ---------------- */}
      <h2 className="text-[14px] font-semibold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-info shadow-[0_0_8px_#5AB8FF]" />Almacenamiento S3</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <HoloKpi label="Almacenamiento total" value={S ? bytes(totalBytes) : '—'} tone="off" foot={S ? `${(S.buckets || []).length} buckets` : ''} />
        <HoloKpi label="Crecimiento último día" value={growthRows.length ? `${s3Day >= 0 ? '+' : '−'}${bytes(Math.abs(s3Day))}` : '—'} tone={!growthRows.length ? 'off' : s3Spikes.length ? 'crit' : 'ok'}
          foot={growthRows.length ? (s3Spikes.length ? `⚠ Fuera de lo normal: ${s3Spikes.map((x) => x.b.name).join(', ')}` : `Ritmo ${s3Month >= 0 ? '+' : '−'}${bytes(Math.abs(s3Month))} al mes · ${totalObj.toLocaleString('es-CO')} objetos`) : 'Métrica diaria de CloudWatch'} />
        <HoloKpi label="Costo S3 del mes" value={s3Cost != null ? usd(s3Cost) : '—'} sub={s3Cost != null ? cop(s3Cost) : null} tone="off" foot={s3Cost != null && totalBytes ? `≈ ${usd(s3Cost / (totalBytes / 1024 ** 3))} por GB en lo que va del mes` : 'Según Cost Explorer'} />
        <HoloKpi label="Buckets con riesgo" value={S ? risky.length : '—'} tone={!S ? 'off' : risky.some((b) => risk(b).some((r) => r[0] === 'crit')) ? 'crit' : risky.length ? 'warn' : 'ok'}
          foot={S ? (risky.length ? risky.map((b) => b.name).slice(0, 2).join(', ') + (risky.length > 2 ? '…' : '') : 'Bloqueo público y cifrado correctos') : ''} />
      </div>

      {s3Spikes.length > 0 && (
        <div className="mb-4 rounded-lg border border-crit/50 bg-crit/10 px-4 py-3 text-[12.5px]">
          <div className="text-crit font-semibold">⚠ El almacenamiento está creciendo más de lo normal</div>
          {s3Spikes.map(({ b, g }) => <div key={b.name} className="text-ink2 mt-1"><b className="font-mono text-ink">{b.name}</b> creció <b className="text-crit">{bytes(g.last.delta)}</b> el {g.last.date.slice(8)}/{g.last.date.slice(5, 7)} (lo normal es {g.normal > 0 ? bytes(g.normal) : 'casi nada'} al día). Revisa si un proceso o un respaldo está subiendo archivos de más.</div>)}
        </div>
      )}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <section className="panel col-span-12 xl:col-span-4">
          <header className="panel-h"><h2>Espacio por bucket</h2><span className="panel-meta">{S ? bytes(totalBytes) : ''}</span></header>
          <div className="p-3">
            <div className="screen3d dark-zone">
              {topB.length ? (
                <Suspense fallback={<div className="h-[260px]" />}>
                  <Donut3D height={260} fmt={bytes} center={{ value: bytes(totalBytes), caption: 'en S3' }}
                    segments={[...topB.map((b, i) => ({ key: b.name, label: b.name, color: VIZ_DARK[i], value: Math.round(b.sizeBytes || 0) })), ...(restB ? [{ key: '__o', label: 'Otros buckets', color: OTHER, value: Math.round(restB) }] : [])]} />
                </Suspense>
              ) : <div className="h-[260px] grid place-items-center text-xs text-muted">{st3.loading ? 'Consultando S3…' : 'Sin datos'}</div>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3 px-1 text-[11px]">
              {topB.map((b, i) => <span key={b.name} className="flex items-center gap-1.5 text-ink2 max-w-full"><i className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: VIZ_DARK[i] }} /><span className="truncate">{b.name}</span></span>)}
              {restB > 0 && <span className="flex items-center gap-1.5 text-ink2"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: OTHER }} />Otros</span>}
            </div>
          </div>
        </section>
        <Panel title="Buckets" meta={S ? `${buckets.length} de ${(S.buckets || []).length}` : ''} className="col-span-12 xl:col-span-8"
          actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar bucket…" className="inp w-44" aria-label="Buscar bucket" />} bodyClass="overflow-x-auto max-h-[520px]">
          {buckets.length ? (
            <table className="tbl">
              <thead><tr><th>Bucket</th><th className="num">Tamaño</th><th className="num">Objetos</th><th>30 días</th><th className="num">Último día</th><th className="num">Ritmo al mes</th><th>Clases</th><th>Seguridad</th></tr></thead>
              <tbody>
                {buckets.map((b) => {
                  const gr = s3Growth(b), rk = risk(b), sg = (v) => `${v >= 0 ? '+' : '−'}${bytes(Math.abs(v))}`;
                  return (
                    <tr key={b.name}>
                      <td><div className="font-mono text-[12px] text-ink"><EditName k={`s3:${b.name}`} orig={b.name} /></div><div className="text-[10.5px] text-faint font-mono">{b.region}{b.created ? ` · desde ${b.created.slice(0, 7)}` : ''}</div></td>
                      <td className="num text-ink">{bytes(b.sizeBytes)}</td>
                      <td className="num">{b.objects != null ? b.objects.toLocaleString('es-CO') : '—'}</td>
                      <td><Sparkline values={(b.history || []).map((x) => x[1])} color="#1fa9c0" /></td>
                      <td className={`num ${!gr ? 'text-faint' : gr.spike ? 'text-crit font-semibold' : 'text-ink2'}`} title={gr ? `Normal: ${bytes(Math.max(0, gr.normal))} al día` : ''}>{gr ? `${gr.spike ? '⚠ ' : ''}${sg(gr.last.delta)}` : '—'}</td>
                      <td className="num text-ink2" title={growth(b) != null ? `${pctTxt(growth(b))} en 30 días` : ''}>{gr ? sg(gr.perMonth) : '—'}</td>
                      <td><div className="flex flex-wrap gap-1 max-w-[220px]">{Object.entries(b.classes || {}).filter(([, v]) => v > 0).map(([k, v]) => <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-line text-ink2" title={bytes(v)}>{STORAGE_CLASS[k] || k}</span>)}</div></td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {rk.map(([t, l]) => <Badge key={l} tone={t}>{t === 'crit' ? '⚠ ' : '▲ '}{l}</Badge>)}
                          {!rk.length && <Badge tone="ok">✓ Privado y cifrado</Badge>}
                          <Badge tone={b.versioning === 'Enabled' ? 'info' : 'off'}>{b.versioning === 'Enabled' ? 'Versionado' : 'Sin versionado'}</Badge>
                          {b.lifecycle > 0 && <Badge tone="info">Ciclo de vida ({b.lifecycle})</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>{st3.loading ? 'Consultando S3…' : S ? 'Ningún bucket coincide.' : 'Sin datos de S3.'}</Empty>}
        </Panel>
      </div>
      <p className="text-[11.5px] text-faint">El tamaño y los objetos vienen de las métricas diarias de S3 en CloudWatch (se actualizan una vez al día). El panel no puede leer el contenido de los archivos.</p>
    </>
  );
}
