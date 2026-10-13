// Nombre editable: muestra el alias elegido en el panel (o el original) con un lápiz para cambiarlo.
// k = identificador estable (ej. "site:https://…", "ag:10.0.1.1", "s3:bucket"); orig = nombre real.
import { useCallback } from 'react';
import { useCanEdit } from '../lib/me.js';
import { useHostActions } from '../hooks/useHostActions.jsx';

export function EditName({ k, orig, className = '' }) {
  const act = useHostActions();
  const shown = act?.alias(k) || orig;
  const canEdit = useCanEdit();
  return (
    <span className={`group/en inline-flex items-center gap-1 max-w-full ${className}`}>
      <span className="truncate" title={shown !== orig ? `Original: ${orig}` : undefined}>{shown}</span>
      {act && canEdit && (
        <button type="button" title="Cambiar nombre" aria-label={`Cambiar nombre de ${shown}`}
          className="shrink-0 opacity-30 group-hover/en:opacity-100 focus:opacity-100 text-faint hover:text-info text-[11px] leading-none transition-opacity"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); act.askRename(k, orig); }}
          onKeyDown={(e) => e.stopPropagation()}>✎</button>
      )}
    </span>
  );
}

/** Para textos (etiquetas 3D, avisos): devuelve el alias o el original. */
export function useNames() {
  const act = useHostActions();
  return useCallback((k, orig) => act?.alias(k) || orig, [act]);
}
