// Cierre de sesión por inactividad (solo cuando el panel tiene inicio de sesión con Keycloak).
// Cuenta como actividad: mover el mouse, hacer clic, escribir, desplazarse o tocar la pantalla.
// La actualización automática de datos NO cuenta. 30 s antes de cerrar muestra un aviso con cuenta regresiva.
// El servidor también lleva la cuenta, así que cerrar la pestaña o tener otra pestaña abierta no la deja abierta.
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../lib/me.js';

const WARN_MS = 30e3;      // aviso antes de cerrar
const PING_MS = 30e3;      // cada cuánto se avisa al servidor como máximo
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

const logout = () => { location.href = 'auth/logout?idle=1'; };
const ping = () => fetch('auth/activity', { method: 'POST', cache: 'no-store' }).then((r) => r.json()).catch(() => null);
const status = () => fetch('auth/status', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);

export function IdleGuard() {
  const me = useMe();
  const idleMs = (me?.idleMin || 4) * 60e3;
  const last = useRef(Date.now());       // última actividad en esta pestaña
  const lastPing = useRef(Date.now());
  const [left, setLeft] = useState(null); // ms restantes cuando se muestra el aviso

  useEffect(() => {
    if (!me?.auth) return undefined;
    const warnRef = { on: false };
    const onAct = () => {
      const n = Date.now(); last.current = n;
      // Durante el aviso cualquier movimiento renueva al instante; si no, máximo cada 30 s
      if (warnRef.on || n - lastPing.current > PING_MS) { lastPing.current = n; ping().then((d) => { if (d?.login) logout(); }); if (warnRef.on) { warnRef.on = false; setLeft(null); } }
    };
    EVENTS.forEach((e) => window.addEventListener(e, onAct, { passive: true, capture: true }));
    let checking = false;
    const tick = async () => {
      const localLeft = idleMs - (Date.now() - last.current);
      if (localLeft > WARN_MS) return;
      if (checking) return; checking = true;
      // Puede que el usuario esté activo en otra pestaña: el servidor tiene la última palabra
      const d = await status(); checking = false;
      if (!d || d.login || d.idleLeftMs <= 0) { if (d) logout(); return; }
      const remaining = Math.max(localLeft, d.idleLeftMs);
      if (remaining > WARN_MS) { last.current = Date.now() - (idleMs - remaining); warnRef.on = false; setLeft(null); return; }
      warnRef.on = true; setLeft(remaining);
    };
    const t = setInterval(tick, 1000);
    // Al volver a la pestaña (o al despertar el equipo) se revisa enseguida
    const onVis = () => { if (document.visibilityState === 'visible') status().then((d) => { if (d && (d.login || d.idleLeftMs <= 0)) logout(); }); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); EVENTS.forEach((e) => window.removeEventListener(e, onAct, { capture: true })); document.removeEventListener('visibilitychange', onVis); };
  }, [me?.auth, idleMs]);

  if (left == null) return null;
  const s = Math.ceil(left / 1000);
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 backdrop-blur-sm" role="alertdialog" aria-labelledby="idle-t">
      <div className="w-[min(92vw,380px)] rounded-xl border border-line bg-bg1 p-5 text-center shadow-2xl">
        <h2 id="idle-t" className="text-[15px] font-semibold text-ink">¿Sigues ahí?</h2>
        <p className="mt-2 text-[13px] text-muted">Por seguridad, la sesión se cerrará por inactividad en</p>
        <p className="my-3 font-mono text-3xl text-warn">{s} s</p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={() => { last.current = Date.now(); lastPing.current = Date.now(); ping().then((d) => { if (d?.login) logout(); }); setLeft(null); }}
            className="h-9 px-4 rounded-lg bg-info/20 border border-info/40 text-info text-[13px] font-medium hover:bg-info/30">Seguir conectado</button>
          <button type="button" onClick={logout} className="h-9 px-4 rounded-lg border border-line text-ink2 text-[13px] hover:bg-surface">Salir</button>
        </div>
      </div>
    </div>
  );
}
