// Tema del panel: 'dark' (Noche), 'light' (Día) o 'auto' (sigue al sistema operativo).
// index.html aplica el tema antes de pintar para evitar parpadeo; aquí se cambia en caliente.
import { useEffect, useState } from 'react';

const KEY = 'infra.theme';
export const THEMES = ['dark', 'light', 'auto'];
export const THEME_LABEL = { dark: 'Noche', light: 'Día', auto: 'Automático' };

export const readTheme = () => { try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : 'dark'; } catch { return 'dark'; } };
const sysLight = () => !!window.matchMedia?.('(prefers-color-scheme: light)').matches;
export const resolveTheme = (t) => (t === 'auto' ? (sysLight() ? 'light' : 'dark') : t);

export function applyTheme(t, animate = false) {
  const eff = resolveTheme(t), root = document.documentElement;
  if (animate) { root.classList.add('theme-anim'); setTimeout(() => root.classList.remove('theme-anim'), 450); }
  root.dataset.theme = eff;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', eff);
  window.dispatchEvent(new CustomEvent('infra-theme', { detail: eff }));
}

/** Hook: [preferencia, efectivo, cambiar] */
export function useTheme() {
  const [pref, setPref] = useState(readTheme);
  const [eff, setEff] = useState(() => resolveTheme(readTheme()));
  useEffect(() => {
    const on = (e) => setEff(e.detail);
    window.addEventListener('infra-theme', on);
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    const sys = () => { if (readTheme() === 'auto') applyTheme('auto', true); };
    mq?.addEventListener?.('change', sys);
    return () => { window.removeEventListener('infra-theme', on); mq?.removeEventListener?.('change', sys); };
  }, []);
  const change = (t) => { try { localStorage.setItem(KEY, t); } catch { /* sin almacenamiento */ } setPref(t); applyTheme(t, true); };
  return [pref, eff, change];
}
