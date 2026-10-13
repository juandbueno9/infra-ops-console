import { useState } from 'react';
import { KpiCard } from '../components/charts.jsx';
import { AlertsTable, PageHead } from '../components/tables.jsx';
import { Pulse } from '../components/ui.jsx';
import { ISearch } from '../components/icons.jsx';
import { RuleAlerts } from '../components/RuleAlerts.jsx';

export function Alerts({ model }) {
  const [sev, setSev] = useState('all');
  const [q, setQ] = useState('');
  const { alerts, crit, warn } = model;
  const muted = alerts.filter((x) => x.r.muted).length;
  const hostsAffected = new Set(alerts.filter((x) => !x.r.muted).map((x) => x.r.s.inst)).size;
  const rows = alerts.filter((x) =>
    (sev === 'all' || (sev === 'mute' ? x.r.muted : !x.r.muted && x.k === sev)) &&
    (!q || `${x.r.s.inst} ${x.t}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <PageHead title="Alertas" sub="Condiciones detectadas en toda la flota, ordenadas por severidad" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Críticas" lead={<Pulse tone={crit ? 'crit' : 'ok'} />} value={crit} foot="Requieren acción inmediata" />
        <KpiCard label="Atención" lead={<Pulse tone={warn ? 'warn' : 'ok'} />} value={warn} foot="Revisar pronto" />
        <KpiCard label="Hosts afectados" value={hostsAffected} unit={` / ${model.all.length}`} foot="Con al menos una alerta activa" />
        <KpiCard label="Silenciadas" lead={<Pulse tone="off" />} value={muted} foot="No cuentan en los totales" />
      </div>
      <RuleAlerts />
      <section className="panel">
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line flex-wrap">
          <div className="seg" role="group" aria-label="Severidad">
            {[['all', 'Todas', alerts.length], ['bad', 'Críticas', crit], ['warn', 'Atención', warn], ['mute', 'Silenciadas', muted]].map(([k, l, c]) => (
              <button key={k} type="button" aria-pressed={sev === k} onClick={() => setSev(k)}>{l} <span className="font-mono text-[11px] text-faint">{c}</span></button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px]">
            <ISearch size={14} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar host o texto…" aria-label="Buscar alertas" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-56" />
          </label>
          <span className="ml-auto text-xs text-faint font-mono">{rows.length} resultado(s)</span>
        </div>
        <div className="overflow-auto"><AlertsTable alerts={rows} showHostState /></div>
      </section>
    </>
  );
}
