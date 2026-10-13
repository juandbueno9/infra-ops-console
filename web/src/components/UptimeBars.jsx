// Barra de disponibilidad: un bloque por hora. Verde = 100 %, ámbar = caída parcial, rojo = caída mayor, gris = sin datos.
const color = (v) => (v == null || isNaN(v) ? 'bg-line2' : v >= 0.999 ? 'bg-ok' : v >= 0.9 ? 'bg-warn' : 'bg-crit');

export function UptimeBars({ values = [], slots = 24, size = 'sm' }) {
  const pad = Array.from({ length: Math.max(0, slots - values.length) }, () => null);
  const list = [...pad, ...values.slice(-slots)];
  const now = Date.now();
  return (
    <div className={`flex items-end ${size === 'lg' ? 'gap-[5px] h-8' : 'gap-[3px] h-5'}`} role="img"
      aria-label={`Disponibilidad por hora, últimas ${slots} horas`}>
      {list.map((v, i) => {
        const h = new Date(now - (slots - 1 - i) * 3600e3);
        const label = `${h.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })} · ${v == null ? 'sin datos' : `${(v * 100).toFixed(1)} %`}`;
        return <span key={i} title={label} className={`flex-1 rounded-sm ${color(v)} ${size === 'lg' ? 'min-w-[6px] h-full' : 'min-w-[4px] h-full'} hover:opacity-80`} />;
      })}
    </div>
  );
}

export const pctUp = (v, d = 3) => (v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(v >= 0.99995 ? 0 : d)}%`);
export const upTone = (v) => (v == null ? 'text-faint' : v >= 0.999 ? 'text-ok' : v >= 0.99 ? 'text-warn' : 'text-crit');
