// Alertas por correo (Microsoft 365 / Graph): SOLO cuando algo se cae y cuando vuelve.
//  - Configuración → Alertas por correo: cada correo elige qué notificaciones recibe (agencia caída, VPN, empresa.com, SSL…).
//  - Un problema se avisa UNA vez cuando se confirma la caída (2 revisiones seguidas ≈ 2 min) y otra vez cuando se restablece,
//    con lo que pasó (enlaces, túneles, eventos del FortiGate) y cuánto duró. Nunca se repite mientras siga caído.
// Envío: aplicación de Entra ID (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET, o MAIL_*) con permiso de APLICACIÓN Mail.Send.
// Sin buzón dedicado: el correo sale de la cuenta indicada en "Enviar desde" o, si está vacío, de la del primer destinatario.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { fgConfigured, fgLinkEvents, fgNetscan, fgStatus } from './fortigate.js';
import { synoConfigured, synoStatus } from './synology.js';
import { azConfigured, azStatus } from './azure.js';

const TEN = process.env.MAIL_TENANT_ID || process.env.AZURE_TENANT_ID || '';
const CID = process.env.MAIL_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
const SEC = process.env.MAIL_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';
export const mailConfigured = () => !!(TEN && CID && SEC);
const PUBLIC = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const NODE_JOBS = process.env.NODE_JOBS || 'node_exporter|ec2_nodes|node|azure_nodes';
const MAIN_SITE = new RegExp(`^https?://(www\\.)?(${(process.env.NOTIFY_MAIN_SITE || 'empresa.com').replace(/\./g, '\\.')})/?$`, 'i');
const SSL_DAYS = Number(process.env.NOTIFY_SSL_DAYS) || 3;

// Catálogo de notificaciones (lo que se ve en Configuración). def = viene marcada para los correos nuevos.
export const ITEMS = {
  agencia: { group: 'Red', label: 'Agencia sin conexión / restablecida', desc: 'Qué agencia se cayó, por qué enlace y cuándo volvió', def: true, link: '#/red' },
  vpn_aws: { group: 'Red', label: 'Túnel VPN AWS ↔ sede caído / restablecido', desc: 'Sin conexión entre AWS y la sede principal', def: true, link: '#/red' },
  fortigate: { group: 'Red', label: 'FortiGate de la sede sin respuesta', desc: 'El panel no puede consultar el FortiGate (con la VPN arriba)', def: false, link: '#/firewall' },
  sitio_principal: { group: 'Sitios web', label: 'Página empresa.com caída / restablecida', desc: 'La página principal no responde desde AWS', def: true, link: '#/sitios' },
  sitios: { group: 'Sitios web', label: 'Otros sitios web caídos / restablecidos', desc: 'Cualquier otro sitio monitoreado', def: false, link: '#/sitios' },
  ssl: { group: 'Sitios web', label: `Certificado SSL a ${SSL_DAYS} días de vencer`, desc: 'Un solo aviso por certificado; otro cuando se renueve', def: true, link: '#/sitios' },
  servidor: { group: 'Servidores', label: 'Servidor sin respuesta / restablecido', desc: 'El agente de monitoreo del servidor no responde', def: false, link: '#/' },
  disco: { group: 'Servidores', label: 'Disco de servidor casi lleno (≥ 95 %)', desc: 'Un aviso al llegar y otro al liberarse', def: false, link: '#/' },
  nas: { group: 'NAS Synology', label: 'Falla grave en un NAS', desc: 'Disco fallando, RAID degradado, ventilador o NAS sin respuesta', def: false, link: '#/' },
  azure_vpn: { group: 'Nube', label: 'VPN de Azure desconectada / restablecida', desc: '', def: false, link: '#/' },
  azure_vm: { group: 'Nube', label: 'Máquina de Azure apagada / encendida', desc: '', def: false, link: '#/' },
  ataque: { group: 'Seguridad', label: 'Ataque crítico (ruta peligrosa respondió 200)', desc: 'Posible fuga de .env, .git o credenciales de AWS', def: false, link: '#/soc', once: true },
  fuerza_bruta: { group: 'Seguridad', label: 'Fuerza bruta SSH', desc: 'Más de 20 intentos fallidos en 10 min desde una IP', def: false, link: '#/soc', once: true },
  escaneo: { group: 'Seguridad', label: 'Escaneo o ping desde una misma IP', desc: 'Escaneo de puertos, barrido de ping, escaneo web', def: false, link: '#/soc', once: true },
};
const DEF_ITEMS = Object.keys(ITEMS).filter((k) => ITEMS[k].def);
const CONFIRM_NOW = new Set(['ataque', 'fuerza_bruta', 'escaneo', 'ssl']); // no esperan 2 revisiones

