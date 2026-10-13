// Ping y escaneos de red desde una misma IP (FortiGate: sede, NAS, agencias · servidores: deploy/escaneos-red.sh).
// El vigilante revisa cada 2 min y avisa (aviso en pantalla + notificación del navegador) cuando aparece una IP nueva.
import { useEffect, useRef, useState } from 'react';
import { DEMO } from '../config.js';
import { checkSession } from '../lib/me.js';
import { Badge, Empty, Panel } from './ui.jsx';

const POLL = 2 * 60e3;
const SEV = { crit: 'Crítico', warn: 'Alto', info: 'Bajo' };
const fmtT = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const KNOWN = { '192.168.10.180': 'NAS 180', '192.168.10.185': 'NAS 185', '192.168.10.253': 'FortiGate' };
const tName = (t, hosts) => t.name || KNOWN[t.ip] || hosts?.[t.instance] || hosts?.[t.ip] || t.ip;
const kindKey = (s) => `${s.ip}|${s.kinds.map((k) => k.split(' (')[0]).sort().join(',')}`;

export async function loadNetscan(force = false) {
  if (DEMO) return demo();
  const r = await fetch(`api/netscan${force ? '?force=1' : ''}`, { cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (checkSession(r, d)) return null;
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

const readSeen = () => { try { const x = JSON.parse(localStorage.getItem('infra.netscan.seen') || '{}'); return x.day === new Date().toDateString() ? x : { day: new Date().toDateString(), keys: [] }; } catch { return { day: new Date().toDateString(), keys: [] }; } };
const saveSeen = (x) => { try { localStorage.setItem('infra.netscan.seen', JSON.stringify({ ...x, keys: x.keys.slice(-500) })); } catch { /* sin almacenamiento */ } };
const notifOn = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** Vigilante global: avisa por cada IP nueva del día que hace ping o escanea. */
export function useNetscanWatcher(toast) {
  const busy = useRef(false);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (busy.current) return; busy.current = true;
      let d; try { d = await loadNetscan(); } catch { d = null; } finally { busy.current = false; }
      if (!alive || !d) return;
      const seen = readSeen(), fresh = d.scanners.filter((s) => s.sev !== 'info' && !seen.keys.includes(kindKey(s)));
      fresh.forEach((s) => seen.keys.push(kindKey(s))); saveSeen(seen);
      for (const s of fresh.slice(0, 3)) {
        const title = `${s.sev === 'crit' ? '⚠ ' : ''}${s.kinds[0].split(' (')[0]} desde ${s.ip}${s.external ? ' (Internet)' : ''}`;
        const body = `${s.kinds.join(' · ')} → ${s.targets.slice(0, 3).map((t) => tName(t)).join(', ')}`;
        (s.sev === 'crit' ? toast.error : toast.warn)(title, body, { key: `ns-${s.ip}`, action: { label: 'Ver detalle', fn: () => { location.hash = '#/soc'; setTimeout(() => document.getElementById('netscan')?.scrollIntoView({ behavior: 'smooth' }), 300); } } });
        if (notifOn()) try { new Notification(title, { body, tag: `ns-${s.ip}` }); } catch { /* sin notificaciones */ }
      }
    };
    run(); const t = setInterval(run, POLL);
    return () => { alive = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Panel del Centro de seguridad. hosts: { instance|ip → nombre del servidor } */
export function NetScanPanel({ hosts }) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const [open, setOpen] = useState(null);
  const load = (force) => loadNetscan(force).then((data) => setSt({ loading: false, data, error: null })).catch((e) => setSt((s) => ({ ...s, loading: false, error: e.message })));
  useEffect(() => { load(); const t = setInterval(() => load(), POLL); return () => clearInterval(t); }, []);
  const d = st.data, list = d?.scanners || [];
  const fg = d?.sources?.fortigate, srv = d?.sources?.servidores;
  const meta = st.loading ? 'cargando…' : `${list.length} IP · FortiGate ${fg?.logs ? `(${fg.logs.local + fg.logs.forward} registros)` : 'sin datos'} · servidores ${srv?.hosts?.length ? `${srv.hosts.filter((h) => h.up).length}/${srv.hosts.length}` : 'sin instalar'}`;
  return (
    <div id="netscan">
      <Panel title="Ping y escaneos de red" meta={meta} className="mb-4" bodyClass="overflow-auto max-h-[460px]">
        {st.error && <div className="px-4 py-2 text-[12px] text-crit">{st.error}</div>}
        {!st.loading && !list.length && <Empty>Sin ping ni escaneos sospechosos: ninguna IP superó los umbrales en los registros disponibles.</Empty>}
        {list.length > 0 && (
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-bg1 text-faint text-[11px] uppercase tracking-wide"><tr className="text-left">
              <th className="px-3 py-2">Origen</th><th className="px-3 py-2">Qué hizo</th><th className="px-3 py-2">Contra</th><th className="px-3 py-2">Visto por</th><th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Nivel</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.ip} className="border-t border-line align-top hover:bg-surface cursor-pointer" onClick={() => setOpen(open === s.ip ? null : s.ip)}>
                  <td className="px-3 py-2 font-mono text-ink">{s.ip}<div className="font-sans text-[11px] text-faint">{s.name || (s.external ? 'Internet' : 'red interna')}</div></td>
                  <td className="px-3 py-2 text-ink2">{s.kinds.map((k) => <div key={k}>{k}</div>)}
                    {open === s.ip && s.topPorts?.length > 0 && <div className="mt-1 text-[11px] text-faint font-mono break-all">Puertos: {s.topPorts.join(', ')}</div>}</td>
                  <td className="px-3 py-2 text-ink2">{(open === s.ip ? s.targets : s.targets.slice(0, 3)).map((t) => <div key={t.ip + (t.instance || '')}>{tName(t, hosts)}</div>)}{open !== s.ip && s.targets.length > 3 && <div className="text-faint text-[11px]">+{s.targets.length - 3} más</div>}</td>
                  <td className="px-3 py-2 text-muted">{(s.sources || [s.source]).join(' + ')}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{fmtT(s.first)}<div className="text-[11px] text-faint">hasta {fmtT(s.last)}</div></td>
                  <td className="px-3 py-2"><Badge tone={s.sev}>{SEV[s.sev]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-2.5 border-t border-line text-[11.5px] text-faint space-y-1">
          {fg?.hint && <div>FortiGate: {fg.hint}</div>}
          {!srv?.hosts?.length && <div>Servidores: para ver pings y escaneos contra el servidor de AWS ejecuta una vez en él <span className="font-mono text-ink2">sudo bash escaneos-red.sh</span> (carpeta deploy). Solo registra, no bloquea.</div>}
          <div>Umbrales: {fg?.thresholds ? `${fg.thresholds.ports} puertos distintos, ${fg.thresholds.hosts} equipos o ${fg.thresholds.pings} pings` : '15 puertos distintos o 30 pings'} desde una misma IP. Te avisa en pantalla (y en el navegador si activaste las notificaciones).</div>
        </div>
      </Panel>
    </div>
  );
}

function demo() {
  const n = Date.now();
  return { sources: { fortigate: { logs: { local: 800, forward: 1000 }, thresholds: { ports: 15, hosts: 10, pings: 30 } }, servidores: { hosts: [{ instance: 'app-server', up: true }] } },
    scanners: [
      { ip: '203.0.113.16', external: true, kinds: ['Escaneo de puertos (212 puertos)'], targets: [{ ip: 'app-server', instance: 'app-server' }], sources: ['Servidor'], first: n - 9 * 60e3, last: n, sev: 'crit', topPorts: [21, 22, 23, 25, 3306, 3389, 5432, 6379, 8080] },
      { ip: '192.168.10.57', external: false, kinds: ['Barrido de ping (38 equipos)', 'Escaneo de puertos (44 puertos en un equipo)'], targets: [{ ip: '192.168.10.185' }, { ip: '192.168.10.180' }, { ip: '192.168.10.20' }], sources: ['FortiGate'], first: n - 40 * 60e3, last: n - 5 * 60e3, sev: 'warn', topPorts: [22, 80, 139, 443, 445, 5000, 5001] },
    ] };
}
