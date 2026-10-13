import { useMemo } from 'react';
import { analyze } from '../lib/analyze.js';
import { useHostActions } from './useHostActions.jsx';

const ORDER = { bad: 0, warn: 1, ok: 2, mute: 3 };

/** Modelo común de la flota: hosts visibles con su análisis, silencio y contadores. */
export function useFleetRows(data) {
  const act = useHostActions();
  return useMemo(() => {
    const all = (data?.servers || [])
      .filter((s) => !act.isHidden(s.inst))
      .map((s) => {
        const al = act.alias(s.inst);
        if (al) s = { ...s, host: al, hostOrig: s.host }; // nombre visible elegido en el panel
        const a = analyze(s), muted = !!act.silencedUntil(s.inst);
        return { s, a, muted, eff: muted ? 'mute' : a.level };
      })
      .sort((x, y) => ORDER[x.eff] - ORDER[y.eff] || x.s.inst.localeCompare(y.s.inst));
    const active = all.filter((r) => !r.muted);
    const crit = active.reduce((t, r) => t + r.a.A.filter((x) => x[0] === 'bad').length, 0);
    const warn = active.reduce((t, r) => t + r.a.A.filter((x) => x[0] === 'warn').length, 0);
    const alerts = all
      .flatMap((r) => r.a.A.map(([k, t]) => ({ k, t, r })))
      .sort((x, y) => (x.r.muted - y.r.muted) || ((x.k === 'bad' ? 0 : 1) - (y.k === 'bad' ? 0 : 1)) || x.r.s.inst.localeCompare(y.r.s.inst));
    const count = (k) => all.filter((r) => r.eff === k).length;
    const online = all.filter((r) => r.s.up === 1).length;
    const secIssues = active.reduce((t, r) => t + r.a.cls.critical.length + (r.a.sshBad ? 1 : 0), 0);
    const webDown = (data?.web || []).filter((w) => !w.ok).length;
    return { all, active, crit, warn, alerts, count, online, secIssues, webDown };
  }, [data, act]);
}

export const pulseTone = (r) => (r.muted ? 'off' : r.s.up !== 1 ? 'crit' : { ok: 'ok', warn: 'warn', bad: 'crit' }[r.a.level]);
