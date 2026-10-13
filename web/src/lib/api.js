import { goLogin } from './me.js';
// Cliente del backend propio (/api). Las rutas son relativas para funcionar bajo cualquier subruta (/estado/).
async function call(path, opts = {}) {
  const r = await fetch(`api/${path}`, {
    cache: 'no-store',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.redirected && r.url.includes('/login')) throw new Error('Sesión expirada');
  let data = null;
  try { data = await r.json(); } catch { /* respuesta no JSON */ }
  if (r.status === 401 && data?.login) goLogin(data);
  if (!r.ok) {
    const err = new Error(data?.error || `HTTP ${r.status} en /api/${path}`);
    err.details = `Petición: ${opts.method || 'GET'} /api/${path}\nEstado: ${r.status}\nRespuesta: ${JSON.stringify(data)}`;
    throw err;
  }
  return data;
}

export const api = {
  state: () => call('state'),
  silence: (host, hours) => call(`hosts/${encodeURIComponent(host)}/silence`, { method: 'POST', body: { hours } }),
  unsilence: (host) => call(`hosts/${encodeURIComponent(host)}/silence`, { method: 'DELETE' }),
  hide: (host, confirm) => call(`hosts/${encodeURIComponent(host)}/hide`, { method: 'POST', body: { confirm } }),
  setAlias: (key, name) => call(`alias/${encodeURIComponent(key)}`, { method: 'PUT', body: { name } }),
  setPortRule: (host, port, cls, note) => call(`ports/${encodeURIComponent(host)}/${port}`, { method: 'PUT', body: { cls, note } }),
  restore: (host) => call(`hosts/${encodeURIComponent(host)}/hide`, { method: 'DELETE' }),
  audit: (params = {}) => call(`audit?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
  auditCsvUrl: (params = {}) => `api/audit.csv?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
  logEvent: (action, detail) => call('audit/event', { method: 'POST', body: { action, detail } }),
};

// ---------- Prometheus (vía backend, solo lectura) ----------
export async function q(expr) {
  const r = await fetch(`api/prom/query?query=${encodeURIComponent(expr)}`, { cache: 'no-store' });
  if (r.redirected && r.url.includes('/login')) throw new Error('Sesión expirada');
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) goLogin(j);
  if (!r.ok || j.status !== 'success') {
    const err = new Error(j.error || `HTTP ${r.status}`);
    err.details = `Consulta: ${expr}\nEstado HTTP: ${r.status}\n${j.error || ''}`;
    throw err;
  }
  return j.data.result;
}

export async function qr(expr, mins, step) {
  const end = Math.floor(Date.now() / 1000), start = end - mins * 60;
  const r = await fetch(`api/prom/query_range?query=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${step}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return j.data ? j.data.result : [];
}

export const safe = (p) => p.catch(() => []);

/** Consulta instantánea en un momento dado (unix s): para reportes de meses anteriores. */
export async function qAt(expr, time) {
  const r = await fetch(`api/prom/query?query=${encodeURIComponent(expr)}&time=${Math.floor(time)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'success') throw new Error(j.error || `HTTP ${r.status}`);
  return j.data.result;
}

/** Alertas de las reglas de Prometheus (firing y pending). */
export async function promAlerts() {
  const r = await fetch('api/prom/alerts', { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'success') throw new Error(j.error || `HTTP ${r.status}`);
  return j.data.alerts || [];
}

// ---------- Loki (logs, solo lectura) ----------
export async function lokiQuery(query, { start, end, limit = 500, direction = 'backward', step } = {}) {
  const p = new URLSearchParams({ query, limit: String(limit), direction });
  if (start) p.set('start', `${Math.floor(start)}000000000`);
  if (end) p.set('end', `${Math.floor(end)}000000000`);
  if (step) p.set('step', String(step));
  const r = await fetch(`api/loki/query_range?${p}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'success') {
    const err = new Error(j.error || j.message || `HTTP ${r.status}`);
    err.details = `LogQL: ${query}\nEstado HTTP: ${r.status}\n${j.error || ''}`;
    throw err;
  }
  return j.data;
}
export async function lokiValues(label) {
  const r = await fetch(`api/loki/label/${encodeURIComponent(label)}/values?start=${Math.floor(Date.now() / 1000 - 86400)}000000000`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return j.data || [];
}

// ---------- incidentes ----------
export const incidentsApi = {
  list: () => call('incidents'),
  create: (body) => call('incidents', { method: 'POST', body }),
  update: (id, body) => call(`incidents/${id}`, { method: 'PATCH', body }),
};

// ---------- AWS: facturación y S3 (el backend guarda en caché; force=1 = actualizar ahora) ----------
export const awsApi = {
  billing: (force) => call(`aws/billing${force ? '?force=1' : ''}`),
  s3: (force) => call(`aws/s3${force ? '?force=1' : ''}`),
};
export const fxApi = { cop: () => call('fx/cop') };
export const budgetApi = { get: () => call('aws/budget'), set: (usd) => call('aws/budget', { method: 'PUT', body: { usd } }) };
