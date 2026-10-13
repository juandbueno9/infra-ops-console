// Auditoría: todo queda registrado.
//  - Acciones del panel (silenciar, quitar, restaurar) — backend, append-only
//  - Ingresos al panel (quién abrió el panel, desde qué IP) — backend
//  - Exportaciones (quién descargó auditoría) — backend
//  - Accesos SSH a los servidores (exitosos y fallidos, 7 días) — agente → Prometheus
import { useEffect, useMemo, useState } from 'react';
import { DEMO } from '../config.js';
import { api } from '../lib/api.js';
import { SSH_CSV_HEADER, downloadCsv, fdatetime, fdur, loadSshEvents, sshCsvRows } from '../lib/sshEvents.js';
import { usePolling } from '../hooks/usePolling.js';
import { PageHead } from '../components/tables.jsx';
import { IpCell, KeyCell, MethodBadge } from '../components/ssh.jsx';
import { Badge, Empty } from '../components/ui.jsx';
import { ISearch } from '../components/icons.jsx';

const TABS = [
  ['acciones', 'Acciones del panel'],
  ['accesos', 'Ingresos al panel'],
  ['ssh', 'Accesos SSH'],
];
const PRESETS = [['24h', 'Últimas 24 h', 1], ['7d', '7 días', 7], ['30d', '30 días', 30], ['90d', '90 días', 90], ['custom', 'Personalizado', 0]];
const toneOf = (a = '') => (a.startsWith('quitar') ? 'crit' : a.startsWith('silenciar') ? 'warn' : a.startsWith('exportó') ? 'info' : 'ok');
const dayStr = (d) => d.toISOString().slice(0, 10);

