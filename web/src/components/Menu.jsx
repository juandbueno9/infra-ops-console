// Menú contextual accesible (botón ⋯). Se renderiza en un portal, se cierra con Esc, clic fuera o scroll.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IDots } from './icons.jsx';

/**
 * items: [{ label, icon, hint, danger, onSelect } | 'sep' | { header }]
 */
export function Menu({ items, label = 'Acciones', trigger, buttonClass = 'kebab' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const btn = useRef(null), menu = useRef(null);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const r = btn.current.getBoundingClientRect(), w = menu.current.offsetWidth, h = menu.current.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left: Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w)), top });
    menu.current.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const scroll = (e) => { if (!menu.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [open]);

  const onKey = (e) => {
    const list = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  };

  return (
    <>
      <button ref={btn} type="button" className={buttonClass} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {trigger || <IDots />}
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" onKeyDown={onKey} onClick={(e) => e.stopPropagation()} style={{ left: pos.left, top: pos.top }}
          className="fixed z-[60] min-w-[236px] bg-[#12262d] border border-line2 rounded-[10px] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,.5)] animate-pop">
          {items.map((it, i) =>
            it === 'sep' ? <div key={i} role="separator" className="h-px bg-line my-1.5 mx-1" />
              : it.header ? <div key={i} className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint font-medium">{it.header}</div>
                : (
                  <button key={i} type="button" role="menuitem" disabled={it.disabled}
                    onClick={() => { setOpen(false); it.onSelect?.(); }}
                    className={`flex items-center gap-2.5 w-full px-2.5 py-[7px] rounded-md text-[12.5px] text-left outline-none disabled:opacity-50 disabled:cursor-default
                      ${it.danger ? 'text-red-300 hover:bg-crit/10 focus-visible:bg-crit/10' : 'text-ink2 hover:bg-hover hover:text-ink focus-visible:bg-hover'}`}>
                    <span className={`shrink-0 ${it.danger ? 'text-crit' : 'text-muted'}`}>{it.icon}</span>
                    <span className="truncate">{it.label}</span>
                    {it.hint && <span className="ml-auto pl-3 font-mono text-[11px] text-faint truncate max-w-[120px]">{it.hint}</span>}
                  </button>
                ))}
        </div>, document.body)}
    </>
  );
}
