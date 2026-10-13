// Componentes de accesos SSH: celdas, panel desplegable del host.
import { Fragment, useState } from 'react';
import { ipKind } from '../lib/analyze.js';
import { hhmm } from '../lib/format.js';
import { fdate, fdur, ftime, groupFailed, groupLogins, sessionState } from '../lib/sshEvents.js';
import { Badge, Empty, Panel } from './ui.jsx';

export const KeyCell = ({ k }) => !k ? <span className="text-faint">—</span>
  : k === 'llave desconocida' ? <Badge tone="crit" title="La huella no está en authorized_keys ni en /etc/infra-ssh-keys">Llave desconocida</Badge>
    : <span className="font-mono text-ink" title="Comentario de la llave en authorized_keys">{k}</span>;

export const IpCell = ({ ip }) => { const [t, k] = ipKind(ip); return <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="font-mono text-ink">{ip || 'local'}</span><Badge tone={k}>{t}</Badge></span>; };

export const MethodBadge = ({ m }) => !m ? <span className="text-faint">—</span>
  : <Badge tone={m === 'publickey' ? 'ok' : m === 'password' ? 'warn' : 'off'}>{m === 'publickey' ? 'Llave' : m === 'password' ? 'Contraseña' : m}</Badge>;

const Chevron = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform text-faint ${open ? 'rotate-90' : ''}`} aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
);

/** Detalle de cada acceso: fecha, hora de entrada y salida, duración y estado. */
function LoginDetail({ items, sessions }) {
  return (
    <table className="tbl tbl-sub">
      <thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th className="num">Duración</th><th>Estado</th></tr></thead>
      <tbody>
        {items.map((e) => {
          const st = sessionState(e, sessions);
          return (
            <tr key={e.id}>
              <td className="whitespace-nowrap capitalize">{fdate(e.ts)}</td>
              <td className="font-mono text-ink">{ftime(e.ts)}</td>
              <td className="font-mono">{e.end ? ftime(e.end) : <span className="text-faint">—</span>}</td>
              <td className="num">{st.dur != null ? fdur(st.dur) : '—'}</td>
              <td><Badge tone={st.tone} dot={st.label === 'En curso' ? 'ok' : undefined} title={st.label === 'Sin cierre' ? 'No hay registro de cierre en el journal (conexión cortada o sesión aún abierta sin TTY)' : undefined}>{st.label}</Badge></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FailedDetail({ items }) {
  return (
    <table className="tbl tbl-sub">
      <thead><tr><th>Fecha</th><th>Hora</th><th>Usuario intentado</th></tr></thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.id}><td className="whitespace-nowrap capitalize">{fdate(e.ts)}</td><td className="font-mono text-ink">{ftime(e.ts)}</td><td className="font-mono">{e.user || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Panel del host: accesos agrupados por persona/origen, desplegables con cada fecha de acceso. */
export function SshAccessPanel({ d, className = '' }) {
  const [tab, setTab] = useState('ok');
  const [open, setOpen] = useState({});
  const ev = d.sshEvents || [];
  const hasEvents = ev.length > 0;
  const logins = groupLogins(ev), failed = groupFailed(ev);
  const nOk = ev.filter((e) => e.kind === 'login').length, nBad = ev.length - nOk;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const auditLink = `#/auditoria/ssh?host=${encodeURIComponent(d.info?.hostname || d.inst)}`;

  const actions = (
    <div className="flex items-center gap-2">
      {hasEvents && (
        <div className="seg" role="group" aria-label="Tipo de acceso">
          <button type="button" aria-pressed={tab === 'ok'} onClick={() => setTab('ok')}>Exitosos <span className="text-faint">{nOk}</span></button>
          <button type="button" aria-pressed={tab === 'bad'} onClick={() => setTab('bad')}>Fallidos <span className={nBad ? 'text-warn' : 'text-faint'}>{nBad}</span></button>
        </div>
      )}
      <a href={auditLink} className="text-xs text-info hover:underline whitespace-nowrap">Ver auditoría →</a>
    </div>
  );

  // Agente sin actualizar: mostrar el resumen de 24 h de antes
  if (!hasEvents) {
    return (
      <Panel title="Accesos SSH · 24 h" meta={d.logins.length ? `${d.logins.reduce((t, x) => t + x.count, 0)} accesos` : ''} actions={actions} className={className} bodyClass="overflow-auto max-h-[420px]">
        <table className="tbl"><thead><tr><th>Persona / llave</th><th>Usuario</th><th>Origen</th><th>Método</th><th className="num">Accesos</th><th className="num">Último</th></tr></thead><tbody>
          {d.logins.length ? d.logins.map((x, i) => (
            <tr key={i}><td><KeyCell k={x.key} /></td><td className="font-mono text-ink">{x.user}</td><td><IpCell ip={x.from} /></td>
              <td><MethodBadge m={x.method} /></td><td className="num">{x.count}</td><td className="num">{hhmm(x.last)}</td></tr>))
            : <tr><td colSpan={6}><Empty>Sin accesos SSH en las últimas 24 h</Empty></td></tr>}
        </tbody></table>
        <div className="px-4 py-2.5 text-xs text-muted border-t border-line">El historial con fechas de entrada y salida aparece al actualizar el agente en este servidor (<span className="font-mono">--scripts-only</span>).</div>
      </Panel>
    );
  }

  return (
    <Panel title="Accesos SSH · 7 días" meta={tab === 'ok' ? `${logins.length} origen(es)` : `${failed.length} IP(s)`} actions={actions} className={className} bodyClass="overflow-auto max-h-[520px]">
      {tab === 'ok' ? (
        <table className="tbl">
          <thead><tr><th className="w-6" /><th>Persona / llave</th><th>Usuario</th><th>Origen</th><th>Método</th><th className="num">24 h</th><th className="num">7 días</th><th className="num">Último acceso</th></tr></thead>
          <tbody>
            {logins.length ? logins.map((g) => (
              <Fragment key={g.k}>
                <tr className="cursor-pointer hover:bg-bg1/60" onClick={() => toggle(g.k)} aria-expanded={!!open[g.k]}
                  tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(g.k))}>
                  <td><Chevron open={open[g.k]} /></td>
                  <td><KeyCell k={g.key} /></td><td className="font-mono text-ink">{g.user}</td><td><IpCell ip={g.from} /></td>
                  <td><MethodBadge m={g.method} /></td><td className="num">{g.c24}</td><td className="num">{g.items.length}</td><td className="num whitespace-nowrap">{hhmm(g.last)}</td>
                </tr>
                {open[g.k] && <tr className="sub-row"><td /><td colSpan={7} className="!p-0"><LoginDetail items={g.items} sessions={d.sessions} /></td></tr>}
              </Fragment>
            )) : <tr><td colSpan={8}><Empty>Sin accesos exitosos en 7 días</Empty></td></tr>}
          </tbody>
        </table>
      ) : (
        <table className="tbl">
          <thead><tr><th className="w-6" /><th>IP de origen</th><th>Usuarios intentados</th><th className="num">Intentos</th><th className="num">Último</th></tr></thead>
          <tbody>
            {failed.length ? failed.map((g) => (
              <Fragment key={g.k}>
                <tr className="cursor-pointer hover:bg-bg1/60" onClick={() => toggle('f' + g.k)} aria-expanded={!!open['f' + g.k]} tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle('f' + g.k))}>
                  <td><Chevron open={open['f' + g.k]} /></td>
                  <td><IpCell ip={g.from} /></td>
                  <td className="font-mono text-xs text-muted">{[...g.users].slice(0, 6).join(', ')}{g.users.size > 6 ? ` +${g.users.size - 6}` : ''}</td>
                  <td className="num">{g.items.length}</td><td className="num whitespace-nowrap">{hhmm(g.last)}</td>
                </tr>
                {open['f' + g.k] && <tr className="sub-row"><td /><td colSpan={4} className="!p-0"><FailedDetail items={g.items} /></td></tr>}
              </Fragment>
            )) : <tr><td colSpan={5}><Empty>Sin intentos fallidos en 7 días</Empty></td></tr>}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
