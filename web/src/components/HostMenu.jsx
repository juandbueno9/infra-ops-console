import { Menu } from './Menu.jsx';
import { useCanEdit } from '../lib/me.js';
import { useHostActions } from '../hooks/useHostActions.jsx';
import { goHost } from '../hooks/useHashRoute.js';
import { IBell, IBellOff, ICopy, IEyeOff, IOpen } from './icons.jsx';
const IPen = ({ size = 15 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;

/** Menú ⋯ de un host. La acción destructiva va al final, separada y en rojo. */
export function HostMenu({ host, inDetail = false, buttonClass }) {
  const a = useHostActions();
  const canEdit = useCanEdit();
  const sil = a.silencedUntil(host.inst);
  const items = [
    ...(inDetail ? [] : [{ label: 'Abrir detalle del host', icon: <IOpen size={15} />, onSelect: () => goHost(host.inst) }, 'sep']),
    { label: 'Cambiar nombre…', hint: host.hostOrig ? `original: ${host.hostOrig}` : undefined, icon: <IPen />, onSelect: () => a.askRename(host.inst, host.hostOrig || host.host || host.inst) },
    'sep', { header: 'Copiar' },
    ...(host.iid ? [{ label: 'ID de instancia', hint: host.iid, icon: <ICopy size={15} />, onSelect: () => a.copy(host.iid, 'ID de instancia') }] : []),
    ...(host.ip ? [{ label: 'IP privada', hint: host.ip, icon: <ICopy size={15} />, onSelect: () => a.copy(host.ip, 'IP privada') }] : []),
    { label: 'Nombre del host', icon: <ICopy size={15} />, onSelect: () => a.copy(host.inst, 'Nombre del host') },
    'sep', { header: 'Alertas' },
    ...(sil
      ? [{ label: 'Reactivar alertas', icon: <IBell size={15} />, onSelect: () => a.unsilence(host.inst) }]
      : [1, 4, 24].map((h) => ({ label: `Silenciar ${h} hora${h > 1 ? 's' : ''}`, icon: <IBellOff size={15} />, onSelect: () => a.silence(host.inst, h) }))),
    'sep',
    { label: 'Quitar del panel…', icon: <IEyeOff size={15} />, danger: true, onSelect: () => a.askHide(host) },
  ];
  const shown = canEdit ? items : items.filter((x) => typeof x !== 'object' || x.header === 'Copiar' || /Abrir detalle|ID de instancia|IP privada|Nombre del host/.test(x.label || ''));
  return <Menu items={shown} label={`Acciones de ${host.inst}`} buttonClass={buttonClass} />;
}
