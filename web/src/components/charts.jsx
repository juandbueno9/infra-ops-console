// Gráficos SVG ligeros: sparkline, gráfico de línea con tooltip y tarjeta KPI.
// Una sola serie por gráfico; los colores de estado se reservan para estados.
import { useRef, useState } from 'react';

export function Sparkline({ values, color = '#1FA9C0', className = 'w-[90px] h-[22px]' }) {
  if (!values || values.length < 2) return <svg className={className} aria-hidden="true" />;
  const W = 100, H = 28, mx = Math.max(...values), mn = Math.min(...values), rg = mx - mn || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(2)},${(H - 2 - ((v - mn) / rg) * (H - 6)).toFixed(2)}`).join(' ');
  return (
    <svg className={`block ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity=".14" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const tfmt = (t, full) => new Date(t * 1000).toLocaleString('es-CO', full
  ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
  : { hour: '2-digit', minute: '2-digit', hour12: false });

/** series: [[unixTs, valor%], ...] */
/** max: número o 'auto'; fmt: formato del eje y del tooltip. */
export function LineChart({ series, color = '#1FA9C0', label = 'Valor', max = 100, fmt = (v) => `${Math.round(v)}%`, tipFmt, height = 190 }) {
  const [hover, setHover] = useState(null);
  const svg = useRef(null);
  const W = 600, H = height, pl = 44, pr = 10, pt = 10, pb = 22, w = W - pl - pr, h = H - pt - pb;
  let top = max;
  if (max === 'auto') {
    const m = Math.max(1, ...(series || []).map((x) => x[1]));
    const mag = 10 ** Math.floor(Math.log10(m)); top = Math.ceil((m * 1.15) / mag) * mag;
  }
  const grid = [0, .25, .5, .75, 1].map((f) => f * top);
  const Y = (v) => pt + h - (Math.min(top, Math.max(0, v)) / top) * h;
  const tf = tipFmt || ((v) => (max === 100 ? `${v.toFixed(1)}%` : fmt(v)));

  if (!series || series.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height }} preserveAspectRatio="none">
        {grid.map((v) => <line key={v} x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="#263349" strokeDasharray={v ? '2 4' : undefined} />)}
        <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-faint text-[10px] font-mono">Sin datos todavía</text>
      </svg>
    );
  }
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const X = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * w;
  const pts = series.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');

  const onMove = (e) => {
    const r = svg.current.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    if (vx < pl || vx > W - pr) return setHover(null);
    const t = t0 + ((vx - pl) / w) * (t1 - t0);
    let i = 0, best = Infinity;
    series.forEach(([ts], k) => { const d = Math.abs(ts - t); if (d < best) { best = d; i = k; } });
    setHover({ i, left: (X(series[i][0]) / W) * r.width, top: (Y(series[i][1]) / H) * r.height, width: r.width });
  };

  const hv = hover && series[hover.i];
  return (
    <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={`${label}, últimas 6 horas`}>
        {grid.map((v) => (
          <g key={v}>
            <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="#263349" strokeDasharray={v ? '2 4' : undefined} />
            <text x={pl - 8} y={Y(v) + 3} textAnchor="end" className="fill-faint text-[10px] font-mono">{fmt(v)}</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const t = t0 + ((t1 - t0) * i) / 4;
          return <text key={i} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-faint text-[10px] font-mono">{tfmt(t)}</text>;
        })}
        <polygon points={`${pl},${pt + h} ${pts} ${X(t1)},${pt + h}`} fill={color} opacity=".12" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hv && (
          <>
            <line x1={X(hv[0])} x2={X(hv[0])} y1={pt} y2={pt + h} stroke="#94A3B8" opacity=".5" vectorEffect="non-scaling-stroke" />
            <circle cx={X(hv[0])} cy={Y(hv[1])} r="4" fill={color} stroke="#1E293B" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hv && (
        <div className="absolute pointer-events-none bg-[#0a1a1f] border border-line2 rounded-md px-2.5 py-1.5 font-mono text-[11.5px] text-ink shadow-lg whitespace-nowrap -translate-x-1/2 -translate-y-[115%]"
          style={{ left: Math.min(hover.width - 70, Math.max(70, hover.left)), top: hover.top }}>
          <div className="text-faint text-[10.5px]">{tfmt(hv[0], true)}</div>
          {label} <b>{tf(hv[1])}</b>
        </div>
      )}
    </div>
  );
}

/** Tarjeta KPI compacta con cambio vs. hace 1 hora y tendencia. */
export function KpiCard({ label, value, unit, delta, deltaUnit = 'pp', badUp = true, foot, spark, color = '#1FA9C0', lead }) {
  let dl = null;
  if (delta != null && isFinite(delta) && Math.abs(delta) >= 0.05) {
    const up = delta > 0, bad = up === badUp;
    dl = (
      <span className="font-mono text-[11.5px] text-ink2 inline-flex items-center gap-1 whitespace-nowrap" title="Cambio frente a hace 1 hora">
        <i className={`not-italic text-[10px] ${bad ? 'text-crit' : 'text-ok'}`}>{up ? '▲' : '▼'}</i>
        {up ? '+' : ''}{deltaUnit === '%' ? `${delta.toFixed(0)}%` : `${delta.toFixed(1)} pp`}
      </span>
    );
  }
  return (
    <div className="kpi-card border rounded-[12px] px-3.5 pt-3 pb-2.5 min-w-0" onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`); }}>
      <div className="flex items-center gap-1.5 text-xs text-muted font-medium">{lead}{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="font-mono text-2xl font-semibold text-ink tracking-tight tabular-nums">
          {value}{unit && <small className="text-[13px] text-muted font-medium ml-0.5">{unit}</small>}
        </span>
        {dl}
      </div>
      {foot && <div className="text-[11.5px] text-faint mt-0.5 truncate">{foot}</div>}
      {spark && spark.length > 1 && <Sparkline values={spark} color={color} className="w-full h-7 mt-1.5" />}
    </div>
  );
}
