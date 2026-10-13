// Monitoreo de sitios web (sondas Blackbox en Prometheus), estilo UptimeRobot.
import { DEMO, PROBE_INTERVAL_S } from '../config.js';
import { q, qr, safe } from './api.js';
import { loadExposure } from './exposure.js';

const byInst = (res) => Object.fromEntries(res.map((x) => [x.metric.instance, +x.value[1]]));
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
export const siteName = (t) => t.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');

/** Certificados configurados en nginx de cada servidor (los publica el agente). */
async function loadCerts() {
  const [r, info] = await Promise.all([safe(q('infra_tls_cert_expiry_seconds - time()')), safe(q('infra_instance_info'))]);
  const names = Object.fromEntries(info.map((x) => [x.metric.instance, x.metric.hostname]));
  return r.map((x) => ({ domain: x.metric.domain, file: x.metric.file, issuer: x.metric.issuer, renewal: x.metric.renewal, method: x.metric.method,
    host: names[x.metric.instance] || x.metric.instance, instance: x.metric.instance, secs: +x.value[1] }))
    .sort((a, b) => a.secs - b.secs);
}

/** Lista de sitios con estado, uptime, latencia, SSL y barra de 24 h (un bloque por hora). */
export async function loadSites() {
  if (DEMO) return { sites: demoSites(), certs: demoCerts(), exposure: await loadExposure() };
  const Q = {
    up: 'probe_success{job=~"blackbox_http.*"}', dur: 'probe_duration_seconds{job=~"blackbox_http.*"}', code: 'probe_http_status_code{job=~"blackbox_http.*"}',
    ssl: 'probe_ssl_earliest_cert_expiry{job=~"blackbox_http.*"} - time()', age: 'time() - timestamp(probe_success{job=~"blackbox_http.*"})',
    u24: 'avg_over_time(probe_success{job=~"blackbox_http.*"}[24h])', u7: 'avg_over_time(probe_success{job=~"blackbox_http.*"}[7d])', u30: 'avg_over_time(probe_success{job=~"blackbox_http.*"}[30d])',
    up1m: 'max_over_time(probe_success{job=~"blackbox_http.*"}[1m])', min5m: 'min_over_time(probe_success{job=~"blackbox_http.*"}[5m])',
    fails5m: 'count_over_time((probe_success{job=~"blackbox_http.*"} == 0)[5m:15s])',
    lat24: 'avg_over_time(probe_duration_seconds{job=~"blackbox_http.*"}[24h])', chain: 'probe_ssl_last_chain_info{job=~"blackbox_http.*"}',
  };
  const keys = Object.keys(Q);
  const res = await Promise.all(keys.map((k) => (k === 'up' ? q(Q[k]) : safe(q(Q[k])))));
  const R = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
  const bars = await safe(qr('avg_over_time(probe_success{job=~"blackbox_http.*"}[1h])', 24 * 60, 3600));
  const B = Object.fromEntries(bars.map((x) => [x.metric.instance, x.values.map((v) => +v[1])]));
  const M = (k) => byInst(R[k]);
  const up1m = M('up1m'), min5m = M('min5m'), fails5m = M('fails5m'), dur = M('dur'), code = M('code'), ssl = M('ssl'), age = M('age'), u24 = M('u24'), u7 = M('u7'), u30 = M('u30'), lat24 = M('lat24');
  const issuer = Object.fromEntries(R.chain.map((x) => [x.metric.instance, x.metric.issuer]));
  const [certs, exposure] = await Promise.all([loadCerts(), loadExposure()]);
  const sites = R.up.map((x) => {
    const t = x.metric.instance;
    return {
      // Caído solo si fallaron todas las pruebas del último minuto; intermitente si falló alguna en 5 min
      target: t, name: siteName(t), ok: (up1m[t] ?? +x.value[1]) === 1, flaky: (up1m[t] ?? +x.value[1]) === 1 && min5m[t] === 0,
      lastFailed: +x.value[1] === 0, fails5m: fails5m[t] || 0, dur: dur[t], code: code[t], ssl: ssl[t], age: age[t],
      u24: u24[t], u7: u7[t], u30: u30[t], lat24: lat24[t], issuer: issuer[t], bars: B[t] || [],
    };
  }).sort((a, b) => a.ok - b.ok || a.name.localeCompare(b.name));
  return { sites, certs, exposure };
}

export const SITE_RANGES = {
  '1h': { label: 'Última hora', mins: 60, step: 15 },
  '24h': { label: '24 horas', mins: 1440, step: 300 },
  '7d': { label: '7 días', mins: 10080, step: 1800 },
};

/** Detecta incidentes a partir de la serie de disponibilidad (min en ventanas de 5 min). */
function incidentsFrom(success, codes) {
  const out = [];
  let cur = null;
  success.forEach(([t, v]) => {
    if (v < 1 && !cur) cur = { start: t, code: codes[t] ?? null };
    if (v >= 1 && cur) { out.push({ ...cur, end: t }); cur = null; }
  });
  if (cur) out.push({ ...cur, end: null });
  return out.reverse();
}

