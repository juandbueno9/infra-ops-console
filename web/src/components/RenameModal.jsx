// Cambiar el nombre visible de un servidor o NAS (solo en el panel; no toca el equipo). Se guarda para todo el equipo.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function RenameModal({ target, onClose, onSave }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (target) { setName(target.current || ''); setBusy(false); setTimeout(() => ref.current?.select(), 30); } }, [target]);
  useEffect(() => { if (!target) return undefined; const k = (e) => e.key === 'Escape' && !busy && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [target, busy, onClose]);
  if (!target) return null;
  const clean = name.trim();
  const valid = clean.length <= 60 && /^[\p{L}\p{N} ._()/·-]*$/u.test(clean);
  const save = async (value) => { setBusy(true); try { await onSave(value); onClose(); } catch { setBusy(false); } };
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-[rgba(2,6,23,.72)] backdrop-blur-[3px] grid place-items-center p-4 animate-fade" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="rn-title" className="w-full max-w-[440px] bg-bg1 border border-line rounded-[14px] overflow-hidden animate-pop shadow-[0_30px_80px_rgba(0,0,0,.6)]">
        <div className="px-[22px] pt-5">
          <h3 id="rn-title" className="m-0 text-base font-semibold text-ink">Cambiar nombre</h3>
          <p className="mt-1 mb-0 text-muted text-[12.5px]">Solo cambia cómo se ve en el panel, para todo el equipo. No cambia nada en el equipo, sitio o servicio real.</p>
        </div>
        <form className="px-[22px] py-4" onSubmit={(e) => { e.preventDefault(); if (valid && clean && !busy) save(clean); }}>
          <div className="text-[11.5px] text-faint mb-1.5">Original: <span className="font-mono text-ink2">{target.original}</span></div>
          <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={target.original} aria-label="Nuevo nombre"
            className={`w-full h-[38px] bg-bg border rounded-lg text-ink text-[13px] px-3 outline-none ${valid ? 'border-line2 focus:border-info' : 'border-crit'}`} />
          {!valid && <div className="text-[11.5px] text-crit mt-1.5">Usa letras, números, espacios y . _ - ( ) / · (máx. 60).</div>}
        </form>
        <div className="flex justify-between gap-2.5 px-[22px] py-3.5 bg-surface2 border-t border-line">
          {target.hasAlias ? <button type="button" className="btn" disabled={busy} onClick={() => save('')}>Volver al original</button> : <span />}
          <div className="flex gap-2.5">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={!valid || !clean || busy} onClick={() => save(clean)}>{busy && <span className="spin" />}Guardar</button>
          </div>
        </div>
      </div>
    </div>, document.body);
}
