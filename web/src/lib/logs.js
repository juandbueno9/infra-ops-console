// Logs centralizados (Loki). Arma consultas LogQL a partir de filtros simples.
import { DEMO } from '../config.js';
import { lokiQuery, lokiValues } from './api.js';

export const LOG_RANGES = {
  '15m': { label: '15 min', secs: 900, step: 15 },
  '1h': { label: '1 hora', secs: 3600, step: 60 },
  '6h': { label: '6 horas', secs: 21600, step: 300 },
  '24h': { label: '24 horas', secs: 86400, step: 900 },
  '7d': { label: '7 días', secs: 604800, step: 3600 },
};
export const SOURCES = [
  ['', 'Todas las fuentes'], ['nginx', 'nginx'], ['apache', 'Apache'], ['docker', 'Contenedores'],
  ['auth', 'Accesos (auth.log)'], ['syslog', 'Sistema (syslog)'], ['mysql', 'MySQL'], ['postgresql', 'PostgreSQL'],
];
// Líneas que cuentan como error: nivel error/crit/fatal, excepciones y respuestas HTTP 5xx en logs de acceso
export const ERROR_RE = '(?i)(error|crit|fatal|emerg|panic|exception|traceback|failed|denied|" 5[0-9][0-9] )';
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function selector(f) {
  const m = [];
  if (f.servidor) m.push(`servidor="${esc(f.servidor)}"`);
  if (f.job) m.push(`job="${esc(f.job)}"`);
  if (f.tipo) m.push(`tipo="${esc(f.tipo)}"`);
  if (f.contenedor) m.push(`contenedor="${esc(f.contenedor)}"`);
  if (!m.length) m.push('job=~".+"');
  return `{${m.join(', ')}}`;
}
export function pipeline(f) {
  let p = '';
  if (f.text) p += ` |~ "(?i)${esc(f.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}"`;
  if (f.onlyErrors) p += ` |~ "${esc(ERROR_RE)}"`;
  return p;
}
export const logql = (f) => selector(f) + pipeline(f);

export async function loadLogs(f) {
  if (DEMO) return demoLogs(f);
  const R = LOG_RANGES[f.range] || LOG_RANGES['1h'];
  const end = Date.now() / 1000, start = end - R.secs, sel = selector(f), pipe = pipeline(f);
  const [streams, volume, errors, http5xx, sshFail] = await Promise.all([
    lokiQuery(sel + pipe, { start, end, limit: f.limit || 500 }),
    lokiQuery(`sum(count_over_time(${sel}${pipe} [${R.step}s]))`, { start, end, step: R.step }).catch(() => null),
    lokiQuery(`sum(count_over_time(${sel} |~ "${esc(ERROR_RE)}" [${R.secs}s]))`, { start: end - 1, end, step: R.secs }).catch(() => null),
    lokiQuery(`sum(count_over_time({job=~"nginx|apache", tipo="acceso"${f.servidor ? `, servidor="${esc(f.servidor)}"` : ''}} |~ "\\" 5[0-9][0-9] " [${R.secs}s]))`, { start: end - 1, end, step: R.secs }).catch(() => null),
    lokiQuery(`sum(count_over_time({job="auth"${f.servidor ? `, servidor="${esc(f.servidor)}"` : ''}} |~ "Failed password|Invalid user|authentication failure" [${R.secs}s]))`, { start: end - 1, end, step: R.secs }).catch(() => null),
  ]);
  const lines = [];
  for (const s of streams.result || []) for (const [ns, line] of s.values) lines.push({ ts: Number(ns.slice(0, -6)) / 1000, ns, line, labels: s.stream });
  lines.sort((a, b) => (b.ns > a.ns ? 1 : b.ns < a.ns ? -1 : 0));
  const scalar = (d) => (d?.result?.[0]?.values?.length ? +d.result[0].values.at(-1)[1] : 0);
  return {
    lines, limitHit: lines.length >= (f.limit || 500),
    volume: volume?.result?.[0]?.values?.map(([t, v]) => [+t, +v]) || [],
    stats: { errors: scalar(errors), http5xx: scalar(http5xx), sshFail: scalar(sshFail) },
    query: sel + pipe,
  };
}