export const causeOf = (code) => (code == null ? ['?', 'Sin datos'] : code === 0 ? ['T/O', 'Timeout o sin conexión']
  : code >= 500 ? [String(code), 'Error del servidor'] : code >= 400 ? [String(code), 'Error del cliente'] : [String(code), 'Respuesta inesperada']);

/** Detalle de un sitio: estado, uptime, latencia en el rango, fases, SSL e incidentes (7 días). */
export async function loadSite(target, range = '1h') {
  if (DEMO) return demoSite(target, range);
  const L = `instance="${esc(target)}"`;
  const RG = SITE_RANGES[range] || SITE_RANGES['1h'];
  const one = (e) => safe(q(e)).then((r) => (r.length ? +r[0].value[1] : null));
  const [ok, dur, code, ssl, age, u24, u7, u30, phases, chain, lat, succ, codes, bars] = await Promise.all([
    one(`probe_success{${L}}`), one(`probe_duration_seconds{${L}}`), one(`probe_http_status_code{${L}}`),
    one(`probe_ssl_earliest_cert_expiry{${L}} - time()`), one(`time() - timestamp(probe_success{${L}})`),
    one(`avg_over_time(probe_success{${L}}[24h])`), one(`avg_over_time(probe_success{${L}}[7d])`), one(`avg_over_time(probe_success{${L}}[30d])`),
    safe(q(`probe_http_duration_seconds{${L}}`)), safe(q(`probe_ssl_last_chain_info{${L}}`)),
    safe(qr(`probe_duration_seconds{${L}}`, RG.mins, RG.step)),
    safe(qr(`min_over_time(probe_success{${L}}[5m])`, 10080, 300)),
    // código HTTP solo de las sondas que fallaron (0 = timeout / sin conexión)
    safe(qr(`max_over_time((probe_http_status_code{${L}} and probe_success{${L}} == 0)[5m:15s])`, 10080, 300)),
    safe(qr(`avg_over_time(probe_success{${L}}[1h])`, 1440, 3600)),
  ]);
  const S = succ[0] ? succ[0].values.map((v) => [+v[0], +v[1]]) : [];
  const C = Object.fromEntries(codes[0] ? codes[0].values.map((v) => [+v[0], +v[1]]) : []);
  const incidents = incidentsFrom(S, C);
  const lastDown = incidents[0];
  const upSince = ok === 1 ? (lastDown ? lastDown.end : (S[0]?.[0] ?? null)) : null;
  const downSince = ok === 0 ? (lastDown && !lastDown.end ? lastDown.start : Date.now() / 1000) : null;
  const inc24 = incidents.filter((i) => (i.end ?? Date.now() / 1000) > Date.now() / 1000 - 86400);
  const down24 = inc24.reduce((t, i) => t + ((i.end ?? Date.now() / 1000) - Math.max(i.start, Date.now() / 1000 - 86400)), 0);
  const ms = lat[0] ? lat[0].values.map((v) => [+v[0], +v[1] * 1000]) : [];
  const vals = ms.map((x) => x[1]);
  return {
    target, name: siteName(target), ok: ok === 1, dur, code, ssl, age, u24, u7, u30,
    issuer: chain[0]?.metric?.issuer, subject: chain[0]?.metric?.subject,
    phases: Object.fromEntries(phases.map((x) => [x.metric.phase, +x.value[1]])),
    latency: ms, latAvg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    latMin: vals.length ? Math.min(...vals) : null, latMax: vals.length ? Math.max(...vals) : null,
    bars: bars[0] ? bars[0].values.map((v) => +v[1]) : [], incidents, inc24: inc24.length, down24,
    upSince, downSince, interval: PROBE_INTERVAL_S, historyFrom: S[0]?.[0] ?? null, range,
  };
}

// ---------------------------------------------------------------------------
// Datos simulados (modo demo)
// ---------------------------------------------------------------------------
const DEMO_SITES = ['empresa.com', 'crm.empresa.com', 'consultas.empresa.com', 'contabilidad.empresa.com', 'ems.empresa.com', 'ingresos.empresa.com',
  'monitoreo.empresa.com', 'ofrenda.empresa.com', 'solicitud-asociado.empresa.com', 'vault.empresa.com', 'wiki.empresa.com', 'stg-api.empresa.com', 'stg-originacion.empresa.com', 'sucursalvirtual.empresa.com'];
const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };

