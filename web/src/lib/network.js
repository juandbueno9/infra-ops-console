// Red de agencias por SD-WAN: ping ICMP desde AWS (Blackbox, job "red_agencias").
import { DEMO } from '../config.js';
import { q, qr, safe } from './api.js';
import { AGENCY_GEO } from './agencyGeo.js';

const J = 'job="red_agencias"';

export async function loadNetwork() {
  const [prom, route, fg] = await Promise.all([loadAgencies().catch(() => []), loadRoute(), DEMO ? null : loadFgAgencies().catch(() => null)]);
  // Si AWS no alcanza las agencias por la VPN, se usa lo que reporta el FortiGate (SD-WAN y túneles)
  const seen = new Set(prom.map((a) => a.ip));
  const agencies = [...prom, ...(fg || []).filter((a) => !seen.has(a.ip))];
  // La sede principal (Bogotá) se mide por la VPN AWS ↔ sede: se cuenta como una agencia más (16 en total)
  const hub = AGENCY_GEO.find((g) => g.hub);
  if (hub && route?.vpn && !agencies.some((a) => a.ip === hub.ip)) {
    agencies.push({ ip: hub.ip, name: hub.name, city: hub.city, address: '', subnet: hub.ip.replace(/\.\d+$/, '.0/24'), ok: !!route.vpn.ok, src: 'vpn', via: 'VPN AWS ↔ sede',
      rtt: route.vpn.ms ?? null, rtt1: route.vpn.ms ?? null, loss1: null, u24: route.vpn.u24 ?? null, u7: null, bars: route.vpn.bars || [], spark: [], downFor: null });
  }
  agencies.sort(order);
  return { agencies, route, fortigate: !!fg?.length };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Estado de cada agencia según el FortiGate de la sede (API de solo lectura):
 *  - SD-WAN: pruebas de salud con el nombre de la agencia (p. ej. "Lo_Quimbaya"); arriba si algún enlace responde.
 *  - Túneles: túnel IPsec cuya IP remota es la IP pública de la agencia.
 */
export async function loadFgAgencies() {
  const r = await fetch('api/fortigate/status', { cache: 'no-store' });
  if (!r.ok) return null;
  const S = await r.json();
  if (!S?.configured) return null;
  const checks = {};
  for (const x of S.sdwan || []) (checks[x.check] ||= []).push(x);
  const out = [];
  for (const ag of AGENCY_GEO) {
    if (ag.hub) continue;
    const an = norm(ag.name), first = norm(ag.name.split(' ')[0]);
    const key = Object.keys(checks).find((c) => { const cn = norm(c).replace(/^lo/, ''); return cn.length >= 4 && (cn.includes(an) || an.includes(cn) || (first.length >= 5 && cn.includes(first))); });
    const tun = (S.tunnels || []).filter((t) => ag.pub && t.remote === ag.pub);
    if (!key && !tun.length) continue;
    const mem = key ? checks[key] : [];
    const upM = mem.filter((m) => /^(alive|up)$/i.test(m.status || '')).sort((a, b) => (a.latency ?? 1e9) - (b.latency ?? 1e9));
    const best = upM[0] || null;
    // SD-WAN usa el mejor enlace disponible: la pérdida que cuenta es la del enlace con MENOS pérdida (no la del primero)
    const losses = upM.map((m) => m.loss).filter((v) => v != null);
    const minLoss = losses.length ? Math.min(...losses) : null;
    const ok = mem.length ? upM.length > 0 : tun.some((t) => t.up);
    out.push({
      ip: ag.ip, name: ag.name, city: ag.city, address: '', subnet: ag.ip.replace(/\.\d+$/, '.0/24'), ok, src: 'fortigate',
      rtt: best?.latency ?? null, rtt1: best?.latency ?? null, loss1: minLoss != null ? minLoss / 100 : null,
      u24: null, u7: null, bars: [], spark: [], downFor: null,
      via: [best ? `SD-WAN ${best.member}` : null, tun.some((t) => t.up) ? 'túnel arriba' : tun.length ? 'túnel caído' : null].filter(Boolean).join(' · '),
      links: mem.map((m) => ({ member: m.member, up: /^(alive|up)$/i.test(m.status || ''), latency: m.latency, loss: m.loss })),
      check: key || null, pub: ag.pub,
    });
  }
  return out;
}

/** Capas de la ruta AWS → sede principal (Internet WAN y VPN). Job red_sede / red_sede_tcp. */
async function loadRoute() {
  if (DEMO) return demoRoute();
  const S = 'job=~"red_sede.*"';
  const [up, rtt, dur, u24, bars] = await Promise.all([
    safe(q(`probe_success{${S}}`)), safe(q(`probe_icmp_duration_seconds{${S},phase="rtt"}`)), safe(q(`probe_duration_seconds{${S}}`)),
    safe(q(`avg_over_time(probe_success{${S}}[24h])`)), safe(qr(`avg_over_time(probe_success{${S}}[1h])`, 1440, 3600)),
  ]);
  const by = (a) => Object.fromEntries(a.map((x) => [x.metric.capa, +x.value[1]]));
  const R = by(rtt), D = by(dur), U = by(u24), B = Object.fromEntries(bars.map((x) => [x.metric.capa, x.values.map((v) => +v[1])]));
  return Object.fromEntries(up.map((x) => { const c = x.metric.capa; return [c, {
    name: x.metric.nombre, target: x.metric.instance, ok: +x.value[1] === 1, ms: (R[c] ?? D[c]) != null ? (R[c] ?? D[c]) * 1000 : null, u24: U[c] ?? null, bars: B[c] || [],
  }]; }));
}

async function loadAgencies() {
  if (DEMO) return demoNetwork();
  const Q = {
    up: `probe_success{${J}}`,
    rtt: `probe_icmp_duration_seconds{${J},phase="rtt"}`,
    l1: `1 - avg_over_time(probe_success{${J}}[1h])`,
    u24: `avg_over_time(probe_success{${J}}[24h])`,
    u7: `avg_over_time(probe_success{${J}}[7d])`,
    rtt1: `avg_over_time(probe_icmp_duration_seconds{${J},phase="rtt"}[1h])`,
    last: `time() - max_over_time(timestamp(probe_success{${J}} == 1)[7d:1m])`,
  };
  const keys = Object.keys(Q);
  const res = await Promise.all(keys.map((k) => (k === 'up' ? q(Q[k]) : safe(q(Q[k])))));
  const R = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
  const by = (arr) => Object.fromEntries(arr.map((x) => [x.metric.instance, +x.value[1]]));
  const rtt = by(R.rtt), l1 = by(R.l1), u24 = by(R.u24), u7 = by(R.u7), rtt1 = by(R.rtt1), last = by(R.last);
  const [bars, spark] = await Promise.all([
    safe(qr(`avg_over_time(probe_success{${J}}[1h])`, 24 * 60, 3600)),
    safe(qr(`probe_icmp_duration_seconds{${J},phase="rtt"}`, 60, 60)),
  ]);
  const series = (arr) => Object.fromEntries(arr.map((s) => [s.metric.instance, s.values.map((v) => +v[1])]));
  const B = series(bars), S = series(spark);
  return R.up.map((x) => {
    const i = x.metric.instance, ok = +x.value[1] === 1;
    return {
      ip: i, name: x.metric.agencia || i, city: x.metric.ciudad || '', address: x.metric.direccion || '', subnet: x.metric.subred || '',
      ok, rtt: rtt[i] != null ? rtt[i] * 1000 : null, rtt1: rtt1[i] != null ? rtt1[i] * 1000 : null, loss1: l1[i] ?? null,
      u24: u24[i] ?? null, u7: u7[i] ?? null, bars: B[i] || [], spark: (S[i] || []).map((v) => v * 1000),
      downFor: !ok && last[i] != null ? last[i] : null,
    };
  }).sort(order);
}

const order = (a, b) => a.ok - b.ok || (b.loss1 || 0) - (a.loss1 || 0) || a.name.localeCompare(b.name);

/** Semáforo de una agencia. */
export function linkState(a) {
  if (!a.ok) return ['Sin conexión', 'crit'];
  if ((a.loss1 ?? 0) > 0.05 || (a.rtt ?? 0) > 150) return ['Degradada', 'warn'];
  return ['En línea', 'ok'];
}

/**
 * Estado del Internet de la sede: true / false / null (no se puede saber).
 * La VPN viaja por ese Internet, así que si la VPN responde, hay Internet aunque la WAN no conteste ping.
 * Si la WAN nunca respondió en 24 h (bloquea ICMP), su sonda no sirve para decidir.
 */
export function internetState(route = {}) {
  const net = route.internet, vpn = route.vpn;
  if (vpn?.ok) return true;
  if (net?.ok) return true;
  if (!net || !net.u24) return null;
  return false;
}

/** Dónde está la falla, leyendo la ruta de afuera hacia adentro. */
export function diagnose(route = {}, agencies = []) {
  const net = internetState(route), vpn = route.vpn;
  if (vpn && !vpn.ok && net === false) return ['crit', 'La sede principal está sin Internet', 'No responde la WAN ni la VPN: falla el enlace de Internet de la sede o el FortiGate principal. No hay salida a AWS.'];
  if (vpn && !vpn.ok && net == null) return ['crit', 'Sin conexión con la sede principal', 'No responde la VPN AWS ↔ sede. Puede ser el Internet de la sede o el túnel VPN-AWS (la WAN no responde ping, así que no se pueden separar). Revisa VPN → IPsec Tunnels en el FortiGate.'];
  if (vpn && !vpn.ok) return ['crit', 'Cayó la VPN entre AWS y la sede principal', 'Internet de la sede responde, pero el túnel VPN-AWS no. Revisa el túnel en el FortiGate (VPN → IPsec Tunnels).'];
  const down = agencies.filter((a) => !a.ok);
  if (agencies.length && down.length === agencies.length) return ['crit', 'Todas las agencias sin conexión', 'La sede y la VPN responden: el problema está en el SD-WAN / concentrador de la sede.'];
  if (down.length) return ['crit', `${down.length === 1 ? 'Agencia sin conexión' : `${down.length} agencias sin conexión`}: ${down.map((a) => a.name).join(', ')}`, 'La sede principal y la VPN están bien: la falla está en el enlace de esa(s) agencia(s) (Internet local o equipo).'];
  if (!vpn && !route.internet) return ['off', 'Ruta sin monitorear', 'Ejecuta deploy/aplicar-prometheus.sh en el servidor.'];
  return ['ok', 'Toda la ruta está operando', agencies.length ? 'Sede principal, VPN y agencias responden.' : 'Sede principal y VPN responden. Las agencias se agregan cuando AWS pueda alcanzarlas.'];
}

// ---------- demo ----------
function demoRoute() {
  const full = Array.from({ length: 24 }, () => 1);
  return {
    internet: { name: 'Internet sede principal (WAN)', target: '203.0.113.10', ok: true, ms: 38.4, u24: 1, bars: full },
    vpn: { name: 'VPN AWS → LAN sede principal', target: '192.168.10.254', ok: true, ms: 41.2, u24: 0.9965, bars: full.map((v, i) => (i === 17 ? 0.92 : v)) },
  };
}
const AG = [
  ['Bogotá Principal', 'Bogotá', 'Dirección de ejemplo', 10], ['Medellín', 'Medellín', 'Dirección de ejemplo', 11], ['Barranquilla', 'Barranquilla', 'Dirección de ejemplo', 12],
  ['Cartagena', 'Cartagena', '', 13], ['Bucaramanga', 'Bucaramanga', 'Dirección de ejemplo', 14], ['Cúcuta', 'Cúcuta', 'Dirección de ejemplo', 15],
  ['Santa Marta', 'Santa Marta', 'Dirección de ejemplo', 16], ['Usaquén', 'Bogotá', 'Dirección de ejemplo', 17], ['Villavicencio', 'Villavicencio', 'Dirección de ejemplo', 18],
  ['Neiva', 'Neiva', '', 19], ['Pasto', 'Pasto', 'Dirección de ejemplo', 20], ['Montería', 'Montería', '', 21],
  ['Tunja', 'Tunja', 'Dirección de ejemplo', 22], ['Valledupar', 'Valledupar', '', 23], ['Sincelejo', 'Sincelejo', 'Dirección de ejemplo', 24], ['Yopal', 'Yopal', '', 25],
];
const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
function demoNetwork() {
  return AG.map(([name, city, address, n], k) => {
    const down = name === 'Neiva', flaky = name === 'Valledupar';
    const base = n === 10 ? 2 : 18 + rnd(k) * 40;
    const bars = Array.from({ length: 24 }, (_, h) => (down && h > 21 ? 0 : flaky && (h === 9 || h === 14) ? 0.86 : 1));
    return {
      ip: `192.168.${n}.254`, name, city, address, subnet: `192.168.${n}.0/24`, ok: !down,
      rtt: down ? null : base + rnd(k + 3) * 6, rtt1: down ? null : base + 2, loss1: down ? 0.62 : flaky ? 0.08 : 0,
      u24: bars.reduce((a, b) => a + b, 0) / 24, u7: down ? 0.981 : flaky ? 0.9912 : 0.9998, bars,
      spark: down ? [] : Array.from({ length: 60 }, (_, i) => base + Math.abs(Math.sin(i / 5 + k)) * (flaky ? 60 : 8) + rnd(i + k) * 4),
      downFor: down ? 1860 : null,
    };
  }).sort(order);
}
