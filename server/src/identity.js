// Identidad de quien usa el panel.
//  - Producción: el navegador envía la cookie de sesión de Grafana (mismo dominio). El backend
//    pregunta a Grafana /api/user con esa cookie y obtiene el login real. Caché de 60 s.
//  - Desarrollo (sin GRAFANA_URL): "local" + IP.
import { config } from './config.js';
import { session } from './auth.js';

const cache = new Map();

export async function whoIs(req) {
  const ip = req.ip || '';
  const ses = session(req);
  if (ses) return { user: ses.user, ip };
  if (config.userHeader && req.get(config.userHeader)) return { user: req.get(config.userHeader), ip };
  if (!config.grafanaUrl) return { user: 'local', ip };
  const cookie = req.get('cookie') || '';
  const m = cookie.match(/grafana_session=([^;]+)/);
  if (!m) return { user: 'sin sesión', ip };
  const hit = cache.get(m[1]);
  if (hit && hit.exp > Date.now()) return { user: hit.user, ip };
  try {
    const r = await fetch(`${config.grafanaUrl}/api/user`, { headers: { cookie: `grafana_session=${m[1]}` }, signal: AbortSignal.timeout(3000) });
    const j = r.ok ? await r.json() : null;
    const user = j ? (j.login || j.email || j.name) : 'sesión inválida';
    cache.set(m[1], { user, exp: Date.now() + 60e3 });
    return { user, ip };
  } catch {
    return { user: 'desconocido', ip };
  }
}
