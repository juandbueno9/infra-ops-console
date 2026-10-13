// Inicio de sesión con Keycloak (OpenID Connect, flujo "authorization code" con cliente confidencial + PKCE).
// Roles (del cliente o del realm):
//   ROLE_MONITOREO_ADMIN → todo (puede editar nombres, reglas, silenciar, incidentes, presupuesto…)
//   ROLE_MONITOREO_USER  → solo visualización (cualquier POST/PUT/PATCH/DELETE responde 403)
// Si KEYCLOAK_URL no está definido (desarrollo en el Mac) el panel funciona sin login, como antes.
// server/.env:
//   KEYCLOAK_URL=https://sso.empresa.com:9443/realms/core
//   KEYCLOAK_CLIENT_ID=infra-ops-console
//   KEYCLOAK_CLIENT_SECRET=...
//   PUBLIC_URL=https://monitoreo.empresa.com
import crypto from 'node:crypto';

const ISSUER = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
const CID = process.env.KEYCLOAK_CLIENT_ID || 'infra-ops-console';
const SECRET = process.env.KEYCLOAK_CLIENT_SECRET || '';
const PUBLIC = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
export const ROLE_ADMIN = process.env.KEYCLOAK_ROLE_ADMIN || 'ROLE_MONITOREO_ADMIN';
export const ROLE_USER = process.env.KEYCLOAK_ROLE_USER || 'ROLE_MONITOREO_USER';
export const authEnabled = () => !!(ISSUER && SECRET && PUBLIC);
const TTL = (Number(process.env.SESSION_HOURS) || 8) * 3600e3;
const COOKIE = '__Host-infra_sid'; // __Host-: solo HTTPS, sin dominio, Path=/ (no la pueden fijar subdominios)
// Inactividad: si no hay movimiento del mouse/teclado en este tiempo, la sesión se cierra (también en Keycloak).
// La actualización automática de datos NO cuenta como actividad.
export const IDLE = (Number(process.env.SESSION_IDLE_MIN) || 4) * 60e3;

const sessions = new Map();   // sid → { user, name, email, roles, admin, idToken, exp }
const pending = new Map();    // state → { verifier, nonce, back, exp }
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (v.exp < n || n - v.active > IDLE + 3600e3) sessions.delete(k); for (const [k, v] of pending) if (v.exp < n) pending.delete(k); }, 60e3).unref();

