// Servidores Windows (windows_exporter, puerto 9182) — p. ej. active-directory en Azure.
// Usa métricas estándar de windows_exporter; cubre nombres de versiones nuevas y antiguas (con "or").
// Aparece solo cuando Prometheus tiene objetivos del job azure_windows (u otro job que termine en _windows).
import { useEffect, useState } from 'react';
import { EditName } from './EditName.jsx';
import { DEMO } from '../config.js';
import { q, safe } from '../lib/api.js';
import { Badge, Panel, Pulse } from './ui.jsx';

const J = 'job=~".*_windows|windows.*"';
const CRIT_SVC = 'ntds|dns|netlogon|kdc|w32time|dfsr|adws|lanmanserver|wuauserv|windefend';
const Q = {
  up: `up{${J}}`,
  cpu: `100 - avg by (instance) (rate(windows_cpu_time_total{${J},mode="idle"}[2m])) * 100`,
  mem: `100 * (1 - windows_memory_available_bytes{${J}} / windows_memory_physical_total_bytes{${J}}) or 100 * (1 - windows_os_physical_memory_free_bytes{${J}} / windows_cs_physical_memory_bytes{${J}})`,
  disk: `100 - 100 * windows_logical_disk_free_bytes{${J},volume="C:"} / windows_logical_disk_size_bytes{${J},volume="C:"}`,
  boot: `windows_system_boot_time_timestamp_seconds{${J}} or (time() - windows_system_system_up_time{${J}} * 0 + windows_system_system_up_time{${J}})`,
  svc: `windows_service_state{${J},state="running",name=~"${CRIT_SVC}"}`,
  name: `windows_os_hostname{${J}} or windows_cs_hostname{${J}}`,
  ver: `windows_os_info{${J}}`,
};
const NAMES = { ntds: 'Active Directory (NTDS)', dns: 'DNS', netlogon: 'Netlogon', kdc: 'Kerberos (KDC)', w32time: 'Hora (W32Time)', dfsr: 'Replicación DFS', adws: 'AD Web Services', lanmanserver: 'Carpetas compartidas', wuauserv: 'Windows Update', windefend: 'Microsoft Defender' };

async function load() {
  if (DEMO) return [{ inst: '172.0.10.20:9182', label: 'azure-active-directory', up: 1, cpu: 7, mem: 62, disk: 48, uptime: 12 * 86400, os: 'Windows Server 2022', svc: [['ntds', 1], ['dns', 1], ['netlogon', 1], ['kdc', 1], ['w32time', 1], ['windefend', 1]] }];
  const R = Object.fromEntries(await Promise.all(Object.entries(Q).map(async ([k, e]) => [k, await safe(q(e))])));
  if (!R.up.length) return [];
  const by = (k) => Object.fromEntries((R[k] || []).map((x) => [x.metric.instance, +x.value[1]]));
  const cpu = by('cpu'), mem = by('mem'), disk = by('disk'), boot = by('boot');
  const name = Object.fromEntries((R.name || []).map((x) => [x.metric.instance, x.metric.hostname]));
  const ver = Object.fromEntries((R.ver || []).map((x) => [x.metric.instance, x.metric.product || x.metric.version || '']));
  const svc = {}; for (const x of R.svc || []) (svc[x.metric.instance] ||= []).push([x.metric.name, +x.value[1]]);
  return R.up.map((x) => {
    const i = x.metric.instance, b = boot[i];
    return { inst: i, label: x.metric.nombre || name[i] || i, up: +x.value[1], cpu: cpu[i], mem: mem[i], disk: disk[i], uptime: b ? (b > 1e9 ? Date.now() / 1000 - b : b) : null, os: ver[i] || '', svc: svc[i] || [] };
  });
}

const tone = (v, w, c) => (v == null ? 'off' : v >= c ? 'crit' : v >= w ? 'warn' : 'ok');
const fmt = (v) => (v == null ? '—' : `${v.toFixed(0)}%`);
const days = (s) => (s == null ? '—' : s > 86400 ? `${Math.floor(s / 86400)} d` : `${Math.floor(s / 3600)} h`);

export function WindowsPanel() {
  const [rows, setRows] = useState(null);
  useEffect(() => { let a = true; const go = () => load().then((r) => a && setRows(r)).catch(() => a && setRows([])); go(); const t = setInterval(go, 30e3); return () => { a = false; clearInterval(t); }; }, []);
  if (!rows?.length) return null;
  return (
    <Panel title="Servidores Windows" meta={`${rows.length} · windows_exporter`} className="mb-4" bodyClass="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Servidor</th><th>Estado</th><th className="num">CPU</th><th className="num">Memoria</th><th className="num">Disco C:</th><th className="num">Encendido</th><th>Servicios clave</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const down = r.svc.filter(([, v]) => v !== 1);
            return (
              <tr key={r.inst}>
                <td><div className="flex items-center gap-2 text-ink font-mono"><Pulse tone={r.up !== 1 ? 'crit' : down.length ? 'warn' : 'ok'} /><EditName k={r.inst} orig={r.label} /></div><div className="text-[10.5px] text-faint font-mono pl-[18px]">{r.inst}{r.os ? ` · ${r.os}` : ''}</div></td>
                <td>{r.up === 1 ? <Badge tone="ok">En línea</Badge> : <Badge tone="crit">Sin respuesta</Badge>}</td>
                <td className={`num text-${tone(r.cpu, 80, 95)}`}>{fmt(r.cpu)}</td>
                <td className={`num text-${tone(r.mem, 90, 95)}`}>{fmt(r.mem)}</td>
                <td className={`num text-${tone(r.disk, 85, 90)}`}>{fmt(r.disk)}</td>
                <td className="num">{days(r.uptime)}</td>
                <td><div className="flex flex-wrap gap-1">{r.svc.length ? r.svc.map(([n, v]) => <Badge key={n} tone={v === 1 ? 'ok' : 'crit'}>{v === 1 ? '' : '⚠ '}{NAMES[n] || n}</Badge>) : <span className="text-faint text-[11.5px]">—</span>}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
