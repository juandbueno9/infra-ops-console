// Escaneos y ataques (últimas 24 h) + vigilante que avisa en el panel y en el navegador cuando aparece uno nuevo.
import { useEffect, useRef, useState } from 'react';
import { SCAN_RULES, loadScans } from '../lib/scans.js';
import { KpiCard } from './charts.jsx';
import { Badge, Empty, Panel, Pulse } from './ui.jsx';

const POLL = 5 * 60e3;
const fmtT = (ts) => new Date(ts * 1000).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TONE = { crit: 'crit', warn: 'warn', info: 'info' };
const SEV = { crit: 'Crítico', warn: 'Alto', info: 'Bajo' };
const readSeen = () => { try { const x = JSON.parse(localStorage.getItem('infra.scans.seen') || '{}'); return x.day === new Date().toDateString() ? x : { day: new Date().toDateString(), keys: [] }; } catch { return { day: new Date().toDateString(), keys: [] }; } };
const saveSeen = (x) => { try { localStorage.setItem('infra.scans.seen', JSON.stringify({ ...x, keys: x.keys.slice(-500) })); } catch { /* sin almacenamiento */ } };
const notifOn = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** Vigilante global: revisa cada 5 min y avisa (toast + notificación del navegador) por cada escáner nuevo del día. */
export function useScanWatcher(toast) {
  const first = useRef(true);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      let r; try { r = await loadScans(1); } catch { return; }
      if (!alive || !r) return;
      const seen = readSeen(), fresh = r.scanners.filter((s) => !seen.keys.includes(`${s.ip}|${s.kinds.join(',')}`));
      fresh.forEach((s) => seen.keys.push(`${s.ip}|${s.kinds.join(',')}`)); saveSeen(seen);
      if (first.current) { first.current = false; if (!fresh.some((s) => s.sev === 'crit')) return; } // al abrir el panel solo se avisa lo crítico
      for (const s of fresh.slice(0, 3)) {
        const title = `${s.sev === 'crit' ? '⚠ Ataque' : 'Escaneo'} desde ${s.ip}`, body = `${s.kinds.join(' · ')} contra ${s.servers.join(', ') || 'tus servidores'}${s.cats[0] ? ` · ${s.cats[0]}` : ''}`;
        (s.sev === 'crit' ? toast.error : toast.warn)(title, body, { key: `scan-${s.ip}`, action: { label: 'Ver en Seguridad', fn: () => { location.hash = '#/seguridad'; } } });
        if (notifOn()) try { new Notification(title, { body, tag: `scan-${s.ip}` }); } catch { /* sin notificaciones */ }
      }
    };
    run(); const t = setInterval(run, POLL);
    return () => { alive = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ScansPanel() {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const [open, setOpen] = useState(null);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  useEffect(() => {
    let alive = true;
    const load = () => loadScans(24).then((d) => alive && setSt({ loading: false, data: d, error: null })).catch((e) => alive && setSt((s) => ({ ...s, loading: false, error: e.message })));
    load(); const t = setInterval(load, POLL);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const D = st.data, S = D?.stats;
  const askPerm = async () => { try { setPerm(await Notification.requestPermission()); } catch { /* sin soporte */ } };

  return (
    <>
      <div className="flex items-center justify-between mb-3 mt-2 flex-wrap gap-2">
        <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-crit shadow-[0_0_8px_#EF4444]" />Escaneos y ataques · últimas 24 h</h2>
        <div className="flex items-center gap-2 text-[11.5px]">
          {perm === 'granted' ? <span className="text-ok">● Notificaciones del navegador activas</span>
            : perm === 'denied' ? <span className="text-warn" title="Actívalas en la configuración del sitio del navegador">Notificaciones bloqueadas en el navegador</span>
              : perm !== 'unsupported' && <button type="button" className="btn h-[28px]" onClick={askPerm}>Activar notificaciones del navegador</button>}
          <span className="text-faint">· se revisa cada 5 min · aviso por correo: pendiente</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-4">
        <KpiCard label="IPs atacando" lead={<Pulse tone={S?.crit ? 'crit' : S?.ips ? 'warn' : 'ok'} />} value={S ? S.ips : '—'} foot="Escaneo, rutas peligrosas o SSH" />
        <KpiCard label="Escaneos web" value={S ? S.web : '—'} foot={`≥ ${SCAN_RULES.web4xxPerHour} errores 4xx en una hora`} />
        <KpiCard label="Rutas peligrosas pedidas" value={S ? S.susp : '—'} foot=".env, .git, AWS, WordPress, admin…" />
        <KpiCard label="Respondieron 200" lead={<Pulse tone={S?.ok200 ? 'crit' : 'ok'} />} value={S ? S.ok200 : '—'} foot={S?.ok200 ? 'Revisar: posible fuga de información' : 'Ninguna ruta peligrosa respondió'} />
        <KpiCard label="Intentos SSH fallidos" value={S ? S.ssh : '—'} foot="De IPs desconocidas" />
      </div>
      <Panel title="IPs que escanearon o atacaron" meta={D ? `${D.scanners.length} IPs · ${D.demo ? 'demostración' : `actualizado ${new Date(D.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`}` : ''} className="mb-4" bodyClass="overflow-x-auto max-h-[560px]">
        {st.error && <div className="text-warn text-[12px] px-4 py-2">No se pudo consultar Loki: {st.error}</div>}
        {D?.scanners.length ? (
          <table className="tbl">
            <thead><tr><th>Gravedad</th><th>IP de origen</th><th>Qué hizo</th><th>Servidor</th><th className="num">4xx (pico/hora)</th><th className="num">Rutas peligrosas</th><th className="num">SSH fallidos</th><th>Última vez</th><th /></tr></thead>
            <tbody>
              {D.scanners.map((s) => [
                <tr key={s.ip} className="cursor-pointer" onClick={() => setOpen(open === s.ip ? null : s.ip)}>
                  <td><Badge tone={TONE[s.sev]}>{s.sev === 'crit' ? '⚠ ' : ''}{SEV[s.sev]}</Badge></td>
                  <td className="font-mono text-ink whitespace-nowrap">{s.ip}</td>
                  <td><div className="flex flex-wrap gap-1">{s.kinds.map((k) => <Badge key={k} tone={k === 'Fuerza bruta SSH' ? 'warn' : 'info'}>{k}</Badge>)}</div>{s.cats.length > 0 && <div className="text-[10.5px] text-faint mt-0.5">{s.cats.join(' · ')}</div>}</td>
                  <td className="font-mono text-[11.5px]">{s.servers.join(', ') || '—'}</td>
                  <td className="num">{s.err4xx ? `${Math.round(s.err4xx)} (${Math.round(s.peak4xx)})` : '—'}</td>
                  <td className={`num ${s.ok200 ? 'text-crit font-semibold' : ''}`}>{s.hits.length || '—'}{s.ok200 ? ` · ${s.ok200} con 200` : ''}</td>
                  <td className="num">{s.ssh ? Math.round(s.ssh) : '—'}</td>
                  <td className="text-[11.5px] whitespace-nowrap">{s.last ? fmtT(s.last) : '—'}</td>
                  <td><a href={`https://www.abuseipdb.com/check/${encodeURIComponent(s.ip)}`} target="_blank" rel="noreferrer" className="text-[11.5px] text-info hover:underline" onClick={(e) => e.stopPropagation()}>Reputación ›</a></td>
                </tr>,
                open === s.ip && (
                  <tr key={s.ip + '-d'} className="sub-row"><td /><td colSpan={8} className="py-2.5">
                    {s.hits.length ? (
                      <div className="space-y-1 max-h-[220px] overflow-auto">
                        {s.hits.slice(0, 40).map((h, i) => (
                          <div key={i} className="flex gap-3 text-[11.5px] font-mono">
                            <span className="text-faint whitespace-nowrap">{fmtT(h.ts)}</span>
                            <span className={h.status >= 200 && h.status < 300 ? 'text-crit font-semibold' : 'text-ink2'}>{h.status}</span>
                            <span className="text-ink truncate max-w-[520px]" title={h.path}>{h.method} {h.path}</span>
                            <span className="text-faint truncate">{h.cat}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-[12px] text-muted">{s.ssh ? `Intentos de contraseña por SSH (${Math.round(s.ssh)}). SSH solo acepta llaves, así que no pueden entrar.` : `Pidió ${Math.round(s.err4xx)} rutas inexistentes (errores 4xx) probando qué hay en el servidor.`}</div>}
                    <div className="text-[11px] text-faint mt-2">Qué hacer: si es una IP de escáner sin relación con la empresa basta con vigilar; si una ruta peligrosa respondió 200, revisar de inmediato ese archivo o aplicación. Para bloquearla se puede agregar una regla de denegación en el Security Group o en nginx.</div>
                  </td></tr>
                ),
              ])}
            </tbody>
          </table>
        ) : <Empty>{st.loading ? 'Revisando los logs de las últimas 24 h…' : 'Sin escaneos ni ataques detectados en las últimas 24 h.'}</Empty>}
      </Panel>
      <p className="text-[11px] text-faint mb-6">Se analizan los logs de nginx/Apache y de SSH que envía promtail a Loki. Hoy solo los servidores con promtail instalado ({D?.scanners.length ? 'ver columna Servidor' : 'app-server'}); para cubrir los demás hay que instalar el agente de logs en cada uno.</p>
    </>
  );
}
