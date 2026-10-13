// Primitivas visuales reutilizables
import { meterColor, pct } from '../lib/format.js';

export const Pulse = ({ tone = 'ok', className = '' }) => <span className={`pulse pulse-${tone} ${className}`} aria-hidden="true" />;

export const Badge = ({ tone = 'off', dot, children, title }) => (
  <span className={`badge badge-${tone}`} title={title}>
    {dot && <Pulse tone={dot} />}
    {children}
  </span>
);

export function Meter({ value, base = '#1FA9C0', className = '' }) {
  return (
    <div className={`flex items-center gap-2 min-w-[108px] ${className}`}>
      <div className="flex-1 h-1 bg-[#0e2228] rounded overflow-hidden">
        <i className="block h-full rounded transition-[width] duration-500" style={{ width: `${Math.min(100, value || 0)}%`, background: meterColor(value, base) }} />
      </div>
      <span className="font-mono text-[12px] text-ink2 w-[40px] text-right tabular-nums">{pct(value)}</span>
    </div>
  );
}

export function Panel({ title, meta, actions, children, className = '', bodyClass = '' }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-h">
          <h2>{title}</h2>
          {meta != null && <span className="panel-meta">{meta}</span>}
          {actions && <div className={meta != null ? '' : 'ml-auto'}>{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export const Empty = ({ children }) => <div className="px-4 py-6 text-center text-muted">{children}</div>;

export const Count = ({ n, tone }) => (
  <span className={`count ${n ? (tone === 'crit' ? 'bg-crit/15 text-red-300' : 'bg-warn/15 text-amber-300') : 'text-faint'}`}>{n}</span>
);

export const Kv = ({ rows, cols = 1 }) => (
  <dl className="grid gap-x-5 gap-y-2 text-[12.5px]" style={{ gridTemplateColumns: `repeat(${cols}, auto 1fr)` }}>
    {rows.map(([k, v]) => [
      <dt key={k + 'k'} className="text-muted">{k}</dt>,
      <dd key={k + 'v'} className="m-0 text-ink font-mono text-xs break-all">{v ?? '—'}</dd>,
    ])}
  </dl>
);
