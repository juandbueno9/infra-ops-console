// Reporte mensual de SLA: listo para imprimir o guardar como PDF (Ctrl/⌘ + P).
import { useState } from 'react';
import { loadReport, monthOptions } from '../lib/reports.js';
import { downloadCsv } from '../lib/sshEvents.js';
import { usePolling } from '../hooks/usePolling.js';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel } from '../components/ui.jsx';

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v >= 0.99995 ? 2 : 3)}%`);
const mins = (m) => (m == null ? '—' : m < 1 ? '< 1 min' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

function SlaTable({ title, rows, target, extra = [] }) {
  const ok = rows.filter((r) => r.up >= target).length;
  return (
    <Panel title={title} meta={rows.length ? `${ok} de ${rows.length} cumplen ${pct(target)}` : ''} className="mb-4 break-inside-avoid" bodyClass="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Nombre</th><th className="num">Disponibilidad</th><th className="num">Tiempo caído</th>{extra.map(([l]) => <th key={l} className="num">{l}</th>)}<th>SLA</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => (
            <tr key={r.name}>
              <td className="font-mono text-ink">{r.name}{r.coverage < 0.95 && <span className="ml-2 text-[10.5px] text-warn" title="El monitoreo no cubrió todo el periodo">historial {Math.round(r.coverage * 100)}%</span>}</td>
              <td className={`num ${r.up >= target ? 'text-ok' : r.up >= 0.99 ? 'text-warn' : 'text-crit'}`}>{pct(r.up)}</td>
              <td className="num">{mins(r.downMin)}</td>
              {extra.map(([l, f]) => <td key={l} className="num">{f(r)}</td>)}
              <td><Badge tone={r.up >= target ? 'ok' : 'crit'}>{r.up >= target ? 'Cumple' : 'No cumple'}</Badge></td>
            </tr>
          )) : <tr><td colSpan={4 + extra.length}><Empty>Sin datos para este periodo.</Empty></td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

export function Reports() {
  const months = monthOptions();
  const [month, setMonth] = useState(months[0].key);
  const [target, setTarget] = useState(0.999);
  const { data: d, loading, error } = usePolling(() => loadReport(month), 0, [month]);
  const label = months.find((m) => m.key === month)?.label;
  const avg = (rows) => (rows?.length ? rows.reduce((t, r) => t + r.up, 0) / rows.length : null);

  const exportCsv = () => {
    const rows = [...d.sites.map((r) => ['sitio', r.name, r.up, Math.round(r.downMin), r.drops ?? '']), ...d.servers.map((r) => ['servidor', r.name, r.up, Math.round(r.downMin), '']), ...d.agencies.map((r) => ['agencia', r.name, r.up, Math.round(r.downMin), ''])];
    downloadCsv(`sla-empresa-${month}.csv`, ['tipo', 'nombre', 'disponibilidad', 'minutos_caido', 'caidas'], rows);
  };

  return (
    <div className="report">
      <div className="no-print">
        <PageHead title="Reportes" sub="Disponibilidad mensual (SLA) de sitios, servidores y agencias">
          <select className="inp font-sans" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes">
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select className="inp font-sans" value={target} onChange={(e) => setTarget(+e.target.value)} aria-label="Meta de SLA">
            {[0.99, 0.995, 0.999, 0.9995, 0.9999].map((t) => <option key={t} value={t}>Meta {pct(t)}</option>)}
          </select>
          <button type="button" onClick={exportCsv} disabled={!d} className="h-[30px] px-3 rounded-lg border border-line bg-bg1 text-ink2 text-xs font-medium hover:bg-surface disabled:opacity-40">CSV</button>
          <button type="button" onClick={() => window.print()} disabled={!d} className="h-[30px] px-3 rounded-lg bg-info text-white text-xs font-semibold disabled:opacity-40">Imprimir / PDF</button>
        </PageHead>
      </div>

      <div className="print-only mb-4">
        <h1 className="text-xl font-semibold m-0">Infra Ops · Reporte de disponibilidad</h1>
        <div className="text-sm">{label}{d?.partial ? ' (parcial, hasta hoy)' : ''} · Meta de SLA {pct(target)} · generado {new Date().toLocaleString('es-CO', { hour12: false })}</div>
      </div>

      {error ? <Panel bodyClass="p-4 text-crit">{error.message}</Panel> : !d ? <Empty>{loading ? 'Calculando el reporte…' : 'Sin datos'}</Empty> : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
            {[['Sitios', avg(d.sites), d.sites.length], ['Servidores', avg(d.servers), d.servers.length], ['Agencias', avg(d.agencies), d.agencies.length]].map(([l, v, c]) => (
              <section key={l} className="panel p-4 break-inside-avoid">
                <div className="text-xs text-muted">{l} · promedio</div>
                <div className={`font-mono text-2xl mt-1 ${v == null ? 'text-faint' : v >= target ? 'text-ok' : 'text-crit'}`}>{pct(v)}</div>
                <div className="text-[11px] text-faint mt-1">{c} monitoreado(s)</div>
              </section>
            ))}
            <section className="panel p-4 break-inside-avoid">
              <div className="text-xs text-muted">Incidentes del mes</div>
              <div className="font-mono text-2xl mt-1 text-ink">{d.incidents.length}</div>
              <div className="text-[11px] text-faint mt-1">{d.incidents.filter((i) => i.status === 'resuelto').length} resuelto(s)</div>
            </section>
          </div>
          {d.partial && <p className="text-xs text-muted mb-3 no-print">Mes en curso: los valores se calculan hasta este momento.</p>}
          <SlaTable title="Sitios web" rows={d.sites} target={target} extra={[['Caídas', (r) => r.drops ?? '—'], ['Respuesta media', (r) => (r.lat != null ? `${Math.round(r.lat * 1000)} ms` : '—')]]} />
          <SlaTable title="Servidores" rows={d.servers} target={target} extra={[['CPU media', (r) => (r.cpu != null ? `${r.cpu.toFixed(0)}%` : '—')], ['Disco máx.', (r) => (r.disk != null ? `${r.disk.toFixed(0)}%` : '—')]]} />
          <SlaTable title="Agencias (SD-WAN)" rows={d.agencies} target={target} />
          <Panel title="Incidentes" className="mb-4 break-inside-avoid" bodyClass="overflow-x-auto">
            <table className="tbl"><thead><tr><th>Inicio</th><th>Incidente</th><th>Servicio</th><th>Severidad</th><th>Estado</th><th className="num">Duración</th></tr></thead><tbody>
              {d.incidents.length ? d.incidents.map((i) => (
                <tr key={i.id}><td className="font-mono text-xs whitespace-nowrap">{new Date(i.startedAt).toLocaleString('es-CO', { hour12: false })}</td><td className="text-ink">{i.title}</td><td className="font-mono text-xs">{i.service || '—'}</td>
                  <td><Badge tone={i.severity === 'critica' ? 'crit' : i.severity === 'alta' ? 'warn' : 'info'}>{i.severity}</Badge></td><td>{i.status}</td>
                  <td className="num">{i.resolvedAt ? mins((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000) : 'abierto'}</td></tr>
              )) : <tr><td colSpan={6}><Empty>Sin incidentes registrados en el mes.</Empty></td></tr>}
            </tbody></table>
          </Panel>
          <p className="text-[11px] text-faint">Disponibilidad = porcentaje de sondas exitosas (sitios cada 15 s, servidores cada 15 s, agencias cada 30 s). «Historial» indica qué parte del periodo cubrió el monitoreo.</p>
        </>
      )}
    </div>
  );
}
