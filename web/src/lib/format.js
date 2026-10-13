export const GB = (b) => (b == null || isNaN(b) ? '—' : (b / 1073741824).toFixed(b >= 10 * 1073741824 ? 0 : 1) + ' GB');

export const rate = (b) => {
  if (b == null || isNaN(b)) return '—';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let i = 0;
  while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
};

export const pct = (v) => (v == null || isNaN(v) ? '—' : v.toFixed(v < 10 ? 1 : 0) + '%');

export const dur = (s) => {
  if (s == null || isNaN(s)) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

export const since = (ts) => (ts ? dur(Date.now() / 1000 - ts) : '—');

export const hhmm = (ts) =>
  ts ? new Date(ts * 1000).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

export const clock = (ms) => new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Color de barra según umbral; los colores de estado solo aparecen al superar el umbral. */
export const meterColor = (v, base = '#1FA9C0') => (v == null ? '#64748B' : v >= 90 ? '#EF4444' : v >= 75 ? '#F59E0B' : base);

export const last = (a) => (a && a.length ? a[a.length - 1] : null);
export const ago = (a, n) => (a && a.length > n ? a[a.length - 1 - n] : null);
