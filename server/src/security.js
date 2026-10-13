// Endurecimiento del panel (controles de seguridad de la aplicación):
//  - Cabeceras de seguridad (CSP, anti-clickjacking, nosniff, HSTS, Referrer-Policy, Permissions-Policy)
//  - HTTPS obligatorio detrás de nginx (X-Forwarded-Proto)
//  - Límite de peticiones por IP: inicio de sesión, API y cambios (protección contra bots y abuso)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KC_ORIGIN = (() => { try { return new URL(process.env.KEYCLOAK_URL || '').origin; } catch { return ''; } })();

/** Hashes de los <script> en línea de index.html (el del tema), para permitirlos en la CSP sin 'unsafe-inline'. */
function inlineHashes(webDist) {
  try {
    const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  } catch { return []; }
}

export function securityHeaders(app, { webDist, production }) {
  app.disable('x-powered-by');
  let hashes = inlineHashes(webDist), hashedAt = Date.now();
  app.use((req, res, next) => {
    if (Date.now() - hashedAt > 60e3) { hashes = inlineHashes(webDist); hashedAt = Date.now(); } // por si se publica una versión nueva
    // HTTPS obligatorio: nginx indica el protocolo original
    if (production && req.get('x-forwarded-proto') === 'http') return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' ${hashes.join(' ')}`.trim(),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      `form-action 'self'${KC_ORIGIN ? ` ${KC_ORIGIN}` : ''}`,
      "frame-ancestors 'none'",
    ].join('; '));
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
}

// ---------------------------------------------------------------- límite de peticiones (ventana deslizante en memoria, por IP)
const buckets = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of buckets) if (n - v.start > 120e3) buckets.delete(k); }, 60e3).unref();
function hit(key, max, windowMs) {
  const n = Date.now(); let b = buckets.get(key);
  if (!b || n - b.start > windowMs) { b = { start: n, count: 0 }; buckets.set(key, b); }
  b.count++;
  return b.count <= max ? 0 : Math.ceil((b.start + windowMs - n) / 1000);
}
export const RATE = {
  login: Number(process.env.RATE_LOGIN_PER_MIN) || 20,     // /auth/login y /auth/callback
  api: Number(process.env.RATE_API_PER_MIN) || 1500,       // lecturas del panel (refresca mucho)
  write: Number(process.env.RATE_WRITE_PER_MIN) || 60,     // cambios (POST/PUT/DELETE)
};
export function rateLimit(app, audit) {
  const warned = new Map();
  app.use((req, res, next) => {
    const ip = req.ip || 'x';
    let wait = 0, what = '';
    if (req.path === '/auth/login' || req.path === '/auth/callback') { wait = hit(`l|${ip}`, RATE.login, 60e3); what = 'inicios de sesión'; }
    else if (req.path.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { wait = hit(`w|${ip}`, RATE.write, 60e3); what = 'cambios'; }
      if (!wait) { wait = hit(`a|${ip}`, RATE.api, 60e3); what ||= 'consultas'; }
    }
    if (!wait) return next();
    if (!warned.has(ip) || Date.now() - warned.get(ip) > 10 * 60e3) {
      warned.set(ip, Date.now());
      try { audit({ category: 'acceso', action: `demasiadas peticiones (${what}): bloqueada temporalmente`, actor: '-', ip }); } catch { /* sin auditoría */ }
    }
    res.setHeader('Retry-After', String(wait));
    if (req.path.startsWith('/api/')) return res.status(429).json({ status: 'error', error: `Demasiadas peticiones desde tu IP. Intenta en ${wait} s.` });
    return res.status(429).type('text/plain').send(`Demasiados intentos desde tu IP. Intenta de nuevo en ${wait} segundos.`);
  });
}

/** Resultado del último escaneo de dependencias (npm audit) que dejó el instalador. */
export function depAudit(dataDir) {
  const read = (f) => { try { const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); const v = j.metadata?.vulnerabilities || {}; return { at: fs.statSync(path.join(dataDir, f)).mtimeMs, critical: v.critical || 0, high: v.high || 0, moderate: v.moderate || 0, low: v.low || 0,
    items: Object.values(j.vulnerabilities || {}).filter((x) => ['critical', 'high'].includes(x.severity)).slice(0, 15).map((x) => ({ name: x.name, severity: x.severity, fix: !!x.fixAvailable })) }; } catch { return null; } };
  return { server: read('npm-audit-server.json'), web: read('npm-audit-web.json') };
}
