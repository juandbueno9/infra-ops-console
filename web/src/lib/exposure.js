// Exposición de puertos vista desde Internet (Blackbox tcp_connect, job "exposicion_puertos").
// La sonda sale del servidor de monitoreo en AWS: un puerto "abierto" aquí es alcanzable desde Internet.
import { DEMO } from '../config.js';
import { q, safe } from './api.js';

export const EXPOSE_PORTS = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 80: 'HTTP', 443: 'HTTPS', 445: 'SMB (carpetas Windows)', 1433: 'SQL Server', 1521: 'Oracle',
  3306: 'MySQL', 3389: 'Escritorio remoto (RDP)', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP alterno', 8443: 'HTTPS alterno',
  9090: 'Prometheus', 9100: 'node_exporter', 10443: 'Administración FortiGate', 27017: 'MongoDB',
};
const EXPECTED = new Set([80, 443]);
const REVIEW = new Set([22, 8080, 8443, 25]);

/** Riesgo de un puerto abierto a Internet. */
export function portRisk(port) {
  if (EXPECTED.has(port)) return ['Esperado', 'ok'];
  if (REVIEW.has(port)) return ['Revisar', 'warn'];
  return ['Crítico', 'crit'];
}

export async function loadExposure() {
  if (DEMO) return demoExposure();
  const [ok, dur] = await Promise.all([safe(q('probe_success{job="exposicion_puertos"}')), safe(q('probe_duration_seconds{job="exposicion_puertos"}'))]);
  const d = Object.fromEntries(dur.map((x) => [x.metric.instance, +x.value[1]]));
  const map = new Map();
  for (const x of ok) {
    const inst = x.metric.instance, i = inst.lastIndexOf(':');
    const target = inst.slice(0, i), port = +inst.slice(i + 1);
    const name = x.metric.objetivo || target;
    if (!map.has(name)) map.set(name, { name, target, owner: x.metric.propietario || '', ports: [] });
    map.get(name).ports.push({ port, open: +x.value[1] === 1, ms: d[inst] != null ? d[inst] * 1000 : null });
  }
  return summarize([...map.values()]);
}

function summarize(list) {
  return list.map((t) => {
    t.ports.sort((a, b) => a.port - b.port);
    const open = t.ports.filter((p) => p.open);
    const crit = open.filter((p) => portRisk(p.port)[1] === 'crit').length, warn = open.filter((p) => portRisk(p.port)[1] === 'warn').length;
    return { ...t, open, crit, warn, tone: crit ? 'crit' : warn ? 'warn' : 'ok' };
  }).sort((a, b) => b.crit - a.crit || b.warn - a.warn || a.name.localeCompare(b.name));
}

function demoExposure() {
  const P = Object.keys(EXPOSE_PORTS).map(Number);
  const mk = (name, target, owner, openList) => ({ name, target, owner, ports: P.map((port) => ({ port, open: openList.includes(port), ms: openList.includes(port) ? 20 + (port % 90) : null })) });
  return summarize([
    mk('empresa.com', 'empresa.com', 'Hosting externo · 203.0.113.24', [80, 443, 21, 3306]),
    mk('sucursalvirtual.empresa.com', 'sucursalvirtual.empresa.com', 'Proveedor (Google Cloud) · 203.0.113.25', [80, 443]),
    mk('FortiGate oficina (WAN)', '203.0.113.10', 'INFRA OPS-PPAL', [443, 10443]),
    mk('app-server', '203.0.113.11', 'AWS EC2', [80, 443, 22]),
  ]);
}
