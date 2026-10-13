// FortiGate de la sede (INFRA OPS-PPAL) por su API REST — SOLO LECTURA.
//  - Requiere un usuario REST API de solo lectura (perfil "monitoreo-lectura") con trusthost = este servidor.
//  - server/.env:  FORTIGATE_URL=https://192.168.10.253:10443   FORTIGATE_TOKEN=xxxxx
//    (opcional) FORTIGATE_VERIFY_TLS=1 cuando el FortiGate tenga un certificado válido.
//  - El token nunca sale de este servidor. Todo es GET: el panel no puede cambiar nada en el FortiGate.
//  - El FortiGate no tiene disco de logs: la navegación se lee de los logs en memoria (últimas horas).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Primera vez que se vio cada equipo (por MAC), guardado en disco para detectar equipos NUEVOS en la red
const SEEN_FILE = path.join(config.dataDir, 'fg-devices-seen.json');
let seen = null;
function markSeen(devices) {
  if (!seen) { try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch { seen = null; } }
  const first = !seen; seen ||= {};
  let changed = false; const now = Date.now();
  for (const d of devices) { const k = d.mac || d.ip; if (!k) continue; if (!(k in seen)) { seen[k] = first ? 0 : now; changed = true; } d.firstSeen = seen[k]; }
  if (changed) { try { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(SEEN_FILE, JSON.stringify(seen)); } catch { /* sin disco */ } }
}

