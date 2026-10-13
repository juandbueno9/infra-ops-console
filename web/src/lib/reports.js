// Reporte mensual de disponibilidad (SLA) de sitios, servidores y agencias.
import { DEMO, NODE_JOBS } from '../config.js';
import { incidentsApi, qAt, safe } from './api.js';

export function monthOptions(n = 12) {
  const out = [], d = new Date();
  for (let i = 0; i < n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: (t => t[0].toUpperCase() + t.slice(1))(m.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })), start: m });
  }
  return out;
}

const siteName = (t) => t.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');

export async function loadReport(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(y, m - 1, 1).getTime() / 1000, monthEnd = new Date(y, m, 1).getTime() / 1000;
  const end = Math.min(Date.now() / 1000, monthEnd), win = Math.max(3600, Math.floor(end - start));
  if (DEMO) return demoReport(start, end, monthEnd);
  const W = `${win}s`, J = `job=~"${NODE_JOBS}"`, S = 'job=~"blackbox_http.*"';
  const at = (e) => safe(qAt(e, end));
  const [sU, sD, sC, sN, hU, hC, hDisk, hN, aU, aC, incs] = await Promise.all([
    at(`avg_over_time(probe_success{${S}}[${W}])`),
    at(`avg_over_time(probe_duration_seconds{${S}}[${W}])`),
    at(`count_over_time(probe_success{${S}}[${W}])`),
    at(`changes(probe_success{${S}}[${W}])`),
    at(`avg_over_time(up{${J}}[${W}])`),
    at(`avg_over_time((100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle",${J}}[5m])) * 100)[${W}:15m])`),
    at(`max_over_time(((1 - node_filesystem_avail_bytes{mountpoint="/",${J}} / node_filesystem_size_bytes{mountpoint="/",${J}}) * 100)[${W}:1h])`),
    at(`count_over_time(up{${J}}[${W}])`),
    at(`avg_over_time(probe_success{job="red_agencias"}[${W}])`),
    at(`count_over_time(probe_success{job="red_agencias"}[${W}])`),
    incidentsApi.list().catch(() => []),
  ]);
  const by = (r, k = 'instance') => Object.fromEntries(r.map((x) => [x.metric[k], +x.value[1]]));
  const D = by(sD), C = by(sC), N = by(sN), HC = by(hC), HD = by(hDisk), HN = by(hN), AC = by(aC);
  const cov = (count, interval) => Math.min(1, (count * interval) / win);
  const sites = sU.map((x) => { const i = x.metric.instance, up = +x.value[1];
    return { name: siteName(i), up, downMin: ((1 - up) * win * cov(C[i] || 0, 15)) / 60, lat: D[i], drops: Math.round((N[i] || 0) / 2), coverage: cov(C[i] || 0, 15) }; })
    .sort((a, b) => a.up - b.up);
  const servers = hU.map((x) => { const i = x.metric.instance, up = +x.value[1];
    return { name: i, up, downMin: ((1 - up) * win * cov(HN[i] || 0, 15)) / 60, cpu: HC[i], disk: HD[i], coverage: cov(HN[i] || 0, 15) }; })
    .sort((a, b) => a.up - b.up);
  const agencies = aU.map((x) => { const i = x.metric.instance, up = +x.value[1];
    return { name: x.metric.agencia || i, up, downMin: ((1 - up) * win * cov(AC[i] || 0, 30)) / 60, coverage: cov(AC[i] || 0, 30) }; })
    .sort((a, b) => a.up - b.up);
  const incidents = incs.filter((i) => { const t = Date.parse(i.startedAt) / 1000; return t >= start && t < monthEnd; });
  return { start, end, monthEnd, win, sites, servers, agencies, incidents, partial: end < monthEnd };
}

function demoReport(start, end, monthEnd) {
  const win = end - start;
  const mk = (names, base) => names.map((name, k) => { const up = Math.min(1, base - (k === 0 ? 0.02 : k % 4 === 1 ? 0.0012 : 0.00005 * k)); return { name, up, downMin: ((1 - up) * win) / 60, coverage: 1, drops: k === 0 ? 41 : k % 4 === 1 ? 3 : 0, lat: 0.2 + (k === 0 ? 2.8 : k * 0.05), cpu: 20 + k * 7, disk: 40 + k * 6 }; });
  return {
    start, end, monthEnd, win, partial: end < monthEnd,
    sites: mk(['empresa.com', 'crm.empresa.com', 'consultas.empresa.com', 'contabilidad.empresa.com', 'sucursalvirtual.empresa.com', 'vault.empresa.com', 'wiki.empresa.com', 'ofrenda.empresa.com'], 0.99995),
    servers: mk(['app-server', 'core-fineract', 'core-database', 'core-gravitee'], 0.99998),
    agencies: mk(['Neiva', 'Valledupar', 'Bogotá Principal', 'Medellín', 'Tunja', 'Barranquilla'], 0.9999),
    incidents: [{ id: 'a1b2c3d4', title: 'empresa.com intermitente (hosting externo)', severity: 'alta', status: 'investigando', startedAt: new Date((start + 86400 * 3) * 1000).toISOString(), resolvedAt: null, service: 'empresa.com' },
      { id: 'e5f6a7b8', title: 'Certificado de vault por vencer', severity: 'media', status: 'resuelto', startedAt: new Date((start + 86400 * 9) * 1000).toISOString(), resolvedAt: new Date((start + 86400 * 9.2) * 1000).toISOString(), service: 'vault.empresa.com' }],
  };
}