const CFG_FILE = () => path.join(config.dataDir, 'notify.json');
const ST_FILE = () => path.join(config.dataDir, 'notify-state.json');
const STATE_V = 2;
const DEFAULT_TO = (process.env.NOTIFY_DEFAULT_TO || 'admin@empresa.com,admin@empresa.com').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY_CFG = () => ({ enabled: true, sender: '', recipients: DEFAULT_TO.map((email) => ({ email, items: [...DEF_ITEMS], enabled: true })) });
let cfg = null, st = null, running = false;
const status = { lastRun: null, lastError: null, collectorErrors: {}, lastSend: null };

async function readJson(f, dflt) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return dflt; } }
async function writeJson(f, v) { await fs.mkdir(config.dataDir, { recursive: true }); const t = `${f}.${process.pid}.tmp`; await fs.writeFile(t, JSON.stringify(v, null, 2)); await fs.rename(t, f); }
async function loadCfg() {
  if (cfg) return cfg;
  const raw = await readJson(CFG_FILE(), null);
  if (!raw) cfg = EMPTY_CFG();
  else if (!raw.recipients && raw.rules) { // formato anterior (reglas por categoría) → un renglón por correo con las notificaciones por defecto
    const emails = [...new Set(raw.rules.flatMap((r) => r.emails || []))];
    cfg = { enabled: raw.enabled !== false, sender: raw.sender || '', recipients: (emails.length ? emails : DEFAULT_TO).map((email) => ({ email, items: [...DEF_ITEMS], enabled: true })) };
  } else cfg = raw;
  return cfg;
}
async function loadSt() {
  if (!st) { const raw = await readJson(ST_FILE(), null); st = raw?.v === STATE_V ? raw : { v: STATE_V, active: {}, lastGood: {}, log: raw?.log || [], baseline: true }; }
  return st;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export function validate(input) {
  const out = { enabled: !!input?.enabled, sender: String(input?.sender || '').trim().toLowerCase(), recipients: [] };
  if (out.sender && !EMAIL.test(out.sender)) throw new Error('El correo de "Enviar desde" no es válido');
  const seen = new Set();
  for (const r of (Array.isArray(input?.recipients) ? input.recipients : []).slice(0, 60)) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email)) throw new Error(`Correo no válido: ${email}`);
    if (seen.has(email)) continue; seen.add(email);
    out.recipients.push({ email, items: (Array.isArray(r.items) ? r.items : []).filter((i) => ITEMS[i]), enabled: r.enabled !== false });
  }
  return out;
}
const senderFor = (c, to) => c.sender || to[0];

export async function getNotify() {
  const c = await loadCfg(), s = await loadSt();
  const active = Object.values(s.active).filter((a) => a.notified).map((a) => ({ key: a.ev.key, item: a.ev.item, sev: a.ev.sev, title: a.ev.title, since: a.first }));
  return { config: c, items: ITEMS, configured: mailConfigured(), status, active: active.sort((a, b) => a.since - b.since), log: s.log.slice(0, 60) };
}
export async function saveNotify(input) { const v = validate(input); cfg = v; await writeJson(CFG_FILE(), v); return v; }

