// Detección de escaneos y ataques a partir de los logs que ya llegan a Loki (solo lectura):
//  - Escaneo web: muchas respuestas 4xx desde una misma IP en una hora (prueba rutas al azar).
//  - Rutas peligrosas: .env, .git, metadatos de AWS (169.254.169.254), WordPress, phpMyAdmin, exploits conocidos…
//  - Fuerza bruta SSH: intentos fallidos repetidos desde una IP.
// Si una ruta peligrosa respondió 2xx se marca como CRÍTICA (posible fuga de información).
import { DEMO } from '../config.js';
import { lokiQuery } from './api.js';
import { ipKind } from './analyze.js';

export const SCAN_RULES = { web4xxPerHour: 30, suspHits: 3, sshFails: 10 };

// Rutas que un usuario normal nunca pide. (?i) = sin distinguir mayúsculas.
const SUSP = String.raw`(?i)(/\.env|/\.git/|/\.aws|/\.ssh|/\.vscode|/\.DS_Store|/config\.json|/backup\.(zip|sql|tar|gz)|/dump\.sql|169\.254\.169\.254|/latest/meta-data|/etc/passwd|\.\./\.\./|/wp-admin|/wp-login|/wp-content|/wp-includes|xmlrpc\.php|phpmyadmin|/pma/|/manager/html|/admin\.php|/setup\.php|/install\.php|/actuator|/cgi-bin/|/vendor/phpunit|eval-stdin|/boaform|/HNAP1|/solr/|/geoserver|/shell|/cmd\.php|/think/|/console/)`;
const CATS = [
  [/169\.254\.169\.254|latest\/meta-data/i, 'Robo de credenciales de AWS (SSRF)', 'crit'],
  [/\.env|\.git\/|\.aws|\.ssh|config\.json|backup\.|dump\.sql|\.vscode|\.DS_Store/i, 'Búsqueda de contraseñas y secretos', 'crit'],
  [/etc\/passwd|\.\.\/\.\.\//i, 'Lectura de archivos del sistema', 'crit'],
  [/wp-|xmlrpc/i, 'Ataque a WordPress', 'warn'],
  [/phpmyadmin|\/pma\/|manager\/html|admin\.php|setup\.php|install\.php|\/console\//i, 'Búsqueda de paneles de administración', 'warn'],
  [/.*/, 'Exploit conocido', 'warn'],
];
const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+(?: "([^"]*)" "([^"]*)")?/;
const WEB = '{job=~"nginx|apache", tipo="acceso"}';
const IPRE = String.raw`^(?P<ip>\S+) `;

const instant = (query, secs) => { const end = Date.now() / 1000; return lokiQuery(query, { start: end - 1, end, step: secs }).catch(() => null); };
const series = (d) => (d?.result || []).map((r) => ({ m: r.metric || {}, v: r.values?.length ? +r.values.at(-1)[1] : 0, values: (r.values || []).map(([t, v]) => [+t, +v]) }));

export function categorize(path) {
  for (const [re, label, sev] of CATS) if (re.test(path)) return { label, sev };
  return { label: 'Exploit conocido', sev: 'warn' };
}

/** Escaneos de las últimas `hours` horas, agrupados por IP de origen. */
export async function loadScans(hours = 24) {
  if (DEMO) return demoScans();
  const secs = hours * 3600, end = Date.now() / 1000, start = end - secs;
  const [h4xx, totals, susp, ssh] = await Promise.all([
    lokiQuery(`sum by (servidor, ip) (count_over_time(${WEB} | regexp \`^(?P<ip>\\S+) .*?" (?P<status>\\d{3}) \` | status=~"4.." [1h]))`, { start, end, step: 3600 }).catch(() => null),
    instant(`topk(300, sum by (servidor, ip) (count_over_time(${WEB} | regexp \`${IPRE}\` [${secs}s])))`, secs),
    lokiQuery(`${WEB} |~ \`${SUSP}\``, { start, end, limit: 3000 }).catch(() => null),
    instant(`sum by (servidor, ip) (count_over_time({job="auth"} |~ \`Failed password|Invalid user|authentication failure\` | regexp \`from (?P<ip>[0-9a-fA-F:.]+)( port|$| )\` [${secs}s]))`, secs),
  ]);
  const by = new Map();
  const get = (ip) => {
    if (!by.has(ip)) by.set(ip, { ip, servers: new Set(), total: 0, err4xx: 0, peak4xx: 0, peakAt: null, hits: [], ssh: 0, last: 0 });
    return by.get(ip);
  };
  for (const s of series(h4xx)) {
    if (!s.m.ip) continue;
    const o = get(s.m.ip); o.servers.add(s.m.servidor);
    for (const [t, v] of s.values) { o.err4xx += v; if (v > o.peak4xx) { o.peak4xx = v; o.peakAt = t; } o.last = Math.max(o.last, t); }
  }
  for (const s of series(totals)) if (s.m.ip) { const o = get(s.m.ip); o.total += s.v; o.servers.add(s.m.servidor); }
  for (const st of susp?.result || []) for (const [ns, line] of st.values || []) {
    const m = line.match(LINE); if (!m) continue;
    const o = get(m[1]), ts = Number(ns.slice(0, -6)) / 1000, cat = categorize(m[4]), status = +m[5];
    o.servers.add(st.stream?.servidor);
    o.hits.push({ ts, method: m[3], path: m[4], status, ua: m[7] || '', server: st.stream?.servidor, cat: cat.label, sev: cat.sev === 'crit' && status >= 200 && status < 300 ? 'crit' : cat.sev === 'crit' ? 'warn' : 'info' });
    o.last = Math.max(o.last, ts);
  }
  for (const s of series(ssh)) if (s.m.ip) { const o = get(s.m.ip); o.ssh += s.v; o.servers.add(s.m.servidor); o.last = Math.max(o.last, end); }
  return { ...summarize([...by.values()]), hours, at: Date.now() };
}

/** Decide quién es escáner y con qué gravedad. Las IP conocidas (oficina) y privadas no se marcan. */
export function summarize(list) {
  const out = [];
  for (const o of list) {
    const [kindLabel, kindTone] = ipKind(o.ip);
    if (kindTone === 'ok' || kindLabel === 'Red privada' || kindLabel === 'Consola local') continue;
    const kinds = [];
    if (o.peak4xx >= SCAN_RULES.web4xxPerHour) kinds.push('Escaneo web');
    if (o.hits.length >= SCAN_RULES.suspHits || o.hits.some((h) => h.sev !== 'info')) kinds.push('Rutas peligrosas');
    if (o.ssh >= SCAN_RULES.sshFails) kinds.push('Fuerza bruta SSH');
    if (!kinds.length) continue;
    const crit = o.hits.some((h) => h.sev === 'crit');
    const sev = crit ? 'crit' : (o.ssh >= 50 || o.peak4xx >= 200 || o.hits.length >= 20) ? 'warn' : 'info';
    o.hits.sort((a, b) => b.ts - a.ts);
    out.push({ ...o, servers: [...o.servers].filter(Boolean), kinds, sev, cats: [...new Set(o.hits.map((h) => h.cat))], ok200: o.hits.filter((h) => h.status >= 200 && h.status < 300).length });
  }
  out.sort((a, b) => ({ crit: 0, warn: 1, info: 2 }[a.sev] - { crit: 0, warn: 1, info: 2 }[b.sev]) || b.last - a.last);
  return {
    scanners: out,
    stats: { ips: out.length, web: out.filter((x) => x.kinds.includes('Escaneo web')).length, susp: out.reduce((t, x) => t + x.hits.length, 0), ssh: out.reduce((t, x) => t + x.ssh, 0), crit: out.filter((x) => x.sev === 'crit').length, ok200: out.reduce((t, x) => t + x.ok200, 0) },
  };
}

// ---------- demo ----------
function demoScans() {
  const now = Date.now() / 1000;
  const mk = (ip, srv, extra) => ({ ip, servers: new Set([srv]), total: 0, err4xx: 0, peak4xx: 0, peakAt: null, hits: [], ssh: 0, last: now - 600, ...extra });
  const hit = (path, status, ago, srv = 'app-server') => { const c = categorize(path); return { ts: now - ago, method: 'GET', path, status, ua: 'Mozilla/5.0 zgrab/0.x', server: srv, cat: c.label, sev: c.sev === 'crit' && status < 300 ? 'crit' : c.sev === 'crit' ? 'warn' : 'info' }; };
  return {
    ...summarize([
      mk('203.0.113.22', 'core-inhouse', { total: 412, err4xx: 398, peak4xx: 240, hits: [hit('/.env', 404, 900), hit('/.git/config', 404, 880), hit('/wp-login.php', 404, 860), hit('/phpmyadmin/', 404, 840)] }),
      mk('203.0.113.18', 'app-server', { ssh: 186 }),
      mk('203.0.113.23', 'app-server', { total: 6, hits: [hit('/fetch?url=http://169.254.169.254/latest/meta-data/', 200, 3600)] }),
      mk('203.0.113.10', 'app-server', { peak4xx: 80 }),
    ]),
    hours: 24, at: Date.now(), demo: true,
  };
}
