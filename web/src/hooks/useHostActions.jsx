// Estado compartido del equipo (vía backend) y acciones sobre hosts.
// Toda acción muestra un toast; la acción destructiva pasa por el modal de alta seguridad.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { clock } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import { ConfirmDangerModal } from '../components/ConfirmDangerModal.jsx';
import { RenameModal } from '../components/RenameModal.jsx';
import { PortRuleModal } from '../components/PortRuleModal.jsx';
import { setPortOverrides } from '../lib/analyze.js';
import { goFleet } from './useHashRoute.js';
import { DEMO } from '../config.js';

const Ctx = createContext(null);
export const useHostActions = () => useContext(Ctx);

export function HostActionsProvider({ children }) {
  const toast = useToast();
  const [shared, setShared] = useState({ hidden: {}, silenced: {}, aliases: {}, audit: [] });
  const [pendingHide, setPendingHide] = useState(null);
  const [pendingRename, setPendingRename] = useState(null);
  const [pendingPort, setPendingPort] = useState(null);

  const loadState = useCallback(async () => {
    try { setShared(await api.state()); toast.dismiss('state'); }
    catch (e) { if (DEMO) return; toast.error('No se pudo leer el estado compartido', 'El backend no respondió. Ocultar y silenciar no están disponibles.', { key: 'state', every: 0, details: e.details || String(e) }); }
  }, [toast]);

  useEffect(() => { loadState(); const t = setInterval(loadState, 30000); return () => clearInterval(t); }, [loadState]);

  const run = useCallback(async (promise, ok, fail) => {
    try { const s = await promise; setShared(s); ok?.(); return s; }
    catch (e) { toast.error(fail, e.message, { details: e.details || String(e.stack || e) }); throw e; }
  }, [toast]);

  const actions = useMemo(() => {
    setPortOverrides(shared.portRules); // antes de que la flota se reanalice
    const isHidden = (h) => !!shared.hidden[h];
    const silencedUntil = (h) => { const s = shared.silenced[h]; return s && s.until > Date.now() ? s.until : null; };

    const unsilence = (h, quiet) => run(api.unsilence(h), () => !quiet && toast.success('Alertas reactivadas', h), 'No se pudieron reactivar las alertas').catch(() => {});
    const silence = (h, hours) => run(api.silence(h, hours), () => toast.success('Alertas silenciadas', `${h} · hasta las ${clock(Date.now() + hours * 3600e3)}`,
      { action: { label: 'Deshacer', fn: () => unsilence(h, true) } }), 'No se pudo silenciar').catch(() => {});
    const restore = (h) => run(api.restore(h), () => toast.success('Host restaurado en el panel', h), 'No se pudo restaurar el host').catch(() => {});

    const copy = async (text, what) => {
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
        toast.success(`${what} copiado`, text);
      } catch (e) { toast.error('No se pudo copiar al portapapeles', 'El navegador bloqueó el acceso.', { details: String(e) }); }
    };

    const alias = (k) => shared.aliases?.[k]?.name || null;
    /** Abre el diálogo para renombrar: key = identificador estable (instancia o nas:IP), original = nombre real. */
    const askRename = (key, original) => setPendingRename({ key, original, current: alias(key) || original, hasAlias: !!alias(key) });
    const rename = (key, name) => run(api.setAlias(key, name), () => toast.success(name ? 'Nombre actualizado' : 'Nombre original restaurado', name || key), 'No se pudo cambiar el nombre');
    const askPortRule = (t) => setPendingPort(t);
    const setPortRule = (host, port, cls, note) => run(api.setPortRule(host, port, cls, note), () => toast.success('Regla del puerto guardada', `${port} · ${cls || 'automático'}${note ? ` · ${note}` : ''}`), 'No se pudo guardar la regla');
    return { shared, alias, askRename, rename, askPortRule, setPortRule, isHidden, silencedUntil, silence, unsilence, restore, copy, askHide: setPendingHide, reload: loadState };
  }, [shared, run, toast, loadState]);

  const h = pendingHide;
  return (
    <Ctx.Provider value={actions}>
      {children}
      <PortRuleModal target={pendingPort} onClose={() => setPendingPort(null)} onSave={(cls, note) => actions.setPortRule(pendingPort.inst, pendingPort.port, cls, note)} />
      <RenameModal target={pendingRename} onClose={() => setPendingRename(null)} onSave={(name) => actions.rename(pendingRename.key, name)} />
      <ConfirmDangerModal
        open={!!h}
        title="Quitar host del panel"
        subtitle="Úsalo para servidores retirados o que ya no deben vigilarse desde aquí."
        resource={h ? `${h.inst}${h.iid ? '  ·  ' + h.iid : ''}` : ''}
        impact={[
          <>El host dejará de mostrarse en Infraestructura, en el selector y en los contadores <b className="text-ink">para todo el equipo</b>.</>,
          <>Sus alertas <b className="text-ink">no se verán</b> en este panel aunque el servidor falle.</>,
          <>Prometheus seguirá recolectando métricas. Para retirarlo por completo quita la etiqueta <span className="font-mono">monitoreo=si</span> en AWS y ejecuta <span className="font-mono">infra-agent-install.sh --uninstall</span>.</>,
          <>Queda registrado en la auditoría y puede restaurarse desde ⚙ Opciones.</>,
        ]}
        confirmText={h?.inst || ''}
        actionLabel="Quitar del panel"
        busyLabel="Quitando…"
        onClose={() => setPendingHide(null)}
        onConfirm={async (typed) => {
          await run(api.hide(h.inst, typed), null, 'No se pudo quitar el host');
          if (location.hash.startsWith('#/s/') && decodeURIComponent(location.hash.slice(4)) === h.inst) goFleet();
          toast.success('Host quitado del panel', `${h.inst} ya no aparece en la vista.`, { ms: 8000, action: { label: 'Deshacer', fn: () => actions.restore(h.inst) } });
        }}
      />
    </Ctx.Provider>
  );
}
