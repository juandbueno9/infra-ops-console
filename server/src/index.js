// Infra Ops · backend del centro de observabilidad
//  - Proxy de SOLO LECTURA hacia Prometheus (solo query y query_range, solo GET)
//  - Estado compartido del equipo: ocultar hosts y silenciar alertas (con auditoría)
//  - En producción sirve el frontend compilado (web/dist)
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getState, mutate } from './store.js';
import { audit, readAudit, toCsv } from './audit.js';
import { whoIs } from './identity.js';
import { createIncident, listIncidents, updateIncident } from './incidents.js';
import { awsConfigured, billing, friendly, fxCop, getBudget, s3, setBudget } from './aws.js';
import { clones } from './clones.js';
import { fgConfigured, fgNetscan, fgStatus, fgTraffic } from './fortigate.js';
import { synoConfigured, synoStatus } from './synology.js';
import { siteHosts } from './sitehosts.js';
import { azConfigured, azStatus } from './azure.js';
import { authEnabled, IDLE, mountAuth, session } from './auth.js';
import { getNotify, saveNotify, sendTest, startNotify } from './notify.js';
import { depAudit, RATE, rateLimit, securityHeaders } from './security.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
securityHeaders(app, { webDist: config.webDist, production: config.production || authEnabled() }); // CSP, HSTS, anti-clickjacking, HTTPS obligatorio
rateLimit(app, audit); // límite de peticiones por IP (login, API, cambios)
app.use(express.json({ limit: '16kb' }));
mountAuth(app, audit); // Keycloak (si está configurado): login obligatorio y roles

// Quién soy y qué puedo hacer (el frontend oculta las acciones si no es administrador)
app.get('/api/me', (req, res) => { const s = session(req); res.json(authEnabled() ? { auth: true, user: s.user, name: s.name, email: s.email, admin: s.admin, roles: s.roles.filter((x) => /MONITOREO/.test(x)), idleMin: IDLE / 60e3 } : { auth: false, user: 'local', name: 'Local', admin: true, roles: [] }); });

const HOST_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const bad = (res, status, error) => res.status(status).json({ status: 'error', error });

// ---------- auditoría de acceso al panel ----------
// Registra un "ingreso al panel" por usuario+IP como máximo cada 30 min (no por cada petición).
const seen = new Map();
app.use('/api', async (req, _res, next) => {
  try {
    if (req.method === 'GET' && req.path === '/state') {
      const who = await whoIs(req);
      const k = `${who.user}|${who.ip}`;
      if (!seen.has(k) || Date.now() - seen.get(k) > 30 * 60e3) {
        audit({ category: 'acceso', action: 'ingresó al panel', actor: who.user, ip: who.ip, detail: (req.get('user-agent') || '').slice(0, 120) });
      }
      seen.set(k, Date.now());
    }
  } catch { /* nunca bloquear por auditoría */ }
  next();
});

// ---------- salud ----------
app.get('/api/health', async (req, res) => {
  // Sin sesión solo se dice si está vivo (lo usan los scripts de instalación); los detalles internos solo con sesión
  if (authEnabled() && !session(req)) return res.json({ ok: true });
  let prometheus = false;
  try {
    const r = await fetch(`${config.promUrl}/-/ready`, { signal: AbortSignal.timeout(3000) });
    prometheus = r.ok;
  } catch { /* sin conexión */ }
  let loki = false;
  try { loki = (await fetch(`${config.lokiUrl}/ready`, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* sin Loki */ }
  res.json({ ok: true, prometheus, loki, promUrl: config.promUrl, time: new Date().toISOString() });
});

// ---------- proxy Prometheus (solo lectura) ----------
app.get('/api/prom/:endpoint(query|query_range|alerts|rules)', async (req, res) => {
  if (String(req.query.query || '').length > 4000) return bad(res, 400, 'Consulta demasiado larga');
  const qs = new URLSearchParams(req.query).toString();
  const url = `${config.promUrl}/api/v1/${req.params.endpoint}?${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    res.status(r.status).type('application/json').send(await r.text());
  } catch (err) {
    bad(res, 502, `No se pudo contactar Prometheus en ${config.promUrl}: ${err.cause?.code || err.message}`);
  }
});

// ---------- proxy Loki (solo lectura) ----------
// Consultar logs puede exponer datos sensibles: se audita (una vez cada 30 min por usuario).
const lokiSeen = new Map();
async function lokiProxy(req, res, upstreamPath) {
  const params = new URLSearchParams(req.query);
  if (params.has('limit')) params.set('limit', String(Math.min(Number(params.get('limit')) || 100, 5000)));
  const url = `${config.lokiUrl}/loki/api/v1/${upstreamPath}?${params}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    res.status(r.status).type('application/json').send(await r.text());
  } catch (err) {
    return bad(res, 502, `No se pudo contactar Loki en ${config.lokiUrl}: ${err.cause?.code || err.message}`);
  }
  if (upstreamPath === 'query_range') {
    try {
      const who = await whoIs(req);
      const k = `${who.user}|${who.ip}`;
      if (!lokiSeen.has(k) || Date.now() - lokiSeen.get(k) > 30 * 60e3) {
        audit({ category: 'acceso', action: 'consultó logs', actor: who.user, ip: who.ip, detail: String(req.query.query || '').slice(0, 200) });
      }
      lokiSeen.set(k, Date.now());
    } catch { /* nunca bloquear por auditoría */ }
  }
}
app.get('/api/loki/query_range', (req, res) => lokiProxy(req, res, 'query_range'));
app.get('/api/loki/labels', (req, res) => lokiProxy(req, res, 'labels'));
app.get('/api/loki/label/:name/values', (req, res) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(req.params.name)) return bad(res, 400, 'Etiqueta inválida');
  return lokiProxy(req, res, `label/${req.params.name}/values`);
});

