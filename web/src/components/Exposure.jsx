// Panel "Exposición a Internet": qué puertos responden desde fuera en cada dominio / IP pública.
import { Fragment, useState } from 'react';
import { EXPOSE_PORTS, portRisk } from '../lib/exposure.js';
import { Badge, Empty, Panel, Pulse } from './ui.jsx';

export function ExposurePanel({ exposure, loading }) {
  const [open, setOpen] = useState({});
  const list = exposure || [];
  const crit = list.reduce((t, x) => t + x.crit, 0), warn = list.reduce((t, x) => t + x.warn, 0);
  return (
    <Panel title="Exposición de puertos a Internet" className="mb-4"
      meta={list.length ? `${list.length} objetivo(s) · ${crit} crítico(s) · ${warn} por revisar · escaneo cada 5 min` : ''}>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th className="w-6" /><th>Dominio / IP pública</th><th>Dónde está</th><th>Puertos abiertos desde Internet</th><th className="num">Revisados</th><th>Estado</th></tr></thead>
          <tbody>
            {list.length ? list.map((t) => (
              <Fragment key={t.name}>
                <tr className="cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [t.name]: !o[t.name] }))} aria-expanded={!!open[t.name]} tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => ({ ...o, [t.name]: !o[t.name] }))}>
                  <td><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-faint transition-transform ${open[t.name] ? 'rotate-90' : ''}`}><path d="m9 6 6 6-6 6" /></svg></td>
                  <td><div className="flex items-center gap-2.5"><Pulse tone={t.tone} /><div><div className="font-mono text-ink">{t.name}</div>{t.target !== t.name && <div className="font-mono text-[11px] text-faint">{t.target}</div>}</div></div></td>
                  <td className="text-xs text-muted">{t.owner || '—'}</td>
                  <td><div className="flex flex-wrap gap-1.5">
                    {t.open.length ? t.open.map((p) => { const [, tone] = portRisk(p.port); return <Badge key={p.port} tone={tone} title={EXPOSE_PORTS[p.port]}>{p.port} {EXPOSE_PORTS[p.port] ? `· ${EXPOSE_PORTS[p.port].split(' ')[0]}` : ''}</Badge>; })
                      : <span className="text-faint text-xs">Ninguno</span>}
                  </div></td>
                  <td className="num">{t.ports.length}</td>
                  <td><Badge tone={t.tone}>{t.crit ? 'Riesgo crítico' : t.warn ? 'Revisar' : 'Correcto'}</Badge></td>
                </tr>
                {open[t.name] && (
                  <tr className="sub-row"><td /><td colSpan={5} className="!p-0">
                    <table className="tbl tbl-sub">
                      <thead><tr><th>Puerto</th><th>Servicio típico</th><th>Resultado</th><th className="num">Respuesta</th><th>Evaluación</th></tr></thead>
                      <tbody>
                        {t.ports.map((p) => { const [lbl, tone] = portRisk(p.port); return (
                          <tr key={p.port}>
                            <td className="font-mono text-ink">{p.port}</td><td>{EXPOSE_PORTS[p.port] || '—'}</td>
                            <td>{p.open ? <Badge tone={tone}>Abierto</Badge> : <span className="text-faint text-xs">Cerrado / filtrado</span>}</td>
                            <td className="num">{p.open && p.ms != null ? `${Math.round(p.ms)} ms` : '—'}</td>
                            <td className="text-xs text-muted">{!p.open ? '—' : tone === 'ok' ? 'Servicio web público esperado' : tone === 'warn' ? 'Debe estar limitado a IPs de confianza' : /extern|proveedor/i.test(t.owner) ? 'No debería estar expuesto a Internet: pedir al proveedor que lo cierre o lo limite por IP' : 'No debería estar expuesto a Internet: cerrar en firewall / Security Group'}{p.open && <span className="sr-only"> {lbl}</span>}</td>
                          </tr>); })}
                      </tbody>
                    </table>
                  </td></tr>
                )}
              </Fragment>
            )) : <tr><td colSpan={6}><Empty>{loading ? 'Cargando…' : 'Sin escaneo de puertos. Agrega el job exposicion_puertos (deploy/prometheus-exposicion.yml).'}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 text-[11.5px] text-faint border-t border-line">La sonda sale del servidor de monitoreo en AWS, así que ve lo mismo que un atacante en Internet. Un puerto limitado a la IP de la oficina aparece como cerrado (correcto).</div>
    </Panel>
  );
}
