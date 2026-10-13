// Azure por su API (SOLO LECTURA, sin instalar nada en las máquinas):
//  - Máquinas virtuales: estado (encendida/apagada), tamaño, CPU %, memoria % y red de la última hora (Azure Monitor).
//  - Conexiones VPN: estado y tráfico.
// Requiere una "aplicación" de Entra ID con rol Lector (Reader) en la suscripción. server/.env:
//   AZURE_TENANT_ID=...   AZURE_CLIENT_ID=...   AZURE_CLIENT_SECRET=...
//   (opcional) AZURE_SUBSCRIPTIONS=id1,id2   → si no se define, se usan todas las que la aplicación pueda ver.
const T = process.env.AZURE_TENANT_ID || '', C = process.env.AZURE_CLIENT_ID || '', S = process.env.AZURE_CLIENT_SECRET || '';
export const azConfigured = () => !!(T && C && S);
// Conexiones VPN que ya no se usan y no se deben mostrar ni alertar (p. ej. Tunja pasó a SD-WAN). server/.env: AZURE_VPN_IGNORE=a,b
const VPN_IGNORE = new Set((process.env.AZURE_VPN_IGNORE ?? 'vpn-ipsec-tunja').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
const ARM = 'https://management.azure.com';

let tok = null;
async function token() {
  if (tok && tok.exp - Date.now() > 120e3) return tok.v;
  const r = await fetch(`https://login.microsoftonline.com/${T}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: C, client_secret: S, scope: `${ARM}/.default` }), signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Azure rechazó las credenciales: ${j.error_description?.split('\n')[0] || j.error || r.status}`);
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.v;
}
async function get(path) {
  const r = await fetch(path.startsWith('http') ? path : ARM + path, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status, code: j.error?.code });
  return j;
}
async function all(path) { const out = []; let next = path; while (next) { const j = await get(next); out.push(...(j.value || [])); next = j.nextLink || null; } return out; }
const rgOf = (id) => (id.match(/resourceGroups\/([^/]+)/i) || [])[1] || '';

const sizes = {};
async function vmSizes(sub, loc) {
  const k = `${sub}|${loc}`;
  if (!sizes[k]) sizes[k] = all(`/subscriptions/${sub}/providers/Microsoft.Compute/locations/${loc}/vmSizes?api-version=2024-07-01`).then((l) => Object.fromEntries(l.map((x) => [x.name, x]))).catch(() => ({}));
  return sizes[k];
}

async function vmMetrics(id) {
  const names = ['Percentage CPU', 'Available Memory Bytes', 'Network In Total', 'Network Out Total'].map(encodeURIComponent).join(',');
  const j = await get(`${id}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnames=${names}&timespan=PT1H&interval=PT5M&aggregation=Average,Total`);
  const m = {};
  for (const x of j.value || []) {
    const pts = x.timeseries?.[0]?.data || [];
    const isTotal = /Network/.test(x.name.value);
    const vals = pts.map((p) => (isTotal ? p.total : p.average)).filter((v) => v != null);
    m[x.name.value] = { last: vals.length ? vals[vals.length - 1] : null, series: vals, sum: vals.reduce((t, v) => t + v, 0) };
  }
  return m;
}

let memo = null, running = null;
export async function azStatus(force = false) {
  if (memo && !force && Date.now() - memo.at < 60e3) return memo;
  if (running) return running;
  running = (async () => {
    try {
      const subs = process.env.AZURE_SUBSCRIPTIONS ? process.env.AZURE_SUBSCRIPTIONS.split(',').map((s) => ({ subscriptionId: s.trim(), displayName: s.trim() }))
        : await all('/subscriptions?api-version=2022-12-01');
      const vms = [], vpns = [], errors = [];
      for (const sub of subs) {
        const sid = sub.subscriptionId;
        const list = await all(`/subscriptions/${sid}/providers/Microsoft.Compute/virtualMachines?api-version=2024-07-01&statusOnly=true`).catch((e) => { errors.push(`${sub.displayName}: ${e.message}`); return []; });
        await Promise.all(list.map(async (v) => {
          const st = v.properties?.instanceView?.statuses || [];
          const power = (st.find((s) => s.code?.startsWith('PowerState/'))?.code || 'PowerState/unknown').split('/')[1];
          const full = await get(`${v.id}?api-version=2024-07-01`).catch(() => v);
          const size = full.properties?.hardwareProfile?.vmSize || '';
          const os = full.properties?.storageProfile?.osDisk?.osType || '';
          const memMB = (await vmSizes(sid, full.location || v.location))[size]?.memoryInMB || null;
          const vcpu = (await vmSizes(sid, full.location || v.location))[size]?.numberOfCores || null;
          let m = {}; if (power === 'running') m = await vmMetrics(v.id).catch((e) => { errors.push(`${v.name}: métricas ${e.message}`); return {}; });
          const avail = m['Available Memory Bytes']?.last;
          vms.push({
            id: v.id, name: v.name, rg: rgOf(v.id), sub: sub.displayName, location: full.location || v.location, size, os, vcpu, memMB, power,
            cpu: m['Percentage CPU']?.last ?? null, cpuSeries: m['Percentage CPU']?.series || [],
            mem: avail != null && memMB ? Math.max(0, Math.min(100, 100 * (1 - avail / (memMB * 1048576)))) : null,
            netIn: m['Network In Total']?.sum ?? null, netOut: m['Network Out Total']?.sum ?? null,
          });
        }));
        const conns = await all(`/subscriptions/${sid}/providers/Microsoft.Network/connections?api-version=2024-05-01`).catch(() => []);
        await Promise.all(conns.map(async (c) => {
          if (VPN_IGNORE.has(String(c.name).toLowerCase())) return;
          const d = await get(`${c.id}?api-version=2024-05-01`).catch(() => c);
          vpns.push({ name: c.name, rg: rgOf(c.id), status: d.properties?.connectionStatus || 'Unknown', protocol: d.properties?.connectionProtocol || '', inBytes: d.properties?.ingressBytesTransferred ?? null, outBytes: d.properties?.egressBytesTransferred ?? null, custom: (d.properties?.ipsecPolicies || []).length > 0 });
        }));
      }
      memo = { configured: true, at: Date.now(), subscriptions: subs.map((s) => s.displayName), vms: vms.sort((a, b) => a.name.localeCompare(b.name)), vpns: vpns.sort((a, b) => a.name.localeCompare(b.name)), errors };
      return memo;
    } finally { running = null; }
  })();
  return running;
}
