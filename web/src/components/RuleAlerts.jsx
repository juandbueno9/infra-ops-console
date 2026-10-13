// Alertas de las reglas de Prometheus (las mismas que Alertmanager enviará cuando se configure el canal).
import { useState } from 'react';
import { DEMO } from '../config.js';
import { promAlerts } from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Badge, Empty, Panel } from './ui.jsx';

const SEV = { critica: 'crit', advertencia: 'warn', info: 'info' };
const since = (iso) => { const m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.floor(m / 1440)} d`; };
const demo = () => Promise.resolve([
  { labels: { alertname: 'SitioLento', severidad: 'advertencia', categoria: 'sitios', instance: 'https://empresa.com/' }, annotations: { resumen: 'https://empresa.com/ tarda 3.1 s en responder' }, state: 'firing', activeAt: new Date(Date.now() - 3 * 3600e3).toISOString() },
  { labels: { alertname: 'CertificadoServidorVence', severidad: 'advertencia', categoria: 'sitios' }, annotations: { resumen: 'El certificado de vault.empresa.com en app-server vence en 23 días (certbot-auto)' }, state: 'firing', activeAt: new Date(Date.now() - 20 * 3600e3).toISOString() },
  { labels: { alertname: 'PuertoCriticoExpuesto', severidad: 'critica', categoria: 'seguridad' }, annotations: { resumen: 'Puerto expuesto a Internet: empresa.com:21 (empresa.com)' }, state: 'firing', activeAt: new Date(Date.now() - 22 * 3600e3).toISOString() },
  { labels: { alertname: 'DiscoSeLlenaPronto', severidad: 'advertencia', categoria: 'servidores' }, annotations: { resumen: 'Al ritmo actual, el disco / de historic-db2 se llena en menos de 7 días' }, state: 'pending', activeAt: new Date(Date.now() - 1200e3).toISOString() },
]);

const PAGE = 15;
const detail = (a) => a.annotations?.resumen || a.annotations?.summary || a.annotations?.description || '';
const target = (a) => a.labels.instance || a.labels.target || a.labels.nombre || a.labels.job || '';
const shortT = (t) => String(t).replace(/^https?:\/\//, '').replace(/\/$/, '');
const rank = (a) => (a.state === 'pending' ? 2 : a.labels.severidad === 'critica' ? 0 : 1);

export function RuleAlerts() {
  const { data, error, loading } = usePolling(DEMO ? demo : promAlerts, 30, []);
  const [open, setOpen] = useState({});
  const [page, setPage] = useState(0);
  const [lim, setLim] = useState({});
  const rows = (data || []).filter((a) => a.labels.alertname !== 'Watchdog');
  const watchdog = (data || []).some((a) => a.labels.alertname === 'Watchdog');
  // Agrupar por regla: "SitioWebCaido × 72" en una fila desplegable en vez de 72 filas iguales
  const groups = Object.values(rows.reduce((m, a) => { (m[a.labels.alertname] ||= { name: a.labels.alertname, items: [] }).items.push(a); return m; }, {}))
    .map((g) => ({ ...g, items: g.items.sort((x, y) => rank(x) - rank(y) || Date.parse(x.activeAt) - Date.parse(y.activeAt)), top: g.items.reduce((b, a) => (rank(a) < rank(b) ? a : b)) }))
    .sort((a, b) => rank(a.top) - rank(b.top) || b.items.length - a.items.length);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = groups.slice(pg * PAGE, pg * PAGE + PAGE);
  const badge = (a) => (a.state === 'firing' ? <Badge tone={SEV[a.labels.severidad] || 'warn'} dot={SEV[a.labels.severidad] || 'warn'}>{a.labels.severidad || 'disparada'}</Badge> : <Badge tone="off" title="La condición se cumple pero aún no pasa el tiempo mínimo">en espera</Badge>);
  return (
    <Panel title="Reglas de alerta (Prometheus)" className="mb-4" bodyClass="overflow-x-auto"
      meta={error ? 'reglas no instaladas' : `${rows.filter((r) => r.state === 'firing').length} disparada(s) en ${groups.length} regla(s) · ${rows.filter((r) => r.state === 'pending').length} en espera · ${watchdog ? 'vigilante activo' : 'sin vigilante'}`}>
      {error ? <Empty>Las reglas se activan al instalar el stack (deploy/stack/instalar-stack.sh).</Empty> : (
        <table className="tbl">
          <thead><tr><th>Estado</th><th>Regla</th><th>Afectados</th><th>Detalle</th><th>Categoría</th><th className="num">Desde</th></tr></thead>
          <tbody>
            {shown.length ? shown.map((g) => {
              const many = g.items.length > 1, op = !!open[g.name];
              return [
                <tr key={g.name} className={many ? 'cursor-pointer' : ''} onClick={() => many && setOpen((o) => ({ ...o, [g.name]: !o[g.name] }))}>
                  <td>{badge(g.top)}</td>
                  <td className="font-mono text-ink text-xs whitespace-nowrap">{many && <span className={`inline-block mr-1.5 text-faint transition-transform ${op ? 'rotate-90' : ''}`}>▶</span>}{g.name}{many && <span className="ml-1.5 text-faint">× {g.items.length}</span>}</td>
                  <td className="font-mono text-[11.5px] text-ink2 max-w-[340px] truncate" title={g.items.map((a) => shortT(target(a))).join(', ')}>{many ? `${g.items.slice(0, 3).map((a) => shortT(target(a))).join(', ')}${g.items.length > 3 ? ` y ${g.items.length - 3} más` : ''}` : shortT(target(g.top)) || '—'}</td>
                  <td className="text-ink2">{many ? <span className="text-faint">{op ? 'Clic para cerrar' : 'Clic para ver cada uno'}</span> : detail(g.top) || '—'}</td>
                  <td className="text-xs text-muted">{g.top.labels.categoria || g.top.labels.job || ''}</td>
                  <td className="num whitespace-nowrap">{since(g.items.reduce((m, a) => (Date.parse(a.activeAt) < Date.parse(m) ? a.activeAt : m), g.items[0].activeAt))}</td>
                </tr>,
                ...(many && op ? g.items.slice(0, lim[g.name] || 20).map((a, i) => (
                  <tr key={`${g.name}-${i}`} className="bg-bg1/50">
                    <td className="!pl-8">{badge(a)}</td>
                    <td className="text-faint text-xs">{g.name}</td>
                    <td className="font-mono text-[11.5px] text-ink">{shortT(target(a)) || '—'}</td>
                    <td className="text-ink2 text-[12px]">{detail(a) || Object.entries(a.labels).filter(([k]) => !['alertname', 'severidad', 'categoria', 'instance'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' · ')}</td>
                    <td className="text-xs text-muted">{a.labels.job || ''}</td>
                    <td className="num whitespace-nowrap">{since(a.activeAt)}</td>
                  </tr>)) : []),
                ...(many && op && g.items.length > (lim[g.name] || 20) ? [<tr key={`${g.name}-more`}><td colSpan={6} className="text-center"><button type="button" className="btn h-[26px] text-[12px]" onClick={() => setLim((l) => ({ ...l, [g.name]: (l[g.name] || 20) + 20 }))}>Mostrar 20 más ({g.items.length - (lim[g.name] || 20)} restantes)</button></td></tr>] : []),
              ];
            }) : <tr><td colSpan={6}><Empty>{loading ? 'Cargando…' : 'Ninguna regla disparada.'}</Empty></td></tr>}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-line text-[12px]">
          <span className="text-faint">Página {pg + 1} de {pages}</span>
          <button type="button" className="btn h-[26px]" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Anterior</button>
          <button type="button" className="btn h-[26px]" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Siguiente ›</button>
        </div>
      )}
      <div className="px-4 py-2 text-[11px] text-faint border-t border-line">Mientras no se configure el canal (correo, Teams o Telegram) las alertas se ven aquí pero no se envían.</div>
    </Panel>
  );
}
