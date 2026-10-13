import { PORT_NAMES } from '../config.js';
import { classify, ipKind } from '../lib/analyze.js';
import { KpiCard } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { pulseTone } from '../hooks/useFleetRows.js';
import { Vulns } from '../components/Vulns.jsx';
import { ScansPanel } from '../components/Scans.jsx';
import { UpdatesPanel } from '../components/Updates.jsx';
import { ClonesPanel } from '../components/Clones.jsx';

const CLS = { critical: ['Crítico', 'crit'], review: ['Revisar', 'warn'], allowed: ['Permitido', 'ok'], office: ['Solo oficina', 'warn'], sg: ['Cerrado en SG', 'sg'] };
const RISK = { critical: 0, review: 1, allowed: 2, office: 3, sg: 4 };
const HostLink = ({ r }) => (
  <a href={`#/s/${encodeURIComponent(r.s.inst)}`} className="inline-flex items-center gap-2 font-mono text-ink no-underline hover:underline whitespace-nowrap"><Pulse tone={pulseTone(r)} />{r.s.host}</a>
);

export function Security({ model }) {
  const rows = model.all.filter((r) => r.s.up === 1);
  const ports = rows.flatMap((r) => (r.s.ports || []).map((p) => ({ r, p, k: classify(r.s.inst, p) })))
    .sort((x, y) => RISK[x.k] - RISK[y.k] || x.r.s.inst.localeCompare(y.r.s.inst) || x.p.port - y.p.port);
  const crit = ports.filter((x) => x.k === 'critical').length, review = ports.filter((x) => x.k === 'review').length;
  const sshBad = rows.filter((r) => r.a.sshBad).length;
  const unknownSess = rows.reduce((t, r) => t + (r.s.sessions || []).filter((x) => ipKind(x.from)[1] === 'crit').length, 0);
  const failed = rows.reduce((t, r) => t + (r.s.ssh || 0), 0);
  const patches = rows.reduce((t, r) => t + (r.s.sec || 0), 0);

  return (
    <>
      <PageHead title="Seguridad" sub="Exposición de red, acceso SSH y parches en toda la flota" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
        <KpiCard label="Puertos críticos expuestos" lead={<Pulse tone={crit ? 'crit' : 'ok'} />} value={crit} foot="Bases de datos u otros en 0.0.0.0" />
        <KpiCard label="Puertos sin clasificar" lead={<Pulse tone={review ? 'warn' : 'ok'} />} value={review} foot="Definir en web/src/config.js" />
        <KpiCard label="SSH inseguro" lead={<Pulse tone={sshBad ? 'crit' : 'ok'} />} value={sshBad} unit={` / ${rows.length}`} foot="Contraseña o root habilitados" />
        <KpiCard label="Sesiones desde IP desconocida" lead={<Pulse tone={unknownSess ? 'crit' : 'ok'} />} value={unknownSess} foot="Activas en este momento" />
        <KpiCard label="Intentos SSH fallidos" value={failed} foot="Últimas 24 h, toda la flota" />
        <KpiCard label="Parches de seguridad" lead={<Pulse tone={patches ? 'warn' : 'ok'} />} value={patches} foot="Pendientes de aplicar" />
      </div>

      <ScansPanel />
      <ClonesPanel />
      <UpdatesPanel model={model} />

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Exposición de puertos públicos" meta={`${ports.length} puertos en 0.0.0.0`} className="col-span-12 xl:col-span-7" bodyClass="overflow-auto max-h-[560px]">
          <table className="tbl">
            <thead><tr><th>Host</th><th className="num">Puerto</th><th>Aplicación</th><th>Clasificación</th></tr></thead>
            <tbody>
              {ports.length ? ports.map(({ r, p, k }) => (
                <tr key={r.s.inst + p.port}>
                  <td><HostLink r={r} /></td>
                  <td className="num text-ink">{p.port}</td>
                  <td><span className="font-mono text-ink">{p.app || '—'}</span>{PORT_NAMES[p.port] && <span className="text-faint text-[11.5px]"> · {PORT_NAMES[p.port]}</span>}</td>
                  <td><Badge tone={CLS[k][1]}>{CLS[k][0]}</Badge></td>
                </tr>
              )) : <tr><td colSpan={4}><Empty>Sin datos de puertos (requiere el agente)</Empty></td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="Acceso SSH por host" className="col-span-12 xl:col-span-5" bodyClass="overflow-auto max-h-[560px]">
          <table className="tbl">
            <thead><tr><th>Host</th><th>Config.</th><th className="num">Fallidos 24 h</th><th className="num">Sesiones</th><th className="num">IP desc.</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const unk = [...(r.s.sessions || []), ...(r.s.logins || [])].filter((x) => ipKind(x.from)[1] === 'crit').length;
                const f = r.s.ssh ?? 0;
                return (
                  <tr key={r.s.inst}>
                    <td><HostLink r={r} /></td>
                    <td>{r.s.sshcfg ? <Badge tone={r.a.sshBad ? 'crit' : 'ok'}>{r.a.sshBad ? 'Insegura' : 'Segura'}</Badge> : <Badge tone="off">Sin datos</Badge>}</td>
                    <td className={`num ${f >= 50 ? 'text-crit' : f >= 10 ? 'text-warn' : ''}`}>{f}</td>
                    <td className="num">{(r.s.sessions || []).length}</td>
                    <td className={`num ${unk ? 'text-crit' : ''}`}>{unk}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Vulns className="col-span-12" />

        <Panel title="Parches y reinicios" className="col-span-12" bodyClass="overflow-auto">
          <table className="tbl">
            <thead><tr><th>Host</th><th>Tipo</th><th className="num">Parches de seguridad</th><th>Reinicio</th><th>Recomendación</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => (b.s.sec || 0) - (a.s.sec || 0)).map((r) => (
                <tr key={r.s.inst}>
                  <td><HostLink r={r} /></td>
                  <td className="font-mono text-muted text-xs">{r.s.itype || '—'}</td>
                  <td className={`num ${r.s.sec ? 'text-warn' : ''}`}>{r.s.sec ?? '—'}</td>
                  <td>{r.s.reboot === 1 ? <Badge tone="warn">Pendiente</Badge> : <Badge tone="ok">No requerido</Badge>}</td>
                  <td className="text-muted text-xs">{r.s.sec ? <span className="font-mono">sudo apt upgrade</span> : r.s.reboot === 1 ? 'Programar reinicio en ventana de mantenimiento' : 'Al día'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
