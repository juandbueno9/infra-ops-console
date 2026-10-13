// Detalle de un sitio web (estilo UptimeRobot)
import { useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { SITE_RANGES, causeOf } from '../lib/sites.js';
import { dur, hhmm } from '../lib/format.js';
import { LineChart } from '../components/charts.jsx';
import { sslTone } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { UptimeBars, pctUp, upTone } from '../components/UptimeBars.jsx';
import { IBack, IOk, IOpen, IWarn } from '../components/icons.jsx';

const PHASES = [['resolve', 'DNS', '#22D3EE'], ['connect', 'Conexión TCP', '#1FA9C0'], ['tls', 'TLS', '#A3E635'], ['processing', 'Servidor', '#F1F5F9'], ['transfer', 'Transferencia', '#64748B']];
const Card = ({ children, className = '' }) => <div className={`bg-surface border border-line rounded-[10px] p-4 min-w-0 ${className}`}>{children}</div>;
const Lbl = ({ children }) => <div className="text-xs text-muted font-medium mb-1.5">{children}</div>;
const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

export function Site({ d, loading, range, onRange }) {
  const [showAll, setShowAll] = useState(false);
  if (!d) return <Empty>{loading ? 'Cargando sitio…' : 'Sin datos para este sitio.'}</Empty>;
  const now = Date.now() / 1000;
  const sslDays = d.ssl != null ? Math.floor(d.ssl / 86400) : null;
  const sslDate = d.ssl != null ? new Date((now + d.ssl) * 1000) : null;
  const phaseTotal = PHASES.reduce((t, [k]) => t + (d.phases[k] || 0), 0);
  const incidents = showAll ? d.incidents : d.incidents.slice(0, 8);

  return (
    <>
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <a href="#/sitios" className="inline-flex items-center gap-1.5 text-muted no-underline font-medium px-2.5 py-1.5 rounded-md border border-line hover:text-ink hover:bg-surface2"><IBack size={14} />Sitios</a>
        <span className={`w-10 h-10 rounded-full grid place-items-center ${d.ok ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit'}`}>
          <span className={`w-0 h-0 border-x-[7px] border-x-transparent ${d.ok ? 'border-b-[10px] border-b-ok' : 'border-t-[10px] border-t-crit'}`} />
        </span>
        <div className="min-w-0">
          <h1 className="m-0 flex items-center gap-2 text-xl font-semibold text-ink font-mono tracking-tight"><EditName k={`site:${d.target}`} orig={d.name} />
            <a href={d.target} target="_blank" rel="noreferrer noopener" className="text-faint hover:text-ink" aria-label="Abrir sitio"><IOpen size={15} /></a></h1>
          <div className="text-[12.5px] text-muted">Monitor HTTP/S de <span className="font-mono text-ok">{d.target}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Columna principal */}
        <div className="col-span-12 xl:col-span-9 space-y-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <Lbl>Estado actual</Lbl>
              <div className={`text-2xl font-semibold ${d.ok ? 'text-ok' : 'text-crit'}`}>{d.ok ? 'Operativo' : 'Caído'}</div>
              <div className="text-[12.5px] text-ink2 mt-1">
                {d.ok ? (d.upSince ? `Arriba desde hace ${dur(now - d.upSince)}${d.historyFrom && d.upSince <= d.historyFrom + 300 ? '+' : ''}` : 'Arriba')
                  : `Caído desde hace ${dur(now - d.downSince)}${d.code ? ` · HTTP ${d.code}` : ' · sin respuesta'}`}
              </div>
            </Card>
            <Card>
              <Lbl>Última verificación</Lbl>
              <div className="text-2xl font-semibold text-ink">hace {Math.round(d.age ?? 0)} s</div>
              <div className="text-[12.5px] text-ink2 mt-1">Verificado cada {d.interval} s desde el servidor</div>
            </Card>
            <Card>
              <div className="flex justify-between"><Lbl>Últimas 24 horas</Lbl><span className={`text-xs font-mono ${upTone(d.u24)}`}>{pctUp(d.u24, 2)}</span></div>
              <UptimeBars values={d.bars} size="lg" />
              <div className="text-[12.5px] text-ink2 mt-2">{d.inc24} incidente(s), {dur(d.down24)} caído</div>
            </Card>
          </div>

          <Card className="!p-0">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-line">
              {[['Últimos 7 días', d.u7], ['Últimos 30 días', d.u30], ['Últimas 24 horas', d.u24]].map(([l, v]) => (
                <div key={l} className="p-4"><Lbl>{l}</Lbl><div className={`text-xl font-semibold font-mono ${upTone(v)}`}>{pctUp(v)}</div>
                  <div className="text-xs text-faint mt-0.5">{v == null ? 'Sin historial suficiente' : 'disponibilidad'}</div></div>
              ))}
              <div className="p-4"><Lbl>Incidentes (7 días)</Lbl><div className="text-xl font-semibold font-mono text-ink">{d.incidents.filter((i) => (i.end ?? now) > now - 7 * 86400).length}</div>
                <div className="text-xs text-faint mt-0.5">caídas detectadas</div></div>
            </div>
          </Card>

          <Panel title="Tiempo de respuesta" bodyClass="px-4 pb-4 pt-2" actions={
            <div className="seg" role="group" aria-label="Rango">
              {Object.entries(SITE_RANGES).map(([k, v]) => <button key={k} type="button" aria-pressed={range === k} onClick={() => onRange(k)}>{v.label}</button>)}
            </div>}>
            <LineChart series={d.latency} color="#10B981" label="Respuesta" max="auto" fmt={(v) => `${Math.round(v)}ms`} height={200} />
            <div className="grid grid-cols-3 divide-x divide-line border-t border-line mt-3 pt-3">
              {[['Promedio', d.latAvg, '≈'], ['Mínimo', d.latMin, '↓'], ['Máximo', d.latMax, '↑']].map(([l, v, ic]) => (
                <div key={l} className="px-3 first:pl-0"><div className="font-mono text-lg font-semibold text-ink"><span className="text-faint mr-1.5 text-sm">{ic}</span>{ms(v)}</div><div className="text-xs text-muted">{l}</div></div>
              ))}
            </div>
          </Panel>

          <Panel title="Historial de incidentes" meta={`${d.incidents.length} registrado(s)`} bodyClass="overflow-auto">
            <table className="tbl">
              <thead><tr><th>Estado</th><th>Causa</th><th>Inicio</th><th className="num">Duración</th></tr></thead>
              <tbody>
                {incidents.length ? incidents.map((x, i) => {
                  const [codeTxt, why] = causeOf(x.code);
                  return (
                    <tr key={i}>
                      <td>{x.end ? <span className="inline-flex items-center gap-2 text-ok font-semibold"><IOk size={16} />Resuelto</span>
                        : <span className="inline-flex items-center gap-2 text-crit font-semibold"><IWarn size={16} />En curso</span>}</td>
                      <td><span className="inline-flex items-center gap-2"><span className="font-mono text-[10.5px] font-bold text-white bg-crit rounded px-1.5 py-0.5">{codeTxt}</span>{why}</span></td>
                      <td className="font-mono text-xs">{hhmm(x.start)}</td>
                      <td className="num">{dur((x.end ?? now) - x.start)}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={4}><Empty><IOk size={16} className="text-ok inline -mt-0.5 mr-1" />Sin incidentes en los últimos 7 días</Empty></td></tr>}
              </tbody>
            </table>
            {d.incidents.length > 8 && <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full py-2.5 text-xs text-info border-t border-line hover:bg-surface2">{showAll ? 'Ver menos' : `Ver los ${d.incidents.length} incidentes`}</button>}
          </Panel>
        </div>

        {/* Columna lateral */}
        <div className="col-span-12 xl:col-span-3 space-y-4">
          <Card>
            <div className="text-[13px] font-semibold text-ink mb-3">Certificado SSL</div>
            <Lbl>Válido hasta</Lbl>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-semibold text-ink">{sslDate ? sslDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
              <Badge tone={sslTone(sslDays)}>{sslDays == null ? 'sin datos' : `${sslDays} días`}</Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3"><span className="text-muted">Emisor</span><span className="font-mono text-ink2 text-right truncate" title={d.issuer}>{(d.issuer || '—').replace(/^.*CN=/, '')}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted">Dominio</span><span className="font-mono text-ink2 text-right truncate" title={d.subject}>{(d.subject || d.name).replace(/^.*CN=/, '')}</span></div>
            </div>
            {sslDays != null && sslDays <= 21 && <div className="mt-3 text-xs bg-warn/[.08] border border-warn/25 rounded-md p-2 text-ink2">Renueva pronto: <span className="font-mono">sudo certbot renew</span></div>}
          </Card>

          <Card>
            <div className="text-[13px] font-semibold text-ink mb-3">Fases de la última respuesta</div>
            {phaseTotal > 0 ? (
              <>
                <div className="flex h-2.5 rounded overflow-hidden mb-3">{PHASES.map(([k, , c]) => d.phases[k] ? <i key={k} style={{ width: `${(d.phases[k] / phaseTotal) * 100}%`, background: c }} /> : null)}</div>
                <div className="space-y-1.5 text-xs">
                  {PHASES.map(([k, l, c]) => (
                    <div key={k} className="flex items-center gap-2"><i className="w-2 h-2 rounded-sm" style={{ background: c }} /><span className="text-muted flex-1">{l}</span><span className="font-mono text-ink2">{ms((d.phases[k] || 0) * 1000)}</span></div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-line pt-1.5 mt-1.5"><span className="flex-1 text-ink2 font-medium">Total</span><span className="font-mono text-ink">{ms(phaseTotal * 1000)}</span></div>
                </div>
              </>
            ) : <div className="text-xs text-faint">Sin datos de fases</div>}
          </Card>

          <Card>
            <div className="text-[13px] font-semibold text-ink mb-2">Origen de la verificación</div>
            <div className="flex items-center gap-2 text-[12.5px] text-ink2"><Pulse tone="ok" />Servidor app-server · AWS us-east-1</div>
            <p className="text-xs text-faint mt-2 mb-0">Si este servidor se cae, las sondas también. Complementa con un monitor externo (UptimeRobot).</p>
          </Card>
        </div>
      </div>
    </>
  );
}
