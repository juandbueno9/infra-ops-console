// Tablas reutilizables entre páginas
import { SSL_BAD_DAYS, SSL_WARN_DAYS } from '../config.js';
import { EditName } from './EditName.jsx';
import { Badge, Empty } from './ui.jsx';
import { IOk } from './icons.jsx';

export function AlertsTable({ alerts, showHostState = false }) {
  return (
    <table className="tbl">
      <thead><tr><th className="w-[110px]">Severidad</th><th>Host</th><th>Descripción</th>{showHostState && <th>Estado</th>}</tr></thead>
      <tbody>
        {alerts.length ? alerts.map((x, i) => (
          <tr key={i} className={x.r.muted ? 'opacity-55' : ''}>
            <td><Badge tone={x.k === 'bad' ? 'crit' : 'warn'} dot={x.r.muted ? 'off' : x.k === 'bad' ? 'crit' : 'warn'}>{x.k === 'bad' ? 'Crítica' : 'Atención'}</Badge></td>
            <td><a href={`#/s/${encodeURIComponent(x.r.s.inst)}`} className="font-mono text-ink no-underline hover:underline whitespace-nowrap">{x.r.s.host}</a></td>
            <td>{x.t}</td>
            {showHostState && <td>{x.r.muted ? <Badge tone="off">Silenciada</Badge> : <Badge tone="info">Activa</Badge>}</td>}
          </tr>
        )) : (
          <tr><td colSpan={showHostState ? 4 : 3}><Empty><IOk size={16} className="text-ok inline -mt-0.5 mr-1" />Sin alertas</Empty></td></tr>
        )}
      </tbody>
    </table>
  );
}

export const sslTone = (days) => (days == null ? 'off' : days <= SSL_BAD_DAYS ? 'crit' : days <= SSL_WARN_DAYS ? 'warn' : 'ok');

export function WebTable({ web }) {
  const rows = [...web].sort((a, b) => a.ok - b.ok || (a.ssl ?? 1e12) - (b.ssl ?? 1e12));
  return (
    <table className="tbl">
      <thead><tr><th>Endpoint</th><th>Estado</th><th className="num">Latencia</th><th className="num">SSL vence</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((w) => {
          const days = w.ssl != null ? Math.floor(w.ssl / 86400) : null;
          return (
            <tr key={w.target} className="cursor-pointer" onClick={() => { location.hash = '#/sitio/' + encodeURIComponent(w.target); }}>
              <td className="font-mono text-ink text-xs"><EditName k={`site:${w.target}`} orig={w.target.replace(/^https?:\/\//, '').replace(/\/$/, '')} /></td>
              <td><Badge tone={w.ok ? 'ok' : 'crit'} dot={w.ok ? 'ok' : 'crit'}>{w.ok ? 'Operativo' : 'Caído'}{w.code ? ` · ${w.code}` : ''}</Badge></td>
              <td className="num">{w.dur != null ? `${Math.round(w.dur * 1000)} ms` : '—'}</td>
              <td className="num"><Badge tone={sslTone(days)}>{days == null ? '—' : `${days} d`}</Badge></td>
            </tr>
          );
        }) : (
          <tr><td colSpan={4}><Empty>Sin sondas Blackbox. Agrega tus dominios al job <span className="font-mono">blackbox_http</span> de Prometheus.</Empty></td></tr>
        )}
      </tbody>
    </table>
  );
}

/** Encabezado de página estándar */
export const PageHead = ({ title, sub, children }) => (
  <div className="flex items-end gap-4 mb-4 flex-wrap">
    <div>
      <h1 className="m-0 text-xl font-semibold text-ink tracking-tight">{title}</h1>
      {sub && <div className="text-muted text-[12.5px] mt-0.5">{sub}</div>}
    </div>
    <div className="flex-1" />
    {children}
  </div>
);