let disc = null;
async function discovery() {
  if (disc) return disc;
  const r = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Keycloak no respondió la configuración (${r.status})`);
  disc = await r.json(); return disc;
}
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };
const cookies = (req) => Object.fromEntries((req.get('cookie') || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const setCookie = (res, v, maxAge) => res.append('Set-Cookie', `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}`);

export function session(req) {
  if (!authEnabled()) return null;
  const s = sessions.get(cookies(req)[COOKIE]);
  return s && s.exp > Date.now() && Date.now() - s.active < IDLE ? s : null;
}
const idleLeft = (s) => Math.max(0, IDLE - (Date.now() - s.active));

/** Rutas /auth/* y protección de todo lo demás. Se monta antes de cualquier ruta. */
export function mountAuth(app, audit) {
  if (!authEnabled()) { console.log('[auth] Keycloak no configurado: panel sin inicio de sesión'); return; }
  console.log(`[auth] Inicio de sesión con Keycloak: ${ISSUER} · cliente ${CID}`);

  app.get('/auth/login', async (req, res) => {
    try {
      const d = await discovery();
      const state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(32)), nonce = b64url(crypto.randomBytes(12));
      const back = typeof req.query.back === 'string' && req.query.back.startsWith('/') && !req.query.back.startsWith('//') ? req.query.back : '/';
      pending.set(state, { verifier, nonce, back, exp: Date.now() + 10 * 60e3 });
      const u = new URL(d.authorization_endpoint);
      Object.entries({ client_id: CID, response_type: 'code', scope: 'openid profile email', redirect_uri: `${PUBLIC}/auth/callback`, state, nonce,
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' }).forEach(([k, v]) => u.searchParams.set(k, v));
      res.redirect(u.toString());
    } catch (e) { res.status(502).type('text/plain').send(`No se pudo contactar el inicio de sesión: ${e.message}`); }
  });

  app.get('/auth/callback', async (req, res) => {
    const p = pending.get(String(req.query.state || ''));
    if (!p) return res.redirect('/auth/login');
    pending.delete(String(req.query.state));
    if (req.query.error) return res.status(401).type('text/plain').send(`Inicio de sesión cancelado: ${req.query.error_description || req.query.error}`);
    try {
      const d = await discovery();
      const r = await fetch(d.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: `${PUBLIC}/auth/callback`, client_id: CID, client_secret: SECRET, code_verifier: p.verifier }) });
      const t = await r.json();
      if (!r.ok) throw new Error(t.error_description || t.error || r.status);
      // Los tokens llegan directo del endpoint de Keycloak por TLS con autenticación del cliente: se pueden leer sin reverificar firma
      const id = decode(t.id_token), at = decode(t.access_token);
      if (id.nonce !== p.nonce || (id.aud !== CID && !(Array.isArray(id.aud) && id.aud.includes(CID)))) throw new Error('Respuesta de inicio de sesión inválida');
      // Los roles pueden venir en distintos lugares según cómo esté configurado el realm:
      // realm_access.roles, resource_access.<cliente>.roles, un claim "roles"/"groups" propio o solo en /userinfo.
      let ui = {};
      try { if (d.userinfo_endpoint) { const u = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(8000) }); if (u.ok) ui = await u.json(); } } catch { /* sin userinfo */ }
      const found = new Set();
      const walk = (o, depth = 0) => { if (!o || depth > 4) return; if (Array.isArray(o)) { for (const x of o) typeof x === 'string' ? found.add(x.replace(/^\//, '')) : walk(x, depth + 1); } else if (typeof o === 'object') for (const v of Object.values(o)) walk(v, depth + 1); };
      for (const src of [at.realm_access, at.resource_access, at.roles, at.groups, id.roles, id.groups, id.realm_access, ui.roles, ui.groups, ui.realm_access, ui.resource_access]) walk(src);
      const roles = [...found];
      const admin = roles.includes(ROLE_ADMIN), viewer = admin || roles.includes(ROLE_USER);
      const user = id.preferred_username || id.email || id.sub;
      if (!viewer) {
        audit({ category: 'acceso', action: 'acceso denegado (sin rol de monitoreo)', actor: user, ip: req.ip });
        console.warn(`[auth] ${user} sin rol de monitoreo. Claims del token: ${Object.keys(at).join(', ')} · roles vistos: ${roles.slice(0, 30).join(', ') || 'ninguno'}`);
        return res.status(403).type('html').send(`<meta charset="utf-8"><body style="font-family:system-ui;background:#081318;color:#e2e8f0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>Sin permiso</h2><p>Tu usuario <b>${String(user).replace(/[<>&"]/g, '')}</b> no tiene el rol ${ROLE_USER} ni ${ROLE_ADMIN}.</p><p>Pídelo al administrador de Keycloak.</p><a style="color:#3CC6DA" href="/auth/logout">Cerrar sesión</a></div></body>`);
      }
      const sid = b64url(crypto.randomBytes(32));
      sessions.set(sid, { user, name: id.name || user, email: id.email || '', roles, admin, idToken: t.id_token, exp: Date.now() + TTL, active: Date.now() });
      setCookie(res, sid, TTL);
      audit({ category: 'acceso', action: `inició sesión (${admin ? 'administrador' : 'solo lectura'})`, actor: user, ip: req.ip });
      res.redirect(p.back);
    } catch (e) { res.status(502).type('text/plain').send(`No se pudo completar el inicio de sesión: ${e.message}`); }
  });

  // El navegador avisa cuando la persona mueve el mouse o escribe (máx. cada 30 s)
  app.post('/auth/activity', (req, res) => {
    const s = session(req);
    if (!s) return res.status(401).json({ status: 'error', login: '/auth/logout?idle=1' });
    s.active = Date.now(); res.json({ status: 'success', idleLeftMs: idleLeft(s), idleMs: IDLE });
  });
  app.get('/auth/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = session(req);
    res.json(s ? { status: 'success', idleLeftMs: idleLeft(s), idleMs: IDLE } : { status: 'error', idleLeftMs: 0, idleMs: IDLE, login: '/auth/logout?idle=1' });
  });

  app.get('/auth/logout', async (req, res) => {
    const sid = cookies(req)[COOKIE], s = sessions.get(sid);
    if (s) audit({ category: 'acceso', action: req.query.idle ? 'sesión cerrada por inactividad' : 'cerró sesión', actor: s.user, ip: req.ip });
    sessions.delete(sid); setCookie(res, '', 0);
    try {
      const d = await discovery();
      if (d.end_session_endpoint) {
        const u = new URL(d.end_session_endpoint);
        u.searchParams.set('post_logout_redirect_uri', `${PUBLIC}/`); u.searchParams.set('client_id', CID);
        if (s?.idToken) u.searchParams.set('id_token_hint', s.idToken);
        return res.redirect(u.toString());
      }
    } catch { /* sin Keycloak: solo se borra la sesión local */ }
    res.redirect('/');
  });

  // Protección: sin sesión → login; rol de solo lectura → sin cambios
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/api/health') return next(); // health: solo dice si el panel está vivo (lo usan los scripts de instalación)
    const raw = sessions.get(cookies(req)[COOKIE]);
    const s = session(req);
    if (!s) {
      // Venció por inactividad: hay que cerrar también la sesión de Keycloak, si no, volvería a entrar sin pedir contraseña
      const idle = raw && raw.exp > Date.now();
      const to = idle ? '/auth/logout?idle=1' : '/auth/login';
      if (req.path.startsWith('/api/')) return res.status(401).json({ status: 'error', error: idle ? 'Sesión cerrada por inactividad' : 'Sesión vencida: vuelve a iniciar sesión', login: to });
      return res.redirect(idle ? to : `/auth/login?back=${encodeURIComponent(req.originalUrl)}`);
    }
    if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !s.admin) {
      return res.status(403).json({ status: 'error', error: 'Tu usuario es de solo visualización (ROLE_MONITOREO_USER): no puede hacer cambios' });
    }
    next();
  });
}
