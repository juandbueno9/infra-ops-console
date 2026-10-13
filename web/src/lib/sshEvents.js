// Historial de accesos SSH (métrica infra_ssh_event del agente, 7 días de journal).
//   kind="login"  → valor = inicio (epoch), label end = cierre de sesión ('' si sigue abierta o sin registro)
//   kind="failed" → valor = momento del intento fallido
import { DEMO } from '../config.js';
import { q, safe } from './api.js';

export function parseEvents(results, hostOf = (i) => i) {
  return results.map((x) => {
    const m = x.metric, ts = +x.value[1], end = m.end ? +m.end : null;
    return {
      id: `${m.instance}|${m.id}`, inst: m.instance, host: hostOf(m.instance), kind: m.kind,
      user: m.user || '', from: m.from || '', method: m.method || '', key: m.key || '', ts, end,
    };
  }).sort((a, b) => b.ts - a.ts);
}

/** Estado de una sesión: en curso (coincide con una sesión activa), cerrada o sin registro de cierre. */
export function sessionState(e, activeSessions = []) {
  if (e.kind !== 'login') return null;
  if (e.end) return { tone: 'off', label: 'Cerrada', dur: e.end - e.ts };
  const live = activeSessions.some((s) => s.user === e.user && s.from === e.from && Math.abs((s.since || 0) - e.ts) < 120);
  return live ? { tone: 'ok', label: 'En curso', dur: Date.now() / 1000 - e.ts } : { tone: 'warn', label: 'Sin cierre', dur: null };
}

/** Agrupa accesos exitosos por persona/llave + usuario + origen. */
export function groupLogins(events) {
  const now = Date.now() / 1000, g = new Map();
  for (const e of events) {
    if (e.kind !== 'login') continue;
    const k = `${e.key}|${e.user}|${e.from}|${e.method}`;
    if (!g.has(k)) g.set(k, { k, key: e.key, user: e.user, from: e.from, method: e.method, items: [], c24: 0, last: 0 });
    const r = g.get(k);
    r.items.push(e);
    if (now - e.ts < 86400) r.c24++;
    r.last = Math.max(r.last, e.ts);
  }
  return [...g.values()].sort((a, b) => b.last - a.last);
}

export function groupFailed(events) {
  const g = new Map();
  for (const e of events) {
    if (e.kind !== 'failed') continue;
    const k = `${e.from}`;
    if (!g.has(k)) g.set(k, { k, from: e.from, users: new Set(), items: [], last: 0 });
    const r = g.get(k);
    r.items.push(e); r.users.add(e.user); r.last = Math.max(r.last, e.ts);
  }
  return [...g.values()].sort((a, b) => b.items.length - a.items.length);
}

/** Todos los accesos SSH de la flota (para la página de auditoría). */
export async function loadSshEvents() {
  if (DEMO) return demoFleetEvents();
  const [r, info] = await Promise.all([safe(q('infra_ssh_event')), safe(q('infra_instance_info'))]);
  const names = Object.fromEntries(info.map((x) => [x.metric.instance, x.metric.hostname]));
  return parseEvents(r, (i) => names[i] || i);
}

// ---------- fechas ----------
export const fdate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const ftime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
export const fdatetime = (ts) => (ts ? new Date(ts * 1000).toLocaleString('es-CO', { hour12: false }) : '—');
export const fdur = (s) => {
  if (s == null || isNaN(s)) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
};

// ---------- CSV ----------
export function downloadCsv(filename, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const sshCsvRows = (events) => events.map((e) => [
  new Date(e.ts * 1000).toISOString(), e.host, e.kind === 'login' ? 'exitoso' : 'fallido', e.user, e.from, e.method, e.key,
  e.end ? new Date(e.end * 1000).toISOString() : '', e.end ? Math.round(e.end - e.ts) : '',
]);
export const SSH_CSV_HEADER = ['fecha_inicio', 'servidor', 'resultado', 'usuario', 'origen', 'metodo', 'llave', 'fecha_cierre', 'duracion_s'];

// ---------- demo ----------
function rnd(seed) { const x = Math.sin(seed) * 10000; return x - Math.floor(x); }
export function demoEvents(inst, host = inst, idx = 0) {
  if (inst === 'empresa-backup') return [];
  const now = Math.floor(Date.now() / 1000), out = [];
  const who = [
    ['ubuntu', '203.0.113.10', 'publickey', 'empresa-application'],
    ['ubuntu', '203.0.113.17', 'publickey', 'empresa-application'],
    ['ubuntu', '203.0.113.10', 'publickey', 'juan@macbook-pro'],
  ];
  for (let k = 0; k < 40; k++) {
    const w = who[k % 7 === 3 ? 1 : k % 5 === 0 ? 2 : 0];
    const ts = now - Math.floor(k * 3.9 * 3600 + rnd(k + idx * 11) * 3000);
    const open = k === 0;
    out.push({ id: `${inst}|l${k}`, inst, host, kind: 'login', user: w[0], from: w[1], method: w[2], key: w[3], ts, end: open ? null : ts + Math.floor(120 + rnd(k * 3 + idx) * 5400) });
  }
  for (let k = 0; k < (idx === 6 ? 30 : 6); k++) {
    const ts = now - Math.floor(k * 5.3 * 3600 + rnd(k + 99) * 2000);
    out.push({ id: `${inst}|f${k}`, inst, host, kind: 'failed', user: ['admin', 'root', 'oracle', 'test', 'ubuntu'][k % 5], from: ['203.0.113.18', '203.0.113.19', '203.0.113.20'][k % 3], method: '', key: '', ts, end: null });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
const DEMO_HOSTS = ['app-server', 'core-fineract', 'core-staging', 'core-gravitee', 'core-database', 'core-inhouse', 'historic-db2', 'empresa-web'];
function demoFleetEvents() {
  return DEMO_HOSTS.flatMap((h, i) => demoEvents(h, h, i)).sort((a, b) => b.ts - a.ts);
}
