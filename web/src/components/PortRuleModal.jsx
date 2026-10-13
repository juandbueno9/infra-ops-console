// Regla de un puerto, al estilo de una regla del Security Group de AWS: clasificación + descripción.
// Solo cambia cómo el panel clasifica y describe el puerto; NO toca el Security Group ni el servidor.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const PORT_RULES = [
  ['', 'Automático', 'Lo decide la configuración del panel (config.js)'],
  ['allowed', 'Abierto a Internet', 'Público a propósito (ej. 80/443 de un sitio web)'],
  ['office', 'Solo oficina', 'El Security Group solo permite la IP de la oficina'],
  ['sg', 'Cerrado en el Security Group', 'Escucha en el servidor, pero AWS lo bloquea desde Internet'],
  ['critical', 'No debería estar expuesto', 'Marcarlo como riesgo crítico (genera alerta)'],
];

export function PortRuleModal({ target, onClose, onSave }) {
  const [cls, setCls] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setCls(target.cls || ''); setNote(target.note || ''); setBusy(false); } }, [target]);
  useEffect(() => { if (!target) return undefined; const k = (e) => e.key === 'Escape' && !busy && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [target, busy, onClose]);
  if (!target) return null;
  const valid = note.length <= 120 && /^[\p{L}\p{N} ._()/:,·#+&-]*$/u.test(note);
  const save = async () => { setBusy(true); try { await onSave(cls, note.trim()); onClose(); } catch { setBusy(false); } };
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-[rgba(2,6,23,.72)] backdrop-blur-[3px] grid place-items-center p-4 animate-fade" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="pr-title" className="w-full max-w-[520px] bg-bg1 border border-line rounded-[14px] overflow-hidden animate-pop shadow-[0_30px_80px_rgba(0,0,0,.6)]">
        <div className="px-[22px] pt-5">
          <h3 id="pr-title" className="m-0 text-base font-semibold text-ink">Regla del puerto <span className="font-mono">{target.port}</span></h3>
          <p className="mt-1 mb-0 text-muted text-[12.5px]"><span className="font-mono text-ink2">{target.host}</span> · {target.app || 'proceso desconocido'}. Solo cambia cómo el panel lo clasifica; no modifica el Security Group de AWS.</p>
        </div>
        <div className="px-[22px] py-4 flex flex-col gap-1.5">
          {!target.public && <div className="text-[11.5px] text-info mb-1">Este puerto solo escucha en red privada o local: siempre se muestra como "Interno". Puedes ponerle descripción.</div>}
          {PORT_RULES.map(([k, l, d]) => (
            <label key={k} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer ${cls === k ? 'border-info bg-info/10' : 'border-line hover:border-line2'} ${!target.public ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="pr-cls" className="mt-1" checked={cls === k} onChange={() => setCls(k)} />
              <span><span className="text-ink text-[13px]">{l}</span><span className="block text-faint text-[11.5px]">{d}</span></span>
            </label>
          ))}
          <label className="mt-2 text-[12px] text-ink2" htmlFor="pr-note">Descripción (para qué es, como en la regla de AWS)</label>
          <input id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="ej. Consola EMS para la oficina"
            className={`w-full h-[36px] bg-bg border rounded-lg text-ink text-[13px] px-3 outline-none ${valid ? 'border-line2 focus:border-info' : 'border-crit'}`} />
        </div>
        <div className="flex justify-end gap-2.5 px-[22px] py-3.5 bg-surface2 border-t border-line">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={save}>{busy && <span className="spin" />}Guardar regla</button>
        </div>
      </div>
    </div>, document.body);
}