function demoAudit() {
  const now = Date.now(), H = 3600e3, rows = [];
  const acts = [['silenciar 4 h', 'core-staging'], ['reactivar alertas', 'core-staging'], ['quitar del panel', 'empresa-old'], ['restaurar en el panel', 'empresa-old']];
  acts.forEach(([action, host], i) => rows.push({ at: new Date(now - (i * 9 + 2) * H).toISOString(), category: 'accion', action, host, actor: i % 2 ? 'ana.admin' : 'carlos.ops', ip: '203.0.113.10', detail: '' }));
  for (let i = 0; i < 14; i++) rows.push({ at: new Date(now - i * 5.5 * H).toISOString(), category: 'acceso', action: 'ingresó al panel', host: '', actor: ['ana.admin', 'carlos.ops', 'admin'][i % 3], ip: i % 5 === 4 ? '203.0.113.21' : '203.0.113.10', detail: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129' });
  rows.push({ at: new Date(now - 30 * H).toISOString(), category: 'exportacion', action: 'exportó la auditoría (CSV)', host: '', actor: 'ana.admin', ip: '203.0.113.10', detail: '42 filas · 30 días' });
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function Audit({ tab: routeTab, params = {} }) {
  const tab = TABS.some(([k]) => k === routeTab) ? routeTab : 'acciones';
  const setTab = (k) => { location.hash = `#/auditoria/${k}`; };
  const [preset, setPreset] = useState('7d');
  const [from, setFrom] = useState(dayStr(new Date(Date.now() - 7 * 86400e3)));
  const [to, setTo] = useState(dayStr(new Date()));
  const [host, setHost] = useState(params.host || '');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { setHost(params.host || ''); }, [params.host]);

  // Rango en fechas absolutas
  const range = useMemo(() => {
    const p = PRESETS.find((x) => x[0] === preset);
    if (p && p[2]) return { from: new Date(Date.now() - p[2] * 86400e3).toISOString(), to: '' };
    return { from: new Date(from + 'T00:00:00').toISOString(), to: new Date(to + 'T23:59:59').toISOString() };
  }, [preset, from, to]);

  // Acciones / ingresos (backend)
  const category = tab === 'acciones' ? '' : tab === 'accesos' ? 'acceso' : null;
  useEffect(() => {
    if (tab === 'ssh') return;
    let dead = false;
    setRows(null); setErr(null);
    const load = DEMO ? Promise.resolve(demoAudit()) : api.audit({ ...range, category, limit: 5000 });
    load.then((r) => {
      if (dead) return;
      const list = DEMO ? r.filter((x) => new Date(x.at) >= new Date(range.from) && (!range.to || new Date(x.at) <= new Date(range.to))) : r;
      setRows(tab === 'acciones' ? list.filter((x) => x.category !== 'acceso') : list.filter((x) => x.category === 'acceso'));
    }).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [tab, range, category]);

  // Accesos SSH (Prometheus, 7 días)
  const ssh = usePolling(() => (tab === 'ssh' ? loadSshEvents() : Promise.resolve(null)), tab === 'ssh' ? 60 : 0, [tab]);
  const sshAll = ssh.data || [];
  const hosts = [...new Set(sshAll.map((e) => e.host))].sort();

  const needle = q.toLowerCase();
  const inRange = (t) => t >= new Date(range.from).getTime() && (!range.to || t <= new Date(range.to).getTime());
  const sshRows = sshAll.filter((e) => inRange(e.ts * 1000) && (!host || e.host === host) && (kind === 'all' || e.kind === kind)
    && (!needle || `${e.host} ${e.user} ${e.from} ${e.key} ${e.method}`.toLowerCase().includes(needle)));
  const panelRows = (rows || []).filter((x) => (!host || x.host === host) && (!needle || `${x.action} ${x.host} ${x.actor} ${x.ip} ${x.detail}`.toLowerCase().includes(needle)));

  const exportCsv = () => {
    if (tab === 'ssh') {
      downloadCsv(`accesos-ssh-${dayStr(new Date())}.csv`, SSH_CSV_HEADER, sshCsvRows(sshRows));
      if (!DEMO) api.logEvent('exportó accesos SSH (CSV)', `${sshRows.length} filas${host ? ' · ' + host : ''}`).catch(() => {});
    } else if (DEMO) {
      downloadCsv(`auditoria-${dayStr(new Date())}.csv`, ['fecha', 'categoria', 'accion', 'host', 'usuario', 'ip', 'detalle'], panelRows.map((r) => [r.at, r.category, r.action, r.host, r.actor, r.ip, r.detail]));
    } else {
      location.href = api.auditCsvUrl({ ...range, category, q });
    }
  };

  const count = tab === 'ssh' ? sshRows.length : panelRows.length;
  const nFail = sshRows.filter((e) => e.kind === 'failed').length;

  return (
    <>
      <PageHead title="Auditoría" sub="Registro inmutable de todo lo que pasa: acciones en el panel, ingresos y accesos SSH a los servidores">
        <button type="button" onClick={exportCsv} disabled={!count} className="btn h-[30px] px-3 rounded-lg border border-line bg-bg1 text-ink2 text-xs font-medium hover:bg-surface disabled:opacity-40">
          Exportar CSV ({count})
        </button>
      </PageHead>

      <div className="flex items-center gap-1 border-b border-line mb-3 overflow-x-auto" role="tablist">
        {TABS.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px ${tab === k ? 'border-info text-ink' : 'border-transparent text-muted hover:text-ink2'}`}>{t}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="inp font-sans" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Rango de fechas">
          {PRESETS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" className="inp" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <span className="text-faint text-xs">a</span>
            <input type="date" className="inp" value={to} min={from} max={dayStr(new Date())} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </>
        )}
        {tab === 'ssh' && (
          <>
            <select className="inp font-sans" value={host} onChange={(e) => setHost(e.target.value)} aria-label="Servidor">
              <option value="">Todos los servidores</option>
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
              {host && !hosts.includes(host) && <option value={host}>{host}</option>}
            </select>
            <div className="seg" role="group" aria-label="Resultado">
              <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>Todos</button>
              <button type="button" aria-pressed={kind === 'login'} onClick={() => setKind('login')}>Exitosos</button>
              <button type="button" aria-pressed={kind === 'failed'} onClick={() => setKind('failed')}>Fallidos</button>
            </div>
          </>
        )}
        <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px]">
          <ISearch size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar usuario, IP, host…" aria-label="Buscar en auditoría" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-52" />
        </label>
        {tab === 'ssh' && <span className="text-xs text-muted ml-auto">{sshRows.length} eventos · <span className={nFail ? 'text-warn' : ''}>{nFail} fallidos</span> · el agente conserva 7 días del journal</span>}
      </div>

      <section className="panel overflow-auto max-h-[calc(100vh-270px)]">
        {tab === 'ssh' ? (
          <table className="tbl">
            <thead><tr><th>Fecha y hora</th><th>Servidor</th><th>Resultado</th><th>Persona / llave</th><th>Usuario</th><th>Origen</th><th>Método</th><th>Salida</th><th className="num">Duración</th></tr></thead>
            <tbody>
              {ssh.loading && !ssh.data ? <tr><td colSpan={9}><Empty>Cargando accesos…</Empty></td></tr>
                : sshRows.length ? sshRows.slice(0, 2000).map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-xs whitespace-nowrap text-ink">{fdatetime(e.ts)}</td>
                    <td className="font-mono whitespace-nowrap"><a className="hover:underline" href={`#/s/${encodeURIComponent(e.inst)}`}>{e.host}</a></td>
                    <td>{e.kind === 'login' ? <Badge tone="ok">Exitoso</Badge> : <Badge tone="crit">Fallido</Badge>}</td>
                    <td><KeyCell k={e.key} /></td>
                    <td className="font-mono text-ink">{e.user || '—'}</td>
                    <td><IpCell ip={e.from} /></td>
                    <td><MethodBadge m={e.method} /></td>
                    <td className="font-mono text-xs whitespace-nowrap">{e.end ? fdatetime(e.end) : <span className="text-faint">—</span>}</td>
                    <td className="num">{e.end ? fdur(e.end - e.ts) : '—'}</td>
                  </tr>
                )) : <tr><td colSpan={9}><Empty>{sshAll.length ? 'Ningún acceso coincide con los filtros.' : 'Sin eventos SSH. Actualiza el agente en los servidores (--scripts-only) para registrar el historial.'}</Empty></td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="tbl">
            <thead><tr><th>Fecha y hora</th>{tab === 'acciones' && <th>Acción</th>}{tab === 'acciones' && <th>Host</th>}<th>Usuario</th><th>IP</th><th>Detalle</th></tr></thead>
            <tbody>
              {err ? <tr><td colSpan={6}><Empty>No se pudo leer la auditoría: {err}</Empty></td></tr>
                : !rows ? <tr><td colSpan={6}><Empty>Cargando…</Empty></td></tr>
                  : panelRows.length ? panelRows.map((x, i) => (
                    <tr key={i}>
                      <td className="font-mono text-xs whitespace-nowrap text-ink">{new Date(x.at).toLocaleString('es-CO', { hour12: false })}</td>
                      {tab === 'acciones' && <td><Badge tone={toneOf(x.action)}>{x.action}</Badge></td>}
                      {tab === 'acciones' && <td className="font-mono text-ink">{x.host || '—'}</td>}
                      <td className="font-mono text-ink">{x.actor}</td>
                      <td><IpCell ip={x.ip} /></td>
                      <td className="text-xs text-muted max-w-[420px] truncate" title={x.detail}>{x.detail || '—'}</td>
                    </tr>
                  )) : <tr><td colSpan={6}><Empty>Sin registros en este rango</Empty></td></tr>}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-xs text-faint mt-2">Los registros del panel se guardan en archivos mensuales de solo agregar (<span className="font-mono">server/data/audit/</span>); no se pueden editar ni borrar desde el panel. Cada exportación también queda registrada.</p>
    </>
  );
}