const URL_ = (process.env.FORTIGATE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.FORTIGATE_TOKEN || '';
const VDOM = process.env.FORTIGATE_VDOM || 'root';
export const fgConfigured = () => !!(URL_ && TOKEN);

// El FortiGate usa un certificado propio (Fortinet_Factory): se acepta SOLO para este host, sin afectar otras conexiones
const agent = new https.Agent({ rejectUnauthorized: process.env.FORTIGATE_VERIFY_TLS === '1', keepAlive: true, maxSockets: 4 });

function get(p, params = {}) {
  const u = new URL(URL_ + '/api/v2/' + p);
  for (const [k, v] of Object.entries({ vdom: VDOM, ...params })) u.searchParams.set(k, v);
  return new Promise((resolve, reject) => {
    const req = https.get(u, { agent, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, timeout: 12000 }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (c) => { b += c; if (b.length > 25e6) req.destroy(new Error('Respuesta demasiado grande')); });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) return reject(Object.assign(new Error('El FortiGate rechazó el token (401/403): revisa FORTIGATE_TOKEN y que el trusthost incluya este servidor'), { status: res.statusCode }));
        if (res.statusCode >= 400) return reject(new Error(`FortiGate ${p}: HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(b)); } catch { reject(new Error(`FortiGate ${p}: respuesta no válida`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('El FortiGate no respondió (¿VPN caída o acceso HTTPS no permitido en la interfaz?)')));
    req.on('error', reject);
  });
}
const soft = async (p, params) => { try { return await get(p, params); } catch (e) { return { __err: e.message }; } };
const R = (x) => (x && !x.__err ? x.results : null);

const cache = {};
async function cached(key, ttl, force, fn) {
  const c = cache[key];
  if (c && !force && Date.now() - c.at < ttl) return { ...c.data, cachedAt: c.at };
  const data = await fn(); cache[key] = { at: Date.now(), data };
  return { ...data, cachedAt: cache[key].at };
}

// ---------------------------------------------------------------- estado del equipo, SD-WAN, VPN, Wi-Fi
export async function fgStatus(force = false) {
  return cached('status', 60e3, force, async () => {
    const [st, res, ha, sdwan, ipsec, ifs, aps, fw, dev] = await Promise.all([
      soft('monitor/system/status'), soft('monitor/system/resource/usage', { resource: 'cpu,mem,session', interval: '1-min' }),
      soft('monitor/system/ha-peer'), soft('monitor/virtual-wan/health-check'), soft('monitor/vpn/ipsec'),
      soft('monitor/system/interface', { interval: '1-min', include_vlan: 'true' }), soft('monitor/wifi/managed_ap'),
      soft('monitor/system/firmware'), soft('monitor/user/device/query'),
    ]);
    const [wcl, wtpCfg, vapCfg, sslv] = await Promise.all([soft('monitor/wifi/client'), soft('cmdb/wireless-controller/wtp'), soft('cmdb/wireless-controller/vap'), soft('monitor/vpn/ssl')]);
    if (st.__err) throw new Error(st.__err);
    const cur = (k) => { const v = R(res)?.[k]; return Array.isArray(v) ? v[0]?.current ?? null : v?.current ?? null; };
    // Plan B (FortiOS 7.4): si resource/usage no trae datos, se leen de performance/status y sin "interval"
    let cpuV = cur('cpu'), memV = cur('mem'), sesV = cur('session');
    if (cpuV == null || memV == null) {
      const [res2, perf] = await Promise.all([soft('monitor/system/resource/usage', { resource: 'cpu,mem,session' }), soft('monitor/system/performance/status')]);
      const c2 = (k) => { const v = R(res2)?.[k]; return Array.isArray(v) ? v[0]?.current ?? null : v?.current ?? null; };
      const P = R(perf) || {};
      cpuV ??= c2('cpu') ?? (P.cpu?.idle != null ? 100 - P.cpu.idle : null);
      memV ??= c2('mem') ?? (P.mem?.total ? (100 * (P.mem.used ?? (P.mem.total - (P.mem.free || 0)))) / P.mem.total : null);
      sesV ??= c2('session');
    }
    const sd = [];
    for (const [hc, members] of Object.entries(R(sdwan) || {})) for (const [m, v] of Object.entries(members || {})) {
      if (!v || typeof v !== 'object') continue;
      sd.push({ check: hc, member: m, status: v.status, latency: v.latency ?? null, jitter: v.jitter ?? null, loss: v.packet_loss ?? null, tx: v.tx_bandwidth ?? null, rx: v.rx_bandwidth ?? null, sla: v.sla_targets_met ?? null });
    }
    const tunnels = (R(ipsec) || []).map((t) => ({
      name: t.name, remote: t.rgwy, up: (t.proxyid || []).some((p) => p.status === 'up'), phase2: (t.proxyid || []).map((p) => ({ name: p.p2name, status: p.status })),
      inBytes: t.incoming_bytes ?? (t.proxyid || []).reduce((a, p) => a + (p.incoming_bytes || 0), 0), outBytes: t.outgoing_bytes ?? (t.proxyid || []).reduce((a, p) => a + (p.outgoing_bytes || 0), 0),
      created: t.creation_time ?? null, dialup: t.type === 'dialup' || !!t.parent_name,
    }));
    const interfaces = Object.values(R(ifs) || {}).map((i) => ({ name: i.name, alias: i.alias || '', link: !!i.link, speed: i.speed ?? null, ip: i.ip || '', tx: i.tx_bytes ?? 0, rx: i.rx_bytes ?? 0, txRate: i.tx_bandwidth ?? i.tx_rate ?? null, rxRate: i.rx_bandwidth ?? i.rx_rate ?? null, errors: (i.rx_errors || 0) + (i.tx_errors || 0) }))
      .filter((i) => i.link || i.tx || i.rx);
    const clients = (R(wcl) || []).map((c) => ({ ip: c.ip || '', mac: c.mac || '', host: c.hostname || c.host || '', user: c.user || '', ssid: c.ssid || c.vap_name || '', ap: c.wtp_name || c.wtp_id || '', apId: c.wtp_id || '', signal: c.signal ?? null, os: [c.os, c.manufacturer].filter(Boolean).join(' · ') }));
    const ssidName = Object.fromEntries((R(vapCfg) || []).map((v) => [v.name, v.ssid || v.name]));
    const wtpInfo = Object.fromEntries((R(wtpCfg) || []).map((w) => [w['wtp-id'], w]));
    const wifi = (R(aps) || []).map((a) => ({ name: a.name || a.wtp_id, serial: a.serial || a.wtp_id, status: a.status, ip: a.connecting_from || a.ip_addr || '', clients: a.clients ?? a.client_count ?? a.sta_count ?? (Array.isArray(a.ssid) ? a.ssid.reduce((t, s) => t + (s.clients || 0), 0) : null), model: a.os_version || a.model || '', uptime: a.join_time_raw ? Date.now() / 1000 - a.join_time_raw : null,
      full: [wtpInfo[a.wtp_id || a.serial]?.name || a.name, wtpInfo[a.wtp_id || a.serial]?.location, wtpInfo[a.wtp_id || a.serial]?.comment].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(' · '),
      ssids: [...new Set([...(Array.isArray(a.ssid) ? a.ssid.map((x) => (typeof x === 'string' ? x : x.ssid || x.name || '')) : []), ...clients.filter((c) => c.apId === (a.wtp_id || a.serial) || c.ap === a.name).map((c) => c.ssid)].filter(Boolean).map((x) => ssidName[x] || x))],
      clientList: clients.filter((c) => c.apId === (a.wtp_id || a.serial) || c.ap === a.name) }));
    const fwr = R(fw) || {};
    const avail = (fwr.available || []).map((v) => `v${v.major}.${v.minor}.${v.patch}`); // versiones publicadas por FortiGuard
    const devices0 = (R(dev) || []).map((d) => ({ ip: d.ipv4_address || '', mac: d.mac || '', host: d.hostname || d.host_src || '', os: [d.os_name, d.os_version].filter(Boolean).join(' '), iface: d.detected_interface || d.interface || '', type: d.hardware_type || d.type || '', vendor: d.hardware_vendor || '', lastSeen: d.last_seen ?? null, online: d.is_online ?? null }));
    const devices = devices0; markSeen(devices);
    // Usuarios conectados por VPN: SSL-VPN (FortiClient modo túnel/web) y VPN IPsec de acceso remoto (dial-up con usuario)
    const vpnUsers = [
      ...(R(sslv) || []).map((u) => {
        const subs = u.subsessions || [];
        return { kind: 'SSL-VPN', user: u.user_name || u.username || '', group: u.group_name || '', from: u.remote_host || '', ip: subs.map((x) => x.aip).filter(Boolean).join(', '),
          mode: subs.length ? [...new Set(subs.map((x) => x.mode).filter(Boolean))].join(', ') || 'túnel' : 'web', since: u.last_login_time ?? null, duration: u.duration ?? null,
          inBytes: subs.reduce((a, x) => a + (x.in_bytes || 0), 0), outBytes: subs.reduce((a, x) => a + (x.out_bytes || 0), 0) };
      }),
      ...(R(ipsec) || []).filter((t) => t.type === 'dialup' || t.parent_name || t.xauth_user || t.username).map((t) => ({
        kind: 'IPsec', user: t.xauth_user || t.username || t.parent_name || t.name, group: t.parent_name || '', from: t.rgwy || '', ip: (t.proxyid || []).map((p) => p.proxy_dst?.[0]?.subnet?.split('/')[0]).filter(Boolean)[0] || '',
        mode: 'túnel', since: null, duration: t.creation_time ?? null,
        inBytes: t.incoming_bytes ?? (t.proxyid || []).reduce((a, p) => a + (p.incoming_bytes || 0), 0), outBytes: t.outgoing_bytes ?? (t.proxyid || []).reduce((a, p) => a + (p.outgoing_bytes || 0), 0) })),
    ];
    return {
      host: st.results?.hostname || st.serial, serial: st.serial, version: st.version, build: st.build, model: st.results?.model_name || st.results?.model || '',
      cpu: cpuV, mem: memV, sessions: sesV,
      ha: (R(ha) || []).map((p) => ({ host: p.hostname, serial: p.serial_no, priority: p.priority, primary: !!p.primary })),
      sdwan: sd, tunnels: tunnels.filter((t) => !t.dialup), vpnUsers, interfaces, wifi, wifiClients: clients, devices, firmwareAvailable: [...new Set(avail)].slice(-5),
      errors: Object.fromEntries(Object.entries({ recursos: res, ha, sdwan, ipsec, interfaces: ifs, wifi: aps, firmware: fw, dispositivos: dev, 'clientes Wi-Fi': wcl, 'usuarios VPN': sslv?.__err && /404/.test(sslv.__err) ? null : sslv }).filter(([, v]) => v?.__err).map(([k, v]) => [k, v.__err])),
    };
  });
}

// ---------------------------------------------------------------- navegación, aplicaciones y amenazas (logs en memoria)
// FortiOS: log/memory/<tipo> (webfilter, app-ctrl, ips, virus) y log/memory/traffic/<subtipo> (forward)
const rows = async (path, n = 1000) => { const r = await soft(`log/memory/${path}`, { rows: n }); return { list: R(r) || [], err: r.__err ? (/404/.test(r.__err) ? null : r.__err) : null }; };
const top = (arr, keyFn, valFn = () => 1, n = 15) => { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!k) continue; m.set(k, (m.get(k) || 0) + valFn(x)); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v })); };
const net24 = (ip) => (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split('.').slice(0, 3).join('.') : '');

export async function fgTraffic(force = false) {
  return cached('traffic', 5 * 60e3, force, async () => {
    const [web, app, ips, av, fwd] = await Promise.all([rows('webfilter', 1000), rows('app-ctrl', 1000), rows('ips', 500), rows('virus', 300), rows('traffic/forward', 1000)]);
    // Sin Web Filter, la navegación se arma con el registro de tráfico permitido (destino, país, servicio y bytes)
    const fromTraffic = !web.list.length && fwd.list.length > 0;
    if (fromTraffic) web.list = fwd.list.map((x) => ({ ...x, hostname: x.hostname || x.dstname || x.dstip, catdesc: x.app || x.appcat || x.service || (x.dstcountry && x.dstcountry !== 'Reserved' ? `Internet · ${x.dstcountry}` : 'Red interna') }));
    const W = web.list.map((x) => ({ ts: `${x.date || ''} ${x.time || ''}`.trim(), src: x.srcip, srcName: x.srcname || x.unauthuser || x.user || '', iface: x.srcintf, host: (x.hostname || '').toLowerCase(), cat: x.catdesc || x.cat || '', action: x.action || '', sent: +x.sentbyte || 0, rcvd: +x.rcvdbyte || 0 }));
    if (!app.list.length) app.list = fwd.list.filter((x) => x.app);
    const A = app.list.map((x) => ({ src: x.srcip, iface: x.srcintf, app: x.app || x.appcat || '', cat: x.appcat || '', risk: x.apprisk || '', action: x.action || '', bytes: (+x.sentbyte || 0) + (+x.rcvdbyte || 0) }));
    const T = [...ips.list.map((x) => ({ kind: 'IPS', ts: `${x.date || ''} ${x.time || ''}`.trim(), name: x.attack || x.msg || '', severity: x.severity || x.crlevel || '', src: x.srcip, dst: x.dstip, action: x.action || '' })),
      ...av.list.map((x) => ({ kind: 'Antivirus', ts: `${x.date || ''} ${x.time || ''}`.trim(), name: x.virus || x.msg || '', severity: 'high', src: x.srcip, dst: x.dstip || x.url || '', action: x.action || '' }))].slice(0, 200);
    // Por equipo (IP de origen): qué sitios abre y qué aplicaciones usa. Une Web Filter, control de aplicaciones y el registro de tráfico.
    const names = {};
    for (const d of cache.status?.data?.devices || []) if (d.ip && d.host) names[d.ip] = d.host;
    for (const c of cache.status?.data?.wifiClients || []) if (c.ip && (c.host || c.user)) names[c.ip] = c.user ? `${c.host || c.ip} (${c.user})` : c.host;
    const F = fromTraffic ? [] : fwd.list.map((x) => ({ country: x.dstcountry || '', src: x.srcip, host: (x.hostname || x.dstname || '').toLowerCase() || x.dstip, app: x.app || '', bytes: (+x.sentbyte || 0) + (+x.rcvdbyte || 0), user: x.unauthuser || x.user || x.srcname || '' }));
    const ipm = {};
    const get = (ip) => (ipm[ip] ||= { ip, name: '', visits: 0, blocked: 0, bytes: 0, sites: new Map(), apps: new Map(), cats: new Map(), countries: new Map(), iface: '' });
    for (const x of W) { if (!x.src) continue; const o = get(x.src); o.visits++; o.iface ||= x.iface; if (x.srcName) o.name ||= x.srcName; if (/block|deny/i.test(x.action)) o.blocked++; if (x.host) o.sites.set(x.host, (o.sites.get(x.host) || 0) + 1); if (x.cat) o.cats.set(x.cat, (o.cats.get(x.cat) || 0) + 1); o.bytes += x.sent + x.rcvd; }
    for (const x of A) { if (!x.src || !x.app) continue; const o = get(x.src); o.iface ||= x.iface; o.apps.set(x.app, (o.apps.get(x.app) || 0) + 1); }
    for (const x of F) { if (!x.src) continue; const o = get(x.src); if (x.user) o.name ||= x.user; if (x.host) o.sites.set(x.host, (o.sites.get(x.host) || 0) + 1); if (x.app) o.apps.set(x.app, (o.apps.get(x.app) || 0) + 1); if (x.country && x.country !== 'Reserved') o.countries.set(x.country, (o.countries.get(x.country) || 0) + 1); o.bytes += x.bytes; }
    const sortM = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
    const byIp = Object.values(ipm).map((o) => ({ ip: o.ip, name: o.name || names[o.ip] || '', net: net24(o.ip), iface: o.iface, visits: o.visits, blocked: o.blocked, bytes: o.bytes, events: [...o.sites.values(), ...o.apps.values()].reduce((t, v) => t + v, 0), sites: sortM(o.sites, 40), apps: sortM(o.apps, 30), cats: sortM(o.cats, 10), countries: sortM(o.countries, 15) }))
      .sort((a, b) => b.events - a.events).slice(0, 400);
    // Por red de origen (/24 = agencia o sede)
    const nets = {};
    for (const x of W) { const n = net24(x.src); if (!n) continue; (nets[n] ||= { net: n, iface: x.iface, req: 0, blocked: 0, users: new Set(), sites: [], cats: [] }); const o = nets[n]; o.req++; if (/block|deny/i.test(x.action)) o.blocked++; if (x.src) o.users.add(x.src); o.sites.push(x); }
    const byNet = Object.values(nets).map((o) => ({ net: o.net, iface: o.iface, req: o.req, blocked: o.blocked, users: o.users.size, topSites: top(o.sites, (x) => x.host, () => 1, 12), topCats: top(o.sites, (x) => x.cat, () => 1, 8) })).sort((a, b) => b.req - a.req);
    return {
      window: W.length ? { from: W[W.length - 1].ts, to: W[0].ts } : null,
      totals: { web: W.length, blocked: W.filter((x) => /block|deny/i.test(x.action)).length, apps: A.length, threats: T.length },
      topSites: top(W, (x) => x.host, () => 1, 20), topCats: top(W, (x) => x.cat, () => 1, 12), blockedSites: top(W.filter((x) => /block|deny/i.test(x.action)), (x) => x.host, () => 1, 12),
      topApps: top(A, (x) => x.app, () => 1, 20).map((a) => ({ ...a, b: A.filter((x) => x.app === a.k).reduce((t, x) => t + x.bytes, 0) })), riskyApps: top(A.filter((x) => /high|critical|elevated/i.test(x.risk)), (x) => x.app, () => 1, 10),
      byNet, byIp, threats: T, onlyBlocked: W.length > 0 && W.every((x) => /block|deny/i.test(x.action)),
      errors: Object.fromEntries([['navegación', web.err], ['aplicaciones', app.err], ['IPS', ips.err], ['antivirus', av.err]].filter(([, e]) => e)),
      source: fromTraffic ? 'trafico' : web.list.length ? 'webfilter' : null,
      hint: !W.length && !web.err ? 'No hay registros de navegación: las políticas de las agencias deben tener Web Filter (modo monitor) y registrar el tráfico permitido.' : fromTraffic ? 'Mostrando el registro de tráfico (destinos por IP y servicio). Para ver nombres de sitios y categorías hay que activar Web Filter en modo monitor en las políticas de las agencias.' : null,
    };
  });
}

// ---------------------------------------------------------------- ping y escaneos de red (logs en memoria, solo lectura)
// Una misma IP que:  · hace ping repetido (ICMP) a un equipo o a muchos equipos de la red (barrido)
//                    · toca muchos puertos distintos de un equipo (escaneo de puertos)
//                    · aparece en los logs de anomalías (política DoS) o firmas IPS de escáner (Nmap, Masscan…)
// Umbrales en server/.env (opcionales): NETSCAN_PORTS=15  NETSCAN_HOSTS=10  NETSCAN_PINGS=30  NETSCAN_IGNORE=ip1,ip2
const NS = { ports: +process.env.NETSCAN_PORTS || 15, hosts: +process.env.NETSCAN_HOSTS || 10, pings: +process.env.NETSCAN_PINGS || 30 };
const NS_IGNORE = new Set((process.env.NETSCAN_IGNORE || '').split(',').map((x) => x.trim()).filter(Boolean));
const isPriv = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');
const SCANNER_SIG = /scan|nmap|masscan|zmap|zgrab|sweep|probe|recon|shodan|censys/i;

export async function fgNetscan(force = false) {
  return cached('netscan', 2 * 60e3, force, async () => {
    const [anom, ips, loc, fwd] = await Promise.all([rows('anomaly', 500), rows('ips', 500), rows('traffic/local', 1000), rows('traffic/forward', 1000)]);
    const ts = (x) => { const e = String(x.eventtime || ''); if (e.length >= 13) return +e.slice(0, 13); if (e.length === 10) return +e * 1000; return Date.parse(`${x.date}T${x.time}`) || null; };
    const by = {};
    const S = (ip) => (by[ip] ||= { ip, pings: 0, pingDst: new Set(), ports: new Map(), dsts: new Set(), denied: 0, events: 0, sigs: new Set(), first: null, last: null, iface: '' });
    const touch = (o, t) => { if (t) { o.first = o.first ? Math.min(o.first, t) : t; o.last = o.last ? Math.max(o.last, t) : t; } };
    const names = {};
    for (const d of cache.status?.data?.devices || []) if (d.ip && d.host) names[d.ip] = d.host;
    for (const x of [...loc.list, ...fwd.list]) {
      const src = x.srcip, dst = x.dstip; if (!src || !dst || NS_IGNORE.has(src) || src === dst) continue;
      const o = S(src); o.events++; o.iface ||= x.srcintf || ''; touch(o, ts(x)); o.dsts.add(dst);
      if (/deny|block|drop/i.test(x.action || '')) o.denied++;
      if (+x.proto === 1 || /icmp|ping/i.test(x.service || '')) { o.pings++; o.pingDst.add(dst); }
      else if (x.dstport) { const m = o.ports.get(dst) || new Set(); m.add(+x.dstport); o.ports.set(dst, m); }
    }
    for (const x of anom.list) { if (!x.srcip || NS_IGNORE.has(x.srcip)) continue; const o = S(x.srcip); o.sigs.add(`Anomalía: ${x.attack || x.msg || 'DoS'}`); o.events += +x.count || 1; touch(o, ts(x)); if (x.dstip) o.dsts.add(x.dstip); }
    for (const x of ips.list) { const n = x.attack || x.msg || ''; if (!x.srcip || NS_IGNORE.has(x.srcip) || !SCANNER_SIG.test(n)) continue; const o = S(x.srcip); o.sigs.add(`IPS: ${n}`); o.events++; touch(o, ts(x)); if (x.dstip) o.dsts.add(x.dstip); }
    const scanners = [];
    for (const o of Object.values(by)) {
      const kinds = [];
      const maxPorts = Math.max(0, ...[...o.ports.values()].map((s) => s.size));
      const privTargets = [...o.dsts].filter(isPriv);
      if (maxPorts >= NS.ports) kinds.push(`Escaneo de puertos (${maxPorts} puertos en un equipo)`);
      if (o.pingDst.size >= NS.hosts) kinds.push(`Barrido de ping (${o.pingDst.size} equipos)`);
      else if (o.pings >= NS.pings) kinds.push(`Ping repetido (${o.pings} veces)`);
      const sweep = new Map(); // mismo puerto en muchos equipos internos
      for (const [d, s] of o.ports) if (isPriv(d)) for (const p of s) sweep.set(p, (sweep.get(p) || 0) + 1);
      const [swPort, swN] = [...sweep.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (swN >= NS.hosts && ![53, 80, 443, 123].includes(swPort)) kinds.push(`Barrido del puerto ${swPort} (${swN} equipos)`);
      for (const s of o.sigs) kinds.push(s);
      if (!kinds.length) continue;
      const external = !isPriv(o.ip);
      const targets = [...(o.pingDst.size ? o.pingDst : []), ...[...o.ports.entries()].sort((a, b) => b[1].size - a[1].size).map(([d]) => d), ...privTargets].filter((v, i, a) => a.indexOf(v) === i).slice(0, 12).map((ip) => ({ ip, name: names[ip] || '' }));
      const topPorts = [...new Set([...o.ports.values()].flatMap((s) => [...s]))].sort((a, b) => a - b).slice(0, 40);
      scanners.push({ ip: o.ip, name: names[o.ip] || '', source: 'FortiGate', external, iface: o.iface, kinds, pings: o.pings, ports: maxPorts, hosts: o.dsts.size, denied: o.denied, events: o.events, targets, topPorts, first: o.first, last: o.last,
        sev: o.sigs.size || (external && maxPorts >= NS.ports) ? 'crit' : maxPorts >= NS.ports || swN >= NS.hosts || o.pingDst.size >= NS.hosts ? 'warn' : 'info' });
    }
    scanners.sort((a, b) => ({ crit: 0, warn: 1, info: 2 }[a.sev] - { crit: 0, warn: 1, info: 2 }[b.sev]) || b.events - a.events);
    const all = [...loc.list, ...fwd.list].map(ts).filter(Boolean);
    return {
      thresholds: NS, scanners: scanners.slice(0, 100),
      window: all.length ? { from: Math.min(...all), to: Math.max(...all) } : null,
      logs: { local: loc.list.length, forward: fwd.list.length, anomaly: anom.list.length },
      errors: Object.fromEntries([['tráfico local', loc.err], ['tráfico', fwd.err], ['anomalías', anom.err]].filter(([, e]) => e)),
      hint: !loc.list.length ? 'El FortiGate no está registrando el tráfico que llega a él mismo (pings y conexiones rechazadas desde Internet). Pídele al proveedor activar "Log denied local-in traffic" y una política DoS en modo monitor (anomalías: tcp_port_scan, icmp_sweep, icmp_flood): solo registra, no bloquea.' : null,
    };
  });
}

// ---------------------------------------------------------------- eventos recientes de túneles y enlaces (para explicar una caída en el correo)
export async function fgLinkEvents() {
  const [vpn, sys, sd] = await Promise.all([rows('event/vpn', 400), rows('event/system', 400), rows('event/sdwan', 300)]);
  const pick = (x) => ({ ts: Date.parse(`${x.date}T${x.time}`) || null, tunnel: x.vpntunnel || '', iface: x.interface || x.member || '', action: x.action || x.status || '', msg: String(x.logdesc || x.msg || '').slice(0, 140), remip: x.remip || '' });
  return [
    ...vpn.list.filter((x) => /(phase[12]-)?(up|down)|tunnel-(up|down)|dpd/i.test(`${x.action} ${x.logdesc}`) && x.vpntunnel).map(pick),
    ...sys.list.filter((x) => /link|interface.*(up|down)|(up|down).*interface/i.test(`${x.logdesc} ${x.msg}`)).map(pick),
    ...sd.list.filter((x) => /(dead|alive|down|up|fail|sla)/i.test(`${x.logdesc} ${x.msg} ${x.status}`)).map(pick),
  ].filter((e) => e.ts).sort((a, b) => b.ts - a.ts);
}