// ---------------------------------------------------------------- Microsoft Graph
let tok = null;
async function graphToken() {
  if (tok && tok.exp - Date.now() > 120e3) return tok.v;
  const r = await fetch(`https://login.microsoftonline.com/${TEN}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: SEC, scope: 'https://graph.microsoft.com/.default' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft rechazó las credenciales de la aplicación: ${j.error_description?.split('\n')[0] || j.error || r.status}`);
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.v;
}
export async function sendMail(sender, to, subject, html) {
  if (!mailConfigured()) throw new Error('Faltan AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET en el .env del servidor');
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${await graphToken()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: to.map((a) => ({ emailAddress: { address: a } })) }, saveToSentItems: false }),
  });
  if (r.status === 202) return true;
  const j = await r.json().catch(() => ({}));
  const code = j.error?.code || r.status;
  if (r.status === 403 || code === 'ErrorAccessDenied' || code === 'Authorization_RequestDenied') throw new Error('Sin permiso para enviar: la aplicación necesita el permiso de APLICACIÓN "Mail.Send" de Microsoft Graph con consentimiento de administrador');
  if (r.status === 404 || code === 'ErrorInvalidUser' || code === 'MailboxNotEnabledForRESTAPI') throw new Error(`La cuenta ${sender} no existe o no tiene buzón en Microsoft 365`);
  throw new Error(`Microsoft Graph: ${j.error?.message || code}`);
}

