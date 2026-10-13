// Vulnerabilidades de las imágenes Docker (Trivy semanal en el agente).
import { DEMO } from '../config.js';
import { q, safe } from '../lib/api.js';
import { usePolling } from '../hooks/usePolling.js';
import { Badge, Empty, Panel } from './ui.jsx';

async function loadVulns() {
  if (DEMO) return [
    { host: 'app-server', image: 'vaultwarden/server:latest', CRITICAL: 0, HIGH: 3, MEDIUM: 11 },
    { host: 'app-server', image: 'fortinet/fcems-fos:7.4', CRITICAL: 2, HIGH: 17, MEDIUM: 40 },
    { host: 'app-server', image: 'grafana/grafana-enterprise:latest', CRITICAL: 0, HIGH: 1, MEDIUM: 6 },
    { host: 'core-fineract', image: 'apache/fineract:1.9', CRITICAL: 5, HIGH: 22, MEDIUM: 58 },
  ].map((r) => ({ ...r, scanned: Date.now() / 1000 - 86400 * 2 }));
  const [v, t, info] = await Promise.all([safe(q('infra_image_vulnerabilities')), safe(q('infra_image_scan_timestamp_seconds')), safe(q('infra_instance_info'))]);
  const names = Object.fromEntries(info.map((x) => [x.metric.instance, x.metric.hostname]));
  const m = new Map();
  for (const x of v) {
    const k = `${x.metric.instance}|${x.metric.image}`;
    if (!m.has(k)) m.set(k, { host: names[x.metric.instance] || x.metric.instance, image: x.metric.image, CRITICAL: 0, HIGH: 0, MEDIUM: 0 });
    m.get(k)[x.metric.severity] = +x.value[1];
  }
  const ts = Object.fromEntries(t.map((x) => [x.metric.instance, +x.value[1]]));
  return [...m.values()].map((r) => ({ ...r, scanned: ts[Object.keys(names).find((k) => names[k] === r.host) || r.host] })).sort((a, b) => b.CRITICAL - a.CRITICAL || b.HIGH - a.HIGH);
}

export function Vulns({ className = '' }) {
  const { data, loading } = usePolling(loadVulns, 300, []);
  const rows = data || [];
  const crit = rows.reduce((t, r) => t + r.CRITICAL, 0), high = rows.reduce((t, r) => t + r.HIGH, 0);
  return (
    <Panel title="Vulnerabilidades en imágenes Docker" meta={rows.length ? `${crit} críticas · ${high} altas · escaneo semanal con Trivy` : ''} className={className} bodyClass="overflow-auto max-h-[420px]">
      <table className="tbl">
        <thead><tr><th>Imagen</th><th>Servidor</th><th className="num">Críticas</th><th className="num">Altas</th><th className="num">Medias</th><th>Acción</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => (
            <tr key={r.host + r.image}>
              <td className="font-mono text-ink text-xs">{r.image}</td><td className="text-xs text-muted">{r.host}</td>
              <td className="num">{r.CRITICAL ? <Badge tone="crit">{r.CRITICAL}</Badge> : <span className="text-faint">0</span>}</td>
              <td className="num">{r.HIGH ? <Badge tone="warn">{r.HIGH}</Badge> : <span className="text-faint">0</span>}</td>
              <td className="num text-muted">{r.MEDIUM}</td>
              <td className="text-xs text-muted">{r.CRITICAL ? 'Actualizar la imagen a la última versión' : r.HIGH ? 'Revisar en la próxima ventana' : 'Al día'}</td>
            </tr>
          )) : <tr><td colSpan={6}><Empty>{loading ? 'Cargando…' : 'Sin escaneos todavía. Se activan al actualizar el agente con --trivy (una vez por semana).'}</Empty></td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}