function demoBase(i) {
  const down = i === 11, flaky = i === 0 || i === 5;
  const bars = Array.from({ length: 24 }, (_, k) => (down && k > 21 ? 0 : flaky && (k === 6 || k === 7) ? 0.72 : i === 3 && k === 15 ? 0.95 : 1));
  const u24 = bars.reduce((a, b) => a + b, 0) / 24;
  return { down, bars, u24, u7: down ? 0.962 : flaky ? 0.98076 : 0.9995 - rnd(i) * 0.002, u30: down ? 0.984 : flaky ? 0.99566 : 0.9998 - rnd(i + 3) * 0.001,
    ssl: 86400 * [137, 63, 88, 12, 45, 137, 63, 90, 34, 12, 70, 5, 51, 96][i], dur: down ? null : 0.18 + rnd(i) * 1.4 };
}
function demoSites() {
  return DEMO_SITES.map((n, i) => {
    const b = demoBase(i);
    return { target: `https://${n}/`, name: n, ok: !b.down, flaky: i === 0, fails5m: i === 0 ? 2 : 0, lastFailed: false, dur: b.dur, code: b.down ? 502 : 200, ssl: b.ssl, age: 4 + (i % 10),
      u24: b.u24, u7: b.u7, u30: b.u30, lat24: b.dur, issuer: "Let's Encrypt R11", bars: b.bars };
  }).sort((a, b) => a.ok - b.ok || a.name.localeCompare(b.name));
}
function demoCerts() {
  const d = 86400, now = Date.now() / 1000;
  return [
    ['vault.empresa.com', '/etc/letsencrypt/live/vault.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 23],
    ['contabilidad.empresa.com', '/etc/letsencrypt/live/contabilidad.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 32],
    ['monitoreo.empresa.com', '/etc/letsencrypt/live/monitoreo.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 32],
    ['ofrenda.empresa.com', '/etc/letsencrypt/live/ofrenda.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 46],
    ['consultas.empresa.com', '/etc/letsencrypt/live/consultas.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 59],
    ['ems.empresa.com', '/etc/letsencrypt/live/ems.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 67],
    ['operaciones.empresa.com', '/etc/letsencrypt/live/operaciones.empresa.com/fullchain.pem', "Let's Encrypt", 'certbot-auto', 89],
  ].map(([domain, file, issuer, renewal, days]) => ({ domain, file, issuer, renewal, host: 'app-server', secs: days * d + (now % 3600) }))
    .concat(['crm', 'extras', 'ingresos', 'ocsinventory', 'solicitud-asociado', 'wiki', 'stg-api', 'stg-cobranza', 'stg-listas', 'stg-originacion', 'stg-taquilla']
      .map((n) => ({ domain: `${n}.empresa.com`, file: '/root/wildcard/certificado.crt', issuer: 'DigiCert Inc', renewal: 'manual', host: 'app-server', secs: 137 * d })))
    .concat([['fineract.empresa.com', 74], ['api.fineract.empresa.com', 74]].map(([domain, days]) => ({ domain, file: `/etc/letsencrypt/live/fineract.empresa.com/fullchain.pem`, issuer: "Let's Encrypt", renewal: 'certbot-manual', host: 'core-fineract', secs: days * d })))
    .concat([{ domain: 'gravitee.empresa.com', file: '/etc/nginx/ssl/gravitee.crt', issuer: 'DigiCert Inc', renewal: 'manual', host: 'core-gravitee', secs: 18 * d }])
    .sort((a, b) => a.secs - b.secs);
}

function demoSite(target, range) {
  const name = siteName(target), i = Math.max(0, DEMO_SITES.indexOf(name)), b = demoBase(i), now = Date.now() / 1000;
  const RG = SITE_RANGES[range] || SITE_RANGES['1h'];
  const n = Math.round((RG.mins * 60) / RG.step), base = (b.dur || 0.4) * 1000;
  const latency = Array.from({ length: n }, (_, k) => [now - (n - k) * RG.step, base * (0.9 + 0.2 * rnd(k + i)) + (k % 37 === 0 ? base * 0.8 : 0)]);
  const vals = latency.map((x) => x[1]);
  const incidents = [
    ...(b.down ? [{ start: now - 5400, end: null, code: 502 }] : []),
    { start: now - 86400 * 2.3, end: now - 86400 * 2.3 + 11636, code: 500 },
    { start: now - 86400 * 45, end: now - 86400 * 45 + 305, code: 0 },
    { start: now - 86400 * 56, end: now - 86400 * 56 + 640, code: 0 },
  ];
  return { target, name, ok: !b.down, dur: b.dur, code: b.down ? 502 : 200, ssl: b.ssl, age: 12, u24: b.u24, u7: b.u7, u30: b.u30,
    issuer: "Let's Encrypt R11", subject: `CN=${name}`,
    phases: b.down ? {} : { resolve: 0.004, connect: 0.03, tls: 0.06, processing: (b.dur || 0.4) * 0.7, transfer: 0.01 },
    latency, latAvg: vals.reduce((a, c) => a + c, 0) / vals.length, latMin: Math.min(...vals), latMax: Math.max(...vals),
    bars: b.bars, incidents, inc24: b.down ? 1 : 0, down24: b.down ? 5400 : 0,
    upSince: b.down ? null : now - 86400 * 2.3 + 11636, downSince: b.down ? now - 5400 : null, interval: PROBE_INTERVAL_S, historyFrom: now - 86400 * 7, range };
}