// ---------------------------------------------------------------- recolectores (solo lectura). Cada uno es dueño de unas notificaciones.
async function prom(expr) {
  const r = await fetch(`${config.promUrl}/api/v1/query?query=${encodeURIComponent(expr)}`, { signal: AbortSignal.timeout(10000) });
  const j = await r.json(); if (j.status !== 'success') throw new Error(j.error || 'Prometheus'); return j.data.result;
}
async function loki(expr) {
  const r = await fetch(`${config.lokiUrl}/loki/api/v1/query?query=${encodeURIComponent(expr)}&time=${Date.now()}000000`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json(); if (j.status !== 'success') throw new Error(j.error || 'Loki'); return j.data.result || [];
}
const hostOf = (m) => m.nombre || m.host || m.servidor || m.instance || '?';
const E = (item, key, title, detail = '', extra = {}) => ({ item, key: `${item}|${key}`, sev: 'crit', title, detail, ...extra });
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const HTTP_MSG = (code) => (!code ? 'no responde (sin conexión, tiempo agotado, DNS o certificado)' : code >= 500 ? `responde con error del servidor (HTTP ${code})` : code >= 400 ? `responde con error HTTP ${code}` : `respuesta inesperada (HTTP ${code})`);

const COLLECTORS = {
  sitios: {
    items: ['sitio_principal', 'sitios', 'ssl'],
    async run() {
      const out = [];
      const codes = Object.fromEntries((await prom('probe_http_status_code{job=~"blackbox_http.*"}')).map((x) => [x.metric.instance, +x.value[1]]));
      for (const x of await prom('max_over_time(probe_success{job=~"blackbox_http.*"}[2m]) == 0')) {
        const u = x.metric.instance, main = MAIN_SITE.test(u);
        out.push(E(main ? 'sitio_principal' : 'sitios', u, `${main ? 'La página' : 'El sitio'} ${u.replace(/^https?:\/\//, '')} está ${main ? 'caída' : 'caído'}`, `Desde AWS el sitio ${HTTP_MSG(codes[u])}.`, { resolvedTitle: `${main ? 'La página' : 'El sitio'} ${u.replace(/^https?:\/\//, '')} volvió a funcionar` }));
      }
      for (const x of await prom(`(probe_ssl_earliest_cert_expiry{job=~"blackbox_http.*"} - time()) / 86400 < ${SSL_DAYS}`)) {
        const d = Math.floor(+x.value[1]), u = x.metric.instance.replace(/^https?:\/\//, '');
        out.push(E('ssl', x.metric.instance, `Certificado SSL de ${u} ${d < 0 ? 'VENCIDO' : d === 0 ? 'vence HOY' : `vence en ${d} día${d === 1 ? '' : 's'}`}`, 'Renueva el certificado antes de que los navegadores muestren error de seguridad.', { resolvedTitle: `Certificado SSL de ${u} renovado` }));
      }
      return out;
    },
  },
  servidores: {
    items: ['servidor', 'disco'],
    async run() {
      const out = [];
      for (const x of await prom(`up{job=~"${NODE_JOBS}"} == 0`)) out.push(E('servidor', x.metric.instance, `Servidor sin respuesta: ${hostOf(x.metric)}`, `El agente de monitoreo (${x.metric.job}) no responde: el servidor puede estar apagado, sin red o con el agente detenido.`, { resolvedTitle: `Servidor ${hostOf(x.metric)} responde de nuevo` }));
      for (const x of await prom('100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|devtmpfs|nfs.*|cifs"} / node_filesystem_size_bytes) >= 95')) {
        out.push(E('disco', `${x.metric.instance}|${x.metric.mountpoint}`, `Disco ${x.metric.mountpoint} de ${hostOf(x.metric)} al ${(+x.value[1]).toFixed(0)}%`, 'Si se llena, las aplicaciones y bases de datos de ese servidor pueden dejar de funcionar.', { resolvedTitle: `Disco ${x.metric.mountpoint} de ${hostOf(x.metric)} ya está por debajo del 95 %` }));
      }
      return out;
    },
  },
  vpn: {
    items: ['vpn_aws'],
    async run() {
      return (await prom('max_over_time(probe_success{job="red_sede",capa="vpn"}[2m]) == 0')).map((x) => E('vpn_aws', 'sede', 'Túnel VPN AWS ↔ sede principal caído',
        `Desde AWS no responde ${x.metric.instance} (sede principal) por la VPN desde hace más de 2 minutos. Mientras tanto no se puede monitorear la sede ni las agencias. Revisar el Internet de la sede y VPN → IPsec Tunnels (VPN-AWS) en el FortiGate.`, { resolvedTitle: 'Túnel VPN AWS ↔ sede principal restablecido' }));
    },
  },
  red: {
    items: ['agencia', 'fortigate'],
    async run(s) {
      if (!fgConfigured()) return [];
      // Si la VPN con la sede está caída no se puede saber nada de las agencias: no se marcan (lo cubre "vpn_aws")
      const vpnDown = (await prom('max_over_time(probe_success{job="red_sede",capa="vpn"}[2m]) == 0').catch(() => [])).length > 0;
      if (vpnDown) throw new Error('VPN caída');
      let fs_; try { fs_ = await fgStatus(); } catch (e) { return [E('fortigate', 'api', 'El FortiGate de la sede no responde al panel', `${e.message}. La VPN con la sede está arriba, así que puede ser el servicio HTTPS de administración o el token.`, { resolvedTitle: 'El FortiGate de la sede responde de nuevo' })]; }
      const checks = {};
      for (const m of fs_.sdwan || []) if (/^lo_/i.test(m.check)) (checks[m.check] ||= []).push(m);
      const alive = (m) => /^(alive|up)$/i.test(m.status || '');
      const names = Object.keys(checks), downs = names.filter((c) => !checks[c].some(alive));
      s.lastGood ||= {};
      for (const c of names) { const best = checks[c].filter(alive).sort((a, b) => (a.latency ?? 1e9) - (b.latency ?? 1e9))[0]; if (best) s.lastGood[c] = { member: best.member, lat: best.latency, loss: best.loss, at: Date.now() }; }
      const label = (c) => c.replace(/^lo_/i, '').replace(/_/g, ' ');
      const allDown = downs.length > 1 && downs.length === names.length;
      return downs.map((c) => {
        const lg = s.lastGood[c], tun = (fs_.tunnels || []).filter((t) => norm(t.name).includes(norm(label(c))));
        const parts = [
          allDown ? `Cayeron las ${downs.length} agencias al mismo tiempo: la falla está en la sede principal (túnel hacia las agencias / Internet de la sede), no en cada agencia.` : 'La prueba de salud del SD-WAN no responde por ningún enlace: falla el Internet de la agencia o su equipo.',
          `Enlaces: ${checks[c].map((m) => `${m.member} ${alive(m) ? 'arriba' : 'sin respuesta'}`).join(' · ')}.`,
          tun.length ? `Túnel IPsec: ${tun.map((t) => `${t.name} ${t.up ? 'arriba' : 'caído'}`).join(' · ')}.` : '',
          lg ? `Último dato bueno: ${lg.member}, ${lg.lat?.toFixed?.(1) ?? lg.lat} ms, pérdida ${lg.loss ?? 0}% (${fmtT(lg.at)}).` : '',
        ].filter(Boolean);
        return E('agencia', c, `Agencia ${label(c)} sin conexión`, parts.join(' '), { agencyCheck: c, resolvedTitle: `Agencia ${label(c)} restablecida` });
      });
    },
  },
  seguridad: {
    items: ['ataque', 'fuerza_bruta', 'escaneo'],
    async run() {
      const out = [];
      const W = '{job=~"nginx|apache", tipo="acceso"}';
      for (const x of await loki(`sum by (servidor, ip) (count_over_time(${W} |~ \`(?i)(/\\.env|/\\.git/|/\\.aws|169\\.254\\.169\\.254|/latest/meta-data|/etc/passwd|\\.\\./\\.\\./|/config\\.json|/dump\\.sql)\` | regexp \`^(?P<ip>\\S+) .*?" (?P<status>\\d{3}) \` | status=~"2.." [10m])) > 0`).catch(() => []))
        out.push(E('ataque', `${x.metric.ip}|${x.metric.servidor || ''}`, `Ruta peligrosa respondió 200 a ${x.metric.ip} en ${x.metric.servidor || 'un servidor'}`, 'Posible fuga de información (.env, .git, metadatos de AWS…). Revisar de inmediato el sitio y rotar credenciales si aplica.'));
      for (const x of await loki('sum by (servidor, ip) (count_over_time({job="auth"} |~ `Failed password|Invalid user` | regexp `from (?P<ip>[0-9a-fA-F:.]+)` [10m])) > 20').catch(() => []))
        out.push(E('fuerza_bruta', `${x.metric.ip}|${x.metric.servidor || ''}`, `Fuerza bruta SSH desde ${x.metric.ip} contra ${x.metric.servidor || 'un servidor'}`, `${Math.round(+x.value[1])} intentos fallidos en 10 min (fail2ban debería bloquearla).`));
      if (fgConfigured()) for (const sc of (await fgNetscan().catch(() => null))?.scanners || []) if (sc.sev !== 'info')
        out.push(E('escaneo', sc.ip, `${sc.kinds[0].split(' (')[0]} desde ${sc.ip}${sc.external ? ' (Internet)' : ' (red interna)'}`, `${sc.kinds.join(' · ')} · contra ${sc.targets.slice(0, 5).map((t) => t.name || t.ip).join(', ')}`));
      for (const x of await prom('infra_netscan_ports >= 15 or infra_netscan_pings >= 30').catch(() => []))
        out.push(E('escaneo', x.metric.ip, `${x.metric.__name__ === 'infra_netscan_ports' ? 'Escaneo de puertos' : 'Ping repetido'} desde ${x.metric.ip} contra ${x.metric.instance}`, ''));
      for (const x of await loki(`sum by (servidor, ip) (count_over_time(${W} | regexp \`^(?P<ip>\\S+) .*?" (?P<status>\\d{3}) \` | status=~"4.." [10m])) > 50`).catch(() => []))
        out.push(E('escaneo', `${x.metric.ip}`, `Escaneo web desde ${x.metric.ip} contra ${x.metric.servidor || 'un servidor'}`, `${Math.round(+x.value[1])} errores 4xx en 10 min.`));
      return out;
    },
  },
  nas: {
    items: ['nas'],
    async run() {
      if (!synoConfigured()) return [];
      const out = [];
      for (const n of (await synoStatus()).nas || []) {
        const nm = /nas/i.test(n.name) ? n.name : `NAS ${n.name}`;
        if (!n.ok) { out.push(E('nas', `off|${n.host}`, `${nm} sin respuesta`, n.error || '', { resolvedTitle: `${nm} responde de nuevo` })); continue; }
        for (const i of n.issues || []) if (i.sev === 'crit' && !/(pool|grupo).*capacidad/i.test(i.msg)) out.push(E('nas', `${n.host}|${i.msg.replace(/\d+/g, '#')}`, `${nm}: ${i.msg}`, '', { resolvedTitle: `${nm}: resuelto «${i.msg}»` }));
      }
      return out;
    },
  },
  nube: {
    items: ['azure_vpn', 'azure_vm'],
    async run() {
      if (!azConfigured()) return [];
      const s = await azStatus(), out = [];
      for (const v of s.vms || []) if (v.power && !['running', 'unknown'].includes(v.power)) out.push(E('azure_vm', v.name, `Máquina de Azure ${v.name} ${v.power === 'deallocated' ? 'apagada (desasignada)' : v.power}`, '', { resolvedTitle: `Máquina de Azure ${v.name} encendida` }));
      for (const c of s.vpns || []) if (c.status && c.status !== 'Connected') out.push(E('azure_vpn', c.name, `VPN de Azure ${c.name} desconectada (${c.status})`, '', { resolvedTitle: `VPN de Azure ${c.name} conectada` }));
      return out;
    },
  },
};

// ---------------------------------------------------------------- correo
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function fmtT(ms) { return new Date(ms).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
const dur = (ms) => { const m = Math.max(1, Math.round(ms / 60e3)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };
function emailHtml(msgs) {
  const rows = msgs.map((m) => {
    const ok = m.kind === 'restablecido', once = ITEMS[m.ev.item]?.once;
    const tag = ok ? ['RESTABLECIDO', '#16A34A'] : once ? ['ALERTA', '#D97706'] : ['CAÍDA', '#DC2626'];
    return `<tr><td style="padding:12px 14px;border-bottom:1px solid #e5e7eb">
      <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600;color:#fff;background:${tag[1]}">${tag[0]}</span>
      <span style="font-size:12px;color:#6b7280;margin-left:6px">${esc(ITEMS[m.ev.item]?.group || '')}</span>
      <div style="font-size:15px;font-weight:600;color:#111827;margin-top:6px">${esc(ok ? (m.ev.resolvedTitle || `Resuelto: ${m.ev.title}`) : m.ev.title)}</div>
      ${ok ? `<div style="color:#374151;font-size:13px;margin-top:4px">Volvió: ${fmtT(m.at)} · estuvo sin servicio <b>${dur(m.at - m.since)}</b> (desde ${fmtT(m.since)})</div>` : `<div style="color:#374151;font-size:13px;margin-top:4px">Detectado: ${fmtT(m.since)}</div>`}
      ${m.ev.detail && !ok ? `<div style="color:#374151;font-size:13px;margin-top:6px"><b>Qué pasó:</b> ${esc(m.ev.detail)}</div>` : ''}
      ${m.extra ? `<div style="color:#374151;font-size:13px;margin-top:6px">${esc(m.extra)}</div>` : ''}
      ${m.events?.length ? `<div style="font-size:12px;color:#4b5563;margin-top:6px"><b>Eventos del FortiGate:</b><br>${m.events.map((e) => `${fmtT(e.ts)} · ${esc(e.tunnel || e.iface)} · ${esc(e.action)} ${esc(e.msg)}`).join('<br>')}</div>` : ''}
      ${PUBLIC ? `<div style="margin-top:8px"><a href="${PUBLIC}/${ITEMS[m.ev.item]?.link || ''}" style="color:#0e7490;font-size:12.5px">Ver en el panel de monitoreo</a></div>` : ''}
    </td></tr>`;
  }).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto">
  <div style="background:#081318;color:#e2e8f0;padding:14px 18px;border-radius:8px 8px 0 0"><b style="color:#3CC6DA">INFRANCAFÉ</b> · Monitoreo</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:0">${rows}</table>
  <p style="font-size:11.5px;color:#9ca3af">Correo automático del panel de monitoreo. Qué notificaciones te llegan se cambia en Configuración → Alertas por correo.</p></div>`;
}
function subjectFor(msgs) {
  const m = msgs[0], ok = m.kind === 'restablecido', once = ITEMS[m.ev.item]?.once;
  const more = msgs.length > 1 ? ` (+${msgs.length - 1} más)` : '';
  if (ok && msgs.every((x) => x.kind === 'restablecido')) return `[RESTABLECIDO] ${m.ev.resolvedTitle || `Resuelto: ${m.ev.title}`} · ${dur(m.at - m.since)} sin servicio${more}`;
  return `${once ? '[ALERTA]' : '[CAÍDA]'} ${m.ev.title}${more}`;
}

// Al restablecerse: qué dijo el FortiGate en ese intervalo (túneles/enlaces) y cómo quedó
async function recoveryInfo(a) {
  const out = {};
  if (!['agencia', 'vpn_aws'].includes(a.ev.item) || !fgConfigured()) return out;
  try {
    const ev = await fgLinkEvents();
    const want = a.ev.item === 'vpn_aws' ? /vpn-?aws/i : new RegExp(`BBRANCHES|${norm((a.ev.agencyCheck || '').replace(/^lo_/i, '')).slice(0, 6) || 'zzzz'}|wan|port`, 'i');
    out.events = ev.filter((e) => e.ts >= a.first - 5 * 60e3 && want.test(`${e.tunnel} ${e.iface} ${e.msg}`)).slice(0, 6);
  } catch { /* sin eventos */ }
  if (a.ev.item === 'agencia') {
    try { const s = await fgStatus(); const m = (s.sdwan || []).filter((x) => x.check === a.ev.agencyCheck && /^(alive|up)$/i.test(x.status || '')).sort((x, y) => (x.latency ?? 1e9) - (y.latency ?? 1e9))[0]; if (m) out.extra = `Ahora conectada por ${m.member}: ${m.latency?.toFixed?.(1) ?? m.latency} ms, pérdida ${m.loss ?? 0}%.`; } catch { /* sin datos */ }
  }
  return out;
}

// ---------------------------------------------------------------- motor
async function runOnce() {
  if (running) return; running = true;
  try {
    const c = await loadCfg(), s = await loadSt(), now = Date.now();
    const evs = new Map(), failedItems = new Set(); status.collectorErrors = {};
    await Promise.all(Object.entries(COLLECTORS).map(async ([k, col]) => {
      try { for (const e of await col.run(s)) evs.set(e.key, e); } catch (e) { if (e.message !== 'VPN caída') status.collectorErrors[k] = e.message; col.items.forEach((i) => failedItems.add(i)); }
    }));
    const fresh = [], resolved = [];
    for (const [key, ev] of evs) {
      const a = s.active[key] ||= { ev, first: now, count: 0, missing: 0, notified: false, sent: [] };
      a.ev = ev; a.count++; a.missing = 0;
      if (!a.notified && (a.count >= 2 || CONFIRM_NOW.has(ev.item))) { a.notified = true; a.confirmedAt = now; fresh.push(a); }
    }
    for (const [key, a] of Object.entries(s.active)) {
      if (evs.has(key) || failedItems.has(a.ev.item)) continue; // si la fuente no respondió, no se da por resuelto
      a.missing++;
      if (!a.notified) { delete s.active[key]; continue; }
      if (a.missing >= 2) { delete s.active[key]; if (!ITEMS[a.ev.item]?.once) resolved.push(a); }
    }
    const baseline = s.baseline; s.baseline = false;
    if (c.enabled && !baseline && (fresh.length || resolved.length)) {
      const info = new Map(await Promise.all(resolved.map(async (a) => [a, await recoveryInfo(a)])));
      // Mensajes por destinatario y agrupados: quienes reciben exactamente lo mismo van en un solo correo
      const groups = new Map();
      for (const r of c.recipients) {
        if (!r.enabled) continue;
        const msgs = [
          ...fresh.filter((a) => r.items.includes(a.ev.item)).map((a) => ({ a, ev: a.ev, kind: 'caida', since: a.first })),
          ...resolved.filter((a) => r.items.includes(a.ev.item) && a.sent?.includes(r.email)).map((a) => ({ a, ev: a.ev, kind: 'restablecido', since: a.first, at: now, ...info.get(a) })),
        ];
        if (!msgs.length) continue;
        const sig = msgs.map((m) => `${m.kind}:${m.ev.key}`).sort().join('|');
        const g = groups.get(sig) || { msgs, to: [] }; g.to.push(r.email); groups.set(sig, g);
      }
      for (const { msgs, to } of groups.values()) {
        msgs.sort((x, y) => (x.kind === 'restablecido') - (y.kind === 'restablecido') || x.since - y.since);
        const subject = subjectFor(msgs), from = senderFor(c, to);
        const entry = { at: now, from, to, subject, count: msgs.length, ok: true };
        try { await sendMail(from, to, subject, emailHtml(msgs)); for (const m of msgs) if (m.kind === 'caida') m.a.sent = [...new Set([...(m.a.sent || []), ...to])]; status.lastSend = now; status.lastError = null; }
        catch (e) { entry.ok = false; entry.error = e.message; status.lastError = e.message; for (const m of msgs) if (m.kind === 'caida' && !(m.a.sent || []).length) m.a.notified = false; } // se reintenta en la próxima revisión
        s.log.unshift(entry);
      }
      s.log = s.log.slice(0, 200);
    }
    status.lastRun = now;
    await writeJson(ST_FILE(), s);
  } catch (e) { status.lastError = e.message; console.error('[notify]', e.message); } finally { running = false; }
}

export async function sendTest(emails, who) {
  const c = await loadCfg();
  const to = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)))];
  if (!to.length) throw new Error('No hay correos válidos para la prueba');
  const now = Date.now();
  const html = emailHtml([
    { ev: { item: 'agencia', title: 'Agencia Ejemplo sin conexión (PRUEBA)', detail: `Este es un correo de prueba enviado por ${who}. Así se verá un aviso de caída.` }, kind: 'caida', since: now - 60e3 },
    { ev: { item: 'agencia', title: 'Agencia Ejemplo sin conexión (PRUEBA)', resolvedTitle: 'Agencia Ejemplo restablecida (PRUEBA)' }, kind: 'restablecido', since: now - 13 * 60e3, at: now, extra: 'Y así se verá cuando vuelva.' },
  ]);
  const from = senderFor(c, to);
  await sendMail(from, to, '[PRUEBA] Alertas del panel de monitoreo la empresa', html);
  const s = await loadSt(); s.log.unshift({ at: now, from, to, subject: 'Correo de prueba', count: 1, ok: true }); await writeJson(ST_FILE(), s);
  return to;
}

export function startNotify() {
  setTimeout(() => runOnce(), 20e3);
  setInterval(() => runOnce(), 60e3).unref();
  console.log(`[notify] Alertas por correo: ${mailConfigured() ? 'credenciales listas' : 'sin credenciales (AZURE_* o MAIL_*)'}`);
}