// ---------- incidentes ----------
const incErr = (res, e) => (e.status ? bad(res, e.status, e.message) : (console.error('[incidentes]', e), bad(res, 500, 'Error interno')));
app.get('/api/incidents', async (_req, res) => res.json(await listIncidents()));
app.post('/api/incidents', async (req, res) => {
  try { res.json(await createIncident(req.body || {}, await whoIs(req))); } catch (e) { incErr(res, e); }
});
app.patch('/api/incidents/:id', async (req, res) => {
  if (!/^[a-f0-9]{8}$/.test(req.params.id)) return bad(res, 400, 'Id inválido');
  try { res.json(await updateIncident(req.params.id, req.body || {}, await whoIs(req))); } catch (e) { incErr(res, e); }
});

// ---------- estado compartido ----------
app.get('/api/state', async (_req, res) => res.json(await getState()));

app.post('/api/hosts/:host/silence', async (req, res) => {
  const { host } = req.params;
  const hours = Number(req.body?.hours);
  if (!HOST_RE.test(host)) return bad(res, 400, 'Nombre de host inválido');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return bad(res, 400, 'Las horas deben estar entre 1 y 168');
  const who = await whoIs(req);
  res.json(await mutate(`silenciar ${hours} h`, host, who, (s) => {
    s.silenced[host] = { until: Date.now() + hours * 3600e3, by: who.user, at: new Date().toISOString() };
  }));
});

app.delete('/api/hosts/:host/silence', async (req, res) => {
  const { host } = req.params;
  if (!HOST_RE.test(host)) return bad(res, 400, 'Nombre de host inválido');
  res.json(await mutate('reactivar alertas', host, await whoIs(req), (s) => { delete s.silenced[host]; }));
});

app.post('/api/hosts/:host/hide', async (req, res) => {
  const { host } = req.params;
  if (!HOST_RE.test(host)) return bad(res, 400, 'Nombre de host inválido');
  // Doble verificación en el servidor: la confirmación debe coincidir exactamente
  if (req.body?.confirm !== host) return bad(res, 400, 'La confirmación no coincide con el nombre del host');
  const who = await whoIs(req);
  res.json(await mutate('quitar del panel', host, who, (s) => {
    s.hidden[host] = { by: who.user, at: new Date().toISOString() };
    delete s.silenced[host];
  }));
});

