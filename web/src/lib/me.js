// Usuario actual (Keycloak) y permisos. Sin Keycloak (desarrollo) todos son administradores.
import { useEffect, useState } from 'react';
import { DEMO } from '../config.js';

let cur = DEMO ? { auth: false, user: 'demo', name: 'Demo', admin: true, roles: [] } : null;
let req = null;
const subs = new Set();
export function loadMe() {
  if (cur) return Promise.resolve(cur);
  req ||= fetch('api/me', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => { cur = d || { auth: false, user: 'local', admin: true, roles: [] }; subs.forEach((f) => f(cur)); return cur; }).catch(() => { req = null; return null; });
  return req;
}
export function useMe() {
  const [me, setMe] = useState(cur);
  useEffect(() => { subs.add(setMe); loadMe(); return () => subs.delete(setMe); }, []);
  return me;
}
/** true si puede hacer cambios (rol administrador o panel sin login). */
export const useCanEdit = () => { const me = useMe(); return !me || me.admin !== false; };
/** Si una respuesta dice que la sesión venció, lleva al inicio de sesión. */
export function checkSession(r, data) {
  if (r.status === 401 && data?.login) { goLogin(data); return true; }
  return false;
}

/** A dónde ir cuando la sesión venció: por inactividad se cierra también la sesión de Keycloak. */
export function goLogin(data) {
  location.href = String(data?.login || '').includes('logout') ? 'auth/logout?idle=1' : `auth/login?back=${encodeURIComponent(location.pathname + location.hash)}`;
}
