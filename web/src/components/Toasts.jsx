// Notificaciones flotantes (abajo a la derecha).
// Éxito: se cierra solo. Error: persiste hasta que el usuario lo cierre, con detalles técnicos colapsables.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { IErr, IInfo, IOk, IWarn, IX } from './icons.jsx';

const Ctx = createContext(null);
const SEEN = 'infra.toast.seen';
function throttleOk(key, every) {
  try {
    const now = Date.now(), m = JSON.parse(localStorage.getItem(SEEN) || '{}');
    if (m[key] && now - m[key] < every) return false;
    m[key] = now;
    for (const k of Object.keys(m)) if (now - m[k] > 86400e3) delete m[k];
    localStorage.setItem(SEEN, JSON.stringify(m));
  } catch { /* sin almacenamiento: se muestra */ }
  return true;
}
export const useToast = () => useContext(Ctx);

const STYLE = {
  ok: { bar: 'border-l-ok', icon: <IOk size={18} className="text-ok" /> },
  err: { bar: 'border-l-crit', icon: <IErr size={18} className="text-crit" /> },
  warn: { bar: 'border-l-warn', icon: <IWarn size={18} className="text-warn" /> },
  info: { bar: 'border-l-info', icon: <IInfo size={18} className="text-info" /> },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 200);
  }, []);

  const push = useCallback((type, title, message, opts = {}) => {
    // Avisos automáticos (con "key"): la misma notificación se muestra como máximo una vez por hora
    if (opts.key && opts.every !== 0 && !throttleOk(opts.key, opts.every ?? 3600e3)) return opts.key;
    const id = opts.key || Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.filter((t) => t.id !== id), { id, type, title, message, ...opts }].slice(-5));
    const persistent = opts.persistent ?? type === 'err';
    clearTimeout(timers.current[id]);
    if (!persistent) timers.current[id] = setTimeout(() => dismiss(id), opts.ms || (type === 'ok' ? 4500 : 6000));
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (t, m, o) => push('ok', t, m, o),
    error: (t, m, o) => push('err', t, m, o),
    warn: (t, m, o) => push('warn', t, m, o),
    info: (t, m, o) => push('info', t, m, o),
    dismiss,
  }), [push, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed right-5 bottom-5 z-[90] flex flex-col gap-2.5 w-[min(380px,calc(100vw-32px))]" role="region" aria-live="polite" aria-label="Notificaciones">
        {items.map((t) => (
          <div key={t.id} role={t.type === 'err' ? 'alert' : 'status'}
            className={`flex gap-3 bg-[#12262d] border border-line2 border-l-[3px] ${STYLE[t.type].bar} rounded-[10px] p-3 pl-3.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] transition-all duration-200 ${t.leaving ? 'opacity-0 translate-x-5' : 'animate-tin'}`}>
            <span className="mt-px shrink-0">{STYLE[t.type].icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-ink font-semibold text-[13px]">{t.title}</div>
              {t.message && <div className="text-muted text-[12.5px] mt-0.5 break-words">{t.message}</div>}
              {t.details && (
                <details className="mt-2 group">
                  <summary className="cursor-pointer text-ink2 text-xs list-none inline-flex items-center gap-1">
                    <span className="text-[10px] transition-transform group-open:rotate-90">▸</span>Detalles técnicos
                  </summary>
                  <pre className="mt-1.5 bg-bg border border-line rounded-md p-2 font-mono text-[11.5px] text-ink2 whitespace-pre-wrap break-all max-h-40 overflow-auto">{t.details}</pre>
                </details>
              )}
              {t.action && (
                <button type="button" className="mt-2 text-xs font-semibold text-info hover:underline" onClick={() => { t.action.fn(); dismiss(t.id); }}>{t.action.label}</button>
              )}
            </div>
            <button type="button" aria-label="Cerrar notificación" className="w-6 h-6 grid place-items-center rounded-md text-faint hover:bg-hover hover:text-ink shrink-0" onClick={() => dismiss(t.id)}>
              <IX size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