export async function loadLogFacets() {
  if (DEMO) return { servidores: ['app-server', 'core-fineract'], contenedores: ['infra-vaultwarden', 'grafana', 'prometheus', 'fcems_docker-nginx-1'] };
  const [servidores, contenedores] = await Promise.all([lokiValues('servidor'), lokiValues('contenedor')]);
  return { servidores, contenedores };
}

/** Nivel visual de una línea. */
export function lineLevel(l) {
  if (/(\s|")5\d\d\s|(?:^|\W)(error|crit|fatal|emerg|panic|exception)(?:\W|$)/i.test(l)) return 'crit';
  if (/(\s|")4\d\d\s|(?:^|\W)(warn|warning|failed|denied|invalid)(?:\W|$)/i.test(l)) return 'warn';
  return '';
}

// ---------- demo ----------
function demoLogs(f) {
  const R = LOG_RANGES[f.range] || LOG_RANGES['1h'], now = Date.now() / 1000, out = [];
  const tpl = [
    ['nginx', 'acceso', null, (i) => `203.0.113.10 - - [${new Date((now - i * 7) * 1000).toUTCString()}] "GET /api/v1/clientes?page=${i % 9} HTTP/1.1" ${i % 23 === 0 ? 502 : i % 11 === 0 ? 404 : 200} ${800 + i * 13} "-" "Mozilla/5.0"`],
    ['nginx', 'error', null, (i) => `${new Date((now - i * 7) * 1000).toISOString().replace('T', ' ').slice(0, 19)} [error] 1180#1180: *${4400 + i} upstream timed out (110: Connection timed out) while reading response header from upstream, server: crm.empresa.com`],
    ['auth', 'seguridad', null, (i) => i % 5 === 0 ? `sshd[${2200 + i}]: Failed password for invalid user admin from 203.0.113.18 port ${40000 + i} ssh2` : `sshd[${2200 + i}]: Accepted publickey for ubuntu from 203.0.113.10 port ${50000 + i} ssh2: ED25519 SHA256:AbC123`],
    ['docker', 'contenedor', 'infra-vaultwarden', (i) => `[${new Date((now - i * 7) * 1000).toISOString()}][vaultwarden::api::identity][INFO] User admin@empresa.com logged in successfully. IP: 203.0.113.10`],
    ['docker', 'contenedor', 'grafana', (i) => `logger=context userId=1 orgId=1 uname=admin t=${new Date((now - i * 7) * 1000).toISOString()} level=${i % 13 === 0 ? 'error' : 'info'} msg="Request Completed" method=GET path=/api/dashboards status=200`],
    ['syslog', 'sistema', null, (i) => `systemd[1]: ${i % 17 === 0 ? 'Failed to start' : 'Started'} Daily apt upgrade and clean activities.`],
    ['mysql', 'error', null, (i) => `${new Date((now - i * 7) * 1000).toISOString()} 0 [Warning] [MY-010055] [Server] IP address '203.0.113.18' could not be resolved: Name or service not known`],
  ];
  for (let i = 0; i < 400; i++) {
    const [job, tipo, contenedor, fn] = tpl[i % tpl.length];
    const ts = now - i * (R.secs / 400);
    out.push({ ts, ns: String(Math.floor(ts * 1e9)), line: fn(i), labels: { job, tipo, servidor: i % 4 === 3 ? 'core-fineract' : 'app-server', ...(contenedor ? { contenedor } : {}), filename: job === 'nginx' ? `/var/log/nginx/${tipo === 'error' ? 'error' : 'access'}.log` : undefined } });
  }
  const re = f.text ? new RegExp(f.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const lines = out.filter((l) => (!f.job || l.labels.job === f.job) && (!f.tipo || l.labels.tipo === f.tipo) && (!f.servidor || l.labels.servidor === f.servidor)
    && (!f.contenedor || l.labels.contenedor === f.contenedor) && (!re || re.test(l.line)) && (!f.onlyErrors || lineLevel(l.line)));
  const n = Math.round(R.secs / R.step);
  return {
    lines, limitHit: false,
    volume: Array.from({ length: n }, (_, k) => [now - (n - k) * R.step, Math.round(lines.length / n * (0.6 + Math.abs(Math.sin(k / 4))) + (k === n - 8 ? 25 : 0))]),
    stats: { errors: lines.filter((l) => lineLevel(l.line) === 'crit').length, http5xx: 17, sshFail: 80 },
    query: logql(f),
  };
}