// Nombre visible (alias) de un servidor o NAS: solo cambia cómo se muestra en el panel. Vacío = volver al original.
app.put('/api/alias/:key', async (req, res) => {
  const { key } = req.params;
  if (!/^[A-Za-z0-9._:\/?=&%+@~-]{1,200}$/.test(key)) return bad(res, 400, 'Identificador inválido');
  const name = String(req.body?.name ?? '').trim();
  if (name.length > 60 || !/^[\p{L}\p{N} ._()/·-]*$/u.test(name)) return bad(res, 400, 'Nombre inválido: usa letras, números, espacios y . _ - ( ) / · (máx. 60)');
  const who = await whoIs(req);
  res.json(await mutate(name ? `cambió el nombre a "${name}"` : 'volvió al nombre original', key, who, (s) => {
    s.aliases ||= {};
    if (name) s.aliases[key] = { name, by: who.user, at: new Date().toISOString() }; else delete s.aliases[key];
  }));
});
// Regla de un puerto (clasificación + descripción) — solo para el panel, no toca el Security Group.
app.put('/api/ports/:host/:port', async (req, res) => {
  const { host } = req.params, port = Number(req.params.port);
  if (!HOST_RE.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return bad(res, 400, 'Host o puerto inválido');
  const cls = String(req.body?.cls ?? '');
  const note = String(req.body?.note ?? '').trim();
  if (!['', 'allowed', 'office', 'sg', 'critical'].includes(cls)) return bad(res, 400, 'Clasificación inválida');
  if (note.length > 120 || !/^[\p{L}\p{N} ._()/:,·#+&-]*$/u.test(note)) return bad(res, 400, 'Descripción inválida (máx. 120)');
  const who = await whoIs(req);
  const what = cls || note ? `regla del puerto ${port}: ${cls || 'automático'}${note ? ` · ${note}` : ''}` : `quitó la regla del puerto ${port}`;
  res.json(await mutate(what, host, who, (s) => {
    s.portRules ||= {}; s.portRules[host] ||= {};
    if (cls || note) s.portRules[host][port] = { cls, note, by: who.user, at: new Date().toISOString() };
    else delete s.portRules[host][port];
    if (!Object.keys(s.portRules[host]).length) delete s.portRules[host];
  }));
});
app.delete('/api/hosts/:host/hide', async (req, res) => {
  const { host } = req.params;
  if (!HOST_RE.test(host)) return bad(res, 400, 'Nombre de host inválido');
  res.json(await mutate('restaurar en el panel', host, await whoIs(req), (s) => { delete s.hidden[host]; }));
});

// ---------- auditoría: consulta y exportación ----------
const isAdmin = (req) => !authEnabled() || !!session(req)?.admin;
app.get('/api/audit', async (req, res) => {
  if (!isAdmin(req)) return bad(res, 403, 'La auditoría solo la pueden ver administradores (ROLE_MONITOREO_ADMIN)');
  const { from, to, category, q, limit } = req.query;
  res.json(await readAudit({ from, to, category, q, limit }));
});
app.get('/api/audit.csv', async (req, res) => {
  if (!isAdmin(req)) return bad(res, 403, 'La auditoría solo la pueden exportar administradores');
  const { from, to, category, q } = req.query;
  const rows = await readAudit({ from, to, category, q, limit: 10000 });
  const who = await whoIs(req);
  audit({ category: 'exportacion', action: 'exportó la auditoría (CSV)', actor: who.user, ip: who.ip, detail: `${rows.length} filas · ${from || '30 días'} → ${to || 'ahora'}${category ? ' · ' + category : ''}` });
  res.set('Content-Disposition', `attachment; filename="auditoria-empresa-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv; charset=utf-8').send('\uFEFF' + toCsv(rows));
});
// La exportación de accesos SSH se genera en el navegador; se registra aquí.
app.post('/api/audit/event', async (req, res) => {
  const action = String(req.body?.action || '').slice(0, 120);
  if (!/^exportó /.test(action)) return bad(res, 400, 'Evento no permitido');
  const who = await whoIs(req);
  res.json(audit({ category: 'exportacion', action, actor: who.user, ip: who.ip, detail: String(req.body?.detail || '').slice(0, 200) }));
});

// ---------- AWS: facturación y S3 (solo lectura, con caché) ----------
const awsSeen = new Map();
const awsRoute = (what, fn) => async (req, res) => {
  if (!awsConfigured()) return res.json({ configured: false });
  try {
    const who = await whoIs(req), k = `${what}|${who.user}|${who.ip}`;
    if (!awsSeen.has(k) || Date.now() - awsSeen.get(k) > 30 * 60e3) {
      awsSeen.set(k, Date.now());
      audit({ category: 'acceso', action: `consultó ${what}`, actor: who.user, ip: who.ip });
    }
    res.json({ configured: true, ...(await fn(req.query.force === '1')) });
  } catch (e) {
    console.error(`[aws] ${what}:`, e?.name, e?.message);
    res.status(502).json({ configured: true, status: 'error', error: friendly(e) });
  }
};
app.get('/api/aws/status', (_req, res) => res.json({ configured: awsConfigured() }));
app.get('/api/aws/billing', awsRoute('facturación AWS', billing));
app.get('/api/aws/s3', awsRoute('almacenamiento S3', s3));
app.get('/api/fx/cop', async (req, res) => {
  try { res.json(await fxCop(req.query.force === '1')); } catch (e) { res.status(502).json({ status: 'error', error: e.message }); }
});
app.get('/api/aws/budget', async (_req, res) => res.json(await getBudget()));
app.put('/api/aws/budget', async (req, res) => {
  try {
    const who = await whoIs(req), data = await setBudget(req.body?.usd, who);
    audit({ category: 'accion', action: 'cambió el presupuesto AWS', actor: who.user, ip: who.ip, detail: data.usd == null ? 'sin presupuesto' : `US$ ${data.usd}` });
    res.json(data);
  } catch (e) { bad(res, e.status || 500, e.message); }
});

// ---------- FortiGate de la sede (solo lectura por API; el token vive solo en server/.env) ----------
const fgRoute = (fn) => async (req, res) => {
  if (!fgConfigured()) return res.json({ configured: false });
  try { res.json({ configured: true, ...(await fn(req.query.force === '1')) }); } catch (e) { bad(res, 502, e.message); }
};
app.get('/api/fortigate/status', fgRoute(fgStatus));
app.get('/api/fortigate/traffic', fgRoute(fgTraffic));

// ---------- alertas por correo (Configuración → Alertas por correo). Cambiar y probar: solo administradores (el middleware bloquea PUT/POST a solo lectura)
app.get('/api/notify', async (_req, res) => { try { res.json(await getNotify()); } catch (e) { bad(res, 500, e.message); } });
app.put('/api/notify', async (req, res) => {
  try {
    const who = await whoIs(req), v = await saveNotify(req.body || {});
    audit({ category: 'accion', action: `alertas por correo: ${v.enabled ? 'activadas' : 'desactivadas'} · ${v.rules.length} regla(s) · ${v.rules.reduce((t, r) => t + r.emails.length, 0)} correo(s)`, actor: who.user, ip: who.ip });
    res.json(await getNotify());
  } catch (e) { bad(res, 400, e.message); }
});
app.post('/api/notify/test', async (req, res) => {
  try { const who = await whoIs(req); const to = await sendTest(Array.isArray(req.body?.emails) ? req.body.emails : [], who.user); audit({ category: 'accion', action: `correo de prueba a ${to.join(', ')}`, actor: who.user, ip: who.ip }); res.json({ ok: true, to }); }
  catch (e) { bad(res, 400, e.message); }
});

// ---------- ping y escaneos de red: FortiGate (sede, NAS, agencias) + servidores Linux (deploy/escaneos-red.sh) ----------
app.get('/api/netscan', async (req, res) => {
  const out = { scanners: [], sources: {}, errors: {} };
  const tasks = [];
  if (fgConfigured()) tasks.push(fgNetscan(req.query.force === '1').then((d) => { out.scanners.push(...d.scanners); out.sources.fortigate = { window: d.window, logs: d.logs, hint: d.hint, thresholds: d.thresholds }; Object.assign(out.errors, d.errors); }).catch((e) => { out.errors.fortigate = e.message; }));
  else out.sources.fortigate = { hint: 'FortiGate no configurado' };
  const pq = async (e) => { const r = await fetch(`${config.promUrl}/api/v1/query?query=${encodeURIComponent(e)}`, { signal: AbortSignal.timeout(8000) }); return (await r.json()).data?.result || []; };
  tasks.push(Promise.all(['infra_netscan_up', 'infra_netscan_pings', 'infra_netscan_ports', 'infra_netscan_syn', 'infra_netscan_first'].map((e) => pq(e).catch(() => []))).then(([up, pings, ports, syn, first]) => {
    out.sources.servidores = { hosts: up.map((x) => ({ instance: x.metric.instance, up: +x.value[1] === 1 })) };
    const by = {};
    const K = (m) => `${m.instance}|${m.ip}`;
    const get = (m) => (by[K(m)] ||= { ip: m.ip, instance: m.instance, pings: 0, ports: 0, syn: 0, first: null });
    for (const x of pings) get(x.metric).pings = +x.value[1];
    for (const x of ports) get(x.metric).ports = +x.value[1];
    for (const x of syn) get(x.metric).syn = +x.value[1];
    for (const x of first) get(x.metric).first = +x.value[1] * 1000;
    const T = { ports: +process.env.NETSCAN_PORTS || 15, pings: +process.env.NETSCAN_PINGS || 30 };
    const ign = new Set((process.env.NETSCAN_IGNORE || '').split(',').map((x) => x.trim()).filter(Boolean));
    for (const o of Object.values(by)) {
      if (ign.has(o.ip)) continue;
      const kinds = [];
      if (o.ports >= T.ports) kinds.push(`Escaneo de puertos (${o.ports} puertos)`);
      if (o.pings >= T.pings) kinds.push(`Ping repetido (${o.pings} veces)`);
      if (!kinds.length) continue;
      const external = !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(o.ip);
      out.scanners.push({ ip: o.ip, name: '', source: 'Servidor', external, kinds, pings: o.pings, ports: o.ports, hosts: 1, events: o.pings + o.syn, targets: [{ ip: o.instance.replace(/:\d+$/, ''), instance: o.instance, name: '' }], first: o.first, last: Date.now(), sev: o.ports >= T.ports && external ? 'crit' : 'warn' });
    }
  }).catch((e) => { out.errors.servidores = e.message; }));
  await Promise.all(tasks);
  // Una misma IP vista por el FortiGate y por un servidor se muestra una sola vez
  const m = new Map();
  for (const x of out.scanners) { const p = m.get(x.ip); if (!p) m.set(x.ip, { ...x, sources: [x.source] }); else { p.kinds = [...new Set([...p.kinds, ...x.kinds])]; p.targets = [...p.targets, ...x.targets].slice(0, 15); p.sources = [...new Set([...p.sources, x.source])]; p.events += x.events; if (x.sev === 'crit') p.sev = 'crit'; } }
  out.scanners = [...m.values()];
  res.json(out);
});

// ---------- Azure (API de solo lectura: máquinas virtuales, métricas, VPN) ----------
app.get('/api/azure', async (req, res) => {
  if (!azConfigured()) return res.json({ configured: false });
  try { res.json(await azStatus(req.query.force === '1')); } catch (e) { bad(res, 502, e.message); }
});

// ---------- en qué servidor vive cada sitio (DNS + EC2, solo lectura) ----------
app.get('/api/site-hosts', async (req, res) => {
  try { res.json(await siteHosts(req.query.force === '1')); } catch (e) { bad(res, 502, `No se pudo resolver los sitios: ${e.message}`); }
});

// ---------- Synology NAS (SNMP, solo lectura) ----------
app.get('/api/synology', async (req, res) => {
  if (!synoConfigured()) return res.json({ configured: false });
  try { res.json(await synoStatus(req.query.force === '1')); } catch (e) { bad(res, 502, `Synology: ${e.message}`); }
});

// ---------- clones / suplantación de la página web (dominios parecidos + certificados) ----------
let clonesForcedAt = 0;
app.get('/api/clones', async (req, res) => {
  const force = req.query.force === '1' && Date.now() - clonesForcedAt > 30 * 60e3; // forzar como máximo cada 30 min
  if (force) clonesForcedAt = Date.now();
  try { res.json(await clones(force)); } catch (e) { bad(res, 502, `No se pudo revisar dominios: ${e.message}`); }
});

// ---------- estado de los controles de seguridad del panel (Configuración → Seguridad del panel) ----------
app.get('/api/security', (req, res) => {
  const fwd = req.get('x-forwarded-proto');
  res.json({ auth: authEnabled(), https: fwd ? fwd === 'https' : null, rate: RATE, deps: depAudit(config.dataDir),
    envProtected: (() => { try { const st = fs.statSync(path.resolve(config.dataDir, '..', '.env')); return (st.mode & 0o007) === 0; } catch { return null; } })() });
});

app.use('/api', (_req, res) => bad(res, 404, 'Ruta no encontrada'));

// ---------- frontend compilado (producción) ----------
if (fs.existsSync(config.webDist)) {
  // index.html nunca se guarda en caché (así cada publicación se ve al recargar); los archivos con huella sí
  app.use(express.static(config.webDist, { index: 'index.html', maxAge: '30d', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));
  app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.sendFile(path.join(config.webDist, 'index.html')); });
}

// ---------- errores ----------
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  bad(res, 500, 'Error interno del servidor');
});

startNotify();
app.listen(config.port, config.host, () => {
  console.log(`la empresa monitoreo · API en http://${config.host}:${config.port}  ·  Prometheus: ${config.promUrl}`);
});
