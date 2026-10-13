// Actualizaciones pendientes por servidor (agente infra: apt-check + lista de paquetes) y aviso diario en el panel.
import { useEffect, useState } from 'react';
import { KpiCard } from './charts.jsx';
import { Badge, Empty, Panel, Pulse } from './ui.jsx';

const readSeen = () => { try { const x = JSON.parse(localStorage.getItem('infra.updates.seen') || '{}'); return x.day === new Date().toDateString() ? x : { day: new Date().toDateString(), keys: [] }; } catch { return { day: new Date().toDateString(), keys: [] }; } };
const saveSeen = (x) => { try { localStorage.setItem('infra.updates.seen', JSON.stringify(x)); } catch { /* sin almacenamiento */ } };

/** Una vez al día por servidor: aviso si tiene parches de seguridad o reinicio pendiente. */
export function useUpdatesWatcher(model, toast) {
  useEffect(() => {
    const rows = (model?.all || []).filter((r) => r.s.up === 1 && (r.s.sec > 0 || r.s.reboot === 1));
    if (!rows.length) return;
    const seen = readSeen(), fresh = rows.filter((r) => !seen.keys.includes(`${r.s.inst}|${r.s.sec || 0}|${r.s.reboot || 0}`));
    if (!fresh.length) return;
    fresh.forEach((r) => seen.keys.push(`${r.s.inst}|${r.s.sec || 0}|${r.s.reboot || 0}`)); saveSeen(seen);
    const sec = fresh.filter((r) => r.s.sec > 0), rb = fresh.filter((r) => r.s.reboot === 1);
    const parts = [sec.length && `${sec.length} con parches de seguridad (${sec.map((r) => r.s.host).slice(0, 3).join(', ')}${sec.length > 3 ? '…' : ''})`, rb.length && `${rb.length} con reinicio pendiente`].filter(Boolean);
    toast.warn('Actualizaciones pendientes en servidores', parts.join(' · '), { key: 'updates', action: { label: 'Ver detalle', fn: () => { location.hash = '#/seguridad'; setTimeout(() => document.getElementById('actualizaciones')?.scrollIntoView({ behavior: 'smooth' }), 300); } } });
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') try { new Notification('Actualizaciones pendientes', { body: parts.join(' · '), tag: 'infra-updates' }); } catch { /* sin notificaciones */ }
  }, [model?.all]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function UpdatesPanel({ model }) {
  const [open, setOpen] = useState(null);
  const rows = (model?.all || []).filter((r) => r.s.up === 1)
    .map((r) => ({ r, s: r.s, upd: r.s.upd ?? null, sec: r.s.sec ?? null, reboot: r.s.reboot === 1, pkgs: r.s.pkgs || [] }))
    .sort((a, b) => (b.sec || 0) - (a.sec || 0) || (b.reboot - a.reboot) || (b.upd || 0) - (a.upd || 0));
  const tot = rows.reduce((t, x) => t + (x.upd || 0), 0), totSec = rows.reduce((t, x) => t + (x.sec || 0), 0);
  const withSec = rows.filter((x) => x.sec > 0).length, withRb = rows.filter((x) => x.reboot).length, upToDate = rows.filter((x) => x.upd === 0 && !x.reboot).length;
  const copy = (txt) => { try { navigator.clipboard.writeText(txt); } catch { /* sin portapapeles */ } };

  return (
    <section id="actualizaciones" className="mb-6">
      <h2 className="text-[14px] font-semibold text-ink mb-3 mt-2 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-warn shadow-[0_0_8px_#F59E0B]" />Actualizaciones pendientes</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Parches de seguridad" lead={<Pulse tone={totSec ? 'warn' : 'ok'} />} value={totSec} foot={`En ${withSec} servidor(es)`} />
        <KpiCard label="Actualizaciones en total" value={tot} foot="Incluye las de seguridad" />
        <KpiCard label="Reinicio pendiente" lead={<Pulse tone={withRb ? 'warn' : 'ok'} />} value={withRb} foot="Kernel o librerías ya instalados" />
        <KpiCard label="Servidores al día" lead={<Pulse tone="ok" />} value={upToDate} unit={` / ${rows.length}`} foot="Sin nada pendiente" />
      </div>
      <Panel title="Por servidor" meta="se revisa cada 5 min · clic para ver los paquetes" bodyClass="overflow-x-auto max-h-[560px]">
        {rows.length ? (
          <table className="tbl">
            <thead><tr><th>Servidor</th><th className="num">De seguridad</th><th className="num">Total</th><th>Reinicio</th><th>Estado</th></tr></thead>
            <tbody>
              {rows.map((x) => [
                <tr key={x.s.inst} className="cursor-pointer" onClick={() => setOpen(open === x.s.inst ? null : x.s.inst)}>
                  <td><a href={`#/s/${encodeURIComponent(x.s.inst)}`} className="font-mono text-ink no-underline hover:underline" onClick={(e) => e.stopPropagation()}>{x.s.host}</a></td>
                  <td className={`num ${x.sec ? 'text-warn font-semibold' : ''}`}>{x.sec ?? '—'}</td>
                  <td className="num">{x.upd ?? '—'}</td>
                  <td>{x.reboot ? <Badge tone="warn">Pendiente{x.s.rebootPkgs?.length ? ` · ${x.s.rebootPkgs[0]}` : ''}</Badge> : <span className="text-faint text-[11.5px]">No</span>}</td>
                  <td>{x.upd == null ? <Badge tone="off">Sin dato (actualizar agente)</Badge> : x.sec ? <Badge tone="warn">Aplicar parches</Badge> : x.reboot ? <Badge tone="warn">Reiniciar en ventana</Badge> : x.upd ? <Badge tone="info">Actualizaciones normales</Badge> : <Badge tone="ok">✓ Al día</Badge>}</td>
                </tr>,
                open === x.s.inst && (
                  <tr key={x.s.inst + '-d'} className="sub-row"><td colSpan={5} className="py-2.5">
                    {x.pkgs.length ? (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[...x.pkgs].sort((a, b) => b.security - a.security).map((p) => <span key={p.name} title={p.version} className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded border ${p.security ? 'border-warn/60 text-warn' : 'border-line text-ink2'}`}>{p.security ? '⚠ ' : ''}{p.name}</span>)}
                        {x.upd > x.pkgs.length && <span className="text-[10.5px] text-faint">+{x.upd - x.pkgs.length} más</span>}
                      </div>
                    ) : <div className="text-[12px] text-muted mb-2">{x.upd ? 'La lista de paquetes aparece cuando el servidor tenga la versión nueva del agente.' : 'Nada pendiente.'}</div>}
                    {(x.sec > 0 || x.upd > 0) && (
                      <div className="text-[11.5px] text-ink2">
                        Para aplicar solo los de seguridad (como root, fuera de horario):
                        <code className="ml-1 font-mono text-info cursor-copy" title="Clic para copiar" onClick={() => copy('apt-get update && unattended-upgrade -v')}>apt-get update && unattended-upgrade -v</code>
                        {x.s.ctrTotal ? <span className="block text-faint mt-1">Este servidor tiene contenedores Docker: si se actualiza docker/containerd, los contenedores se reinician unos segundos.</span> : null}
                      </div>
                    )}
                  </td></tr>
                ),
              ])}
            </tbody>
          </table>
        ) : <Empty>Sin servidores en línea.</Empty>}
      </Panel>
    </section>
  );
}
