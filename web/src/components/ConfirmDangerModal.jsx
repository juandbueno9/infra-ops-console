// Modal de confirmación de ALTA SEGURIDAD para acciones destructivas.
// - Advertencia visual roja + explicación del impacto
// - El botón solo se habilita al escribir exactamente el texto de confirmación
// - Estado de carga con spinner; Esc / clic fuera cancelan (salvo mientras procesa)
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IServer, IWarn } from './icons.jsx';

export function ConfirmDangerModal({ open, title, subtitle, resource, impact = [], confirmText, actionLabel, busyLabel = 'Procesando…', onConfirm, onClose }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null), dialog = useRef(null), returnFocus = useRef(null);
  const match = value === confirmText;

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    setValue(''); setBusy(false);
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => { clearTimeout(t); returnFocus.current?.focus?.({ preventScroll: true }); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') { // trampa de foco
        const f = [...dialog.current.querySelectorAll('input,button:not(:disabled)')];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!match || busy) return;
    setBusy(true);
    try {
      await Promise.all([onConfirm(value), new Promise((r) => setTimeout(r, 600))]);
      onClose();
    } catch {
      setBusy(false); // el error se notifica con un toast desde onConfirm
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-[rgba(2,6,23,.72)] backdrop-blur-[3px] grid place-items-center p-4 animate-fade"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="dm-title" aria-describedby="dm-desc"
        className="w-full max-w-[520px] bg-bg1 border border-crit/45 rounded-[14px] overflow-hidden animate-pop shadow-[0_0_0_4px_rgba(239,68,68,.08),0_30px_80px_rgba(0,0,0,.6)]">
        <div className="flex gap-3.5 px-[22px] pt-5">
          <div className="w-10 h-10 rounded-[10px] bg-crit/15 grid place-items-center shrink-0"><IWarn size={22} className="text-crit" /></div>
          <div>
            <h3 id="dm-title" className="m-0 text-base font-semibold text-ink">{title}</h3>
            <p id="dm-desc" className="mt-1 mb-0 text-muted text-[13px]">{subtitle}</p>
          </div>
        </div>
        <div className="px-[22px] py-4">
          <div className="flex items-center gap-2 bg-surface2 border border-line rounded-lg px-2.5 py-2 mb-3.5 font-mono text-[12.5px] text-ink">
            <IServer size={15} className="text-muted" /><span className="truncate">{resource}</span>
          </div>
          <div className="bg-crit/[.06] border border-crit/20 rounded-[9px] px-3 py-2.5 mb-3.5">
            <b className="block text-red-300 text-xs font-semibold mb-1">Impacto de esta acción</b>
            <ul className="m-0 pl-[18px] text-ink2 text-[12.5px] space-y-1 list-disc">{impact.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <label htmlFor="dm-input" className="block text-[12.5px] text-ink2 mb-1.5">
            Para confirmar, escribe <code className="font-mono text-ink bg-surface border border-line2 px-1.5 py-px rounded select-all">{confirmText}</code>
          </label>
          <input id="dm-input" ref={input} value={value} disabled={busy} autoComplete="off" spellCheck={false} autoCapitalize="off"
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-invalid={value.length > 0 && !match}
            className={`w-full h-[38px] bg-bg border rounded-lg text-ink font-mono text-[13px] px-3 outline-none transition-shadow
              ${match ? 'border-ok shadow-[0_0_0_3px_rgba(16,185,129,.15)]' : 'border-line2 focus:border-crit focus:shadow-[0_0_0_3px_rgba(239,68,68,.18)]'}`} />
          <div className="text-[11.5px] text-faint mt-1.5">Distingue mayúsculas y minúsculas.</div>
        </div>
        <div className="flex justify-end gap-2.5 px-[22px] py-3.5 bg-surface2 border-t border-line">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={!match || busy}>
            {busy && <span className="spin" />}{busy ? busyLabel : actionLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
