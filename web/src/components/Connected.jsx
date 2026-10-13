// Equipos conectados al monitoreo: recuerda cuándo apareció cada uno (en este navegador) para marcar los NUEVOS.
import { useMemo } from 'react';
import { EditName } from './EditName.jsx';
import { Badge, Pulse } from './ui.jsx';

const KEY = 'infra.rack.firstSeen';
const DAY = 86400e3;

/** Devuelve { id: timestamp de la primera vez que se vio }. La primera vez que se usa, nada se marca como nuevo. */
export function useFirstSeen(ids) {
  const sig = ids.join('|');
  return useMemo(() => {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* sin almacenamiento */ }
    const first = !m; m ||= {};
    let changed = false;
    for (const id of ids) if (!(id in m)) { m[id] = first ? 0 : Date.now(); changed = true; }
    if (changed) try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* sin almacenamiento */ }
    return m;
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const isNewSeen = (ts) => ts > 0 && Date.now() - ts < DAY;

const KIND = { aws: 'AWS', azure: 'Azure', nas: 'NAS', server: 'Servidor', windows: 'Windows' };
const ago = (ts) => { if (!ts) return 'antes de hoy'; const h = (Date.now() - ts) / 3600e3; return h < 1 ? `hace ${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} d`; };

export function ConnectedList({ items, seen }) {
  const byKind = items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {});
  return (
    <div className="border-t border-line">
      <div className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-faint flex-wrap">
        <span className="text-ink2 font-semibold">Equipos conectados: {items.length}</span>
        {Object.entries(byKind).map(([k, n]) => <span key={k} className="px-1.5 py-px rounded border border-line">{KIND[k] || k} {n}</span>)}
      </div>
      <div className="max-h-[220px] overflow-auto">
        <table className="tbl">
          <thead><tr><th>Equipo</th><th>Tipo</th><th>Estado</th><th className="num">Conectado</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id} className={i.href || i.onClick ? 'cursor-pointer' : ''} onClick={() => (i.onClick ? i.onClick() : i.href && (location.hash = i.href))}>
              <td><div className="flex items-center gap-2"><Pulse tone={i.tone} /><span className="font-mono text-ink text-[12px]"><EditName k={i.aliasKey || i.id} orig={i.origLabel || i.label} /></span>{isNewSeen(seen[i.id]) && <Badge tone="ok">Nuevo</Badge>}</div></td>
              <td className="text-[11.5px] text-ink2">{KIND[i.kind] || 'Servidor'}{i.sub ? <span className="text-faint"> · {i.sub}</span> : null}</td>
              <td><Badge tone={i.tone}>{i.tone === 'ok' ? 'Operando' : i.tone === 'warn' ? 'Atención' : i.tone === 'crit' ? 'Falla' : 'Sin respuesta'}</Badge></td>
              <td className="num text-[11.5px] text-faint">{ago(seen[i.id])}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
