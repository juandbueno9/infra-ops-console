// NAS Synology (SNMP de solo lectura desde el backend): discos, volúmenes/RAID, temperatura, ventiladores, UPS y usuarios conectados.
import { useEffect, useState } from 'react';
import { useCanEdit } from '../lib/me.js';
import { DEMO } from '../config.js';
import { dur, rate } from '../lib/format.js';
import { Badge, Meter, Panel, Pulse } from './ui.jsx';
import { useHostActions } from '../hooks/useHostActions.jsx';
export const nasKey = (n) => `nas:${n.host}`;

const TB = (b) => (b == null ? '—' : b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : `${(b / 1e9).toFixed(0)} GB`);
const SEVT = { crit: 'crit', warn: 'warn', info: 'off' };
// En DSM 7 el "Storage Pool" aparece al 100 % cuando todo su espacio está asignado al volumen: es normal, el uso real es el del volumen.
const isPool = (r) => r.pool ?? /pool|grupo/i.test(r.name || '');
// Por si el backend es una versión anterior: ignorar avisos de capacidad del Storage Pool
const realIssues = (n) => (n?.issues || []).filter((i) => !/(pool|grupo).*capacidad/i.test(i.msg));

export async function loadSynology(force = false) {
  if (DEMO) return demo();
  const r = await fetch(`api/synology${force ? '?force=1' : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

export function useSynology(everyS = 60) {
  const [st, setSt] = useState({ data: null, error: null });
  useEffect(() => {
    let a = true;
    const go = () => loadSynology().then((d) => a && setSt({ data: d, error: null })).catch((e) => a && setSt((s) => ({ ...s, error: e.message })));
    go(); const t = setInterval(go, everyS * 1000);
    return () => { a = false; clearInterval(t); };
  }, [everyS]);
  return st;
}

/** Estado general de un NAS: crit/warn/ok/off */
export function nasTone(n) {
  if (!n?.ok) return 'off';
  if (realIssues(n).some((i) => i.sev === 'crit')) return 'crit';
  if (realIssues(n).some((i) => i.sev === 'warn')) return 'warn';
  return 'ok';
}
export function diskTone(d) {
  if (!d) return 'off';
  if (d.status === 4 || d.status === 5 || d.health >= 3) return 'crit';
  if (d.health === 2 || d.bad > 0 || d.temp >= 55) return 'warn';
  if (d.status === 3) return 'off';
  return 'ok';
}
/** Elementos para la vista 3D (un NAS = una caja con un LED por bahía). */
export function nasItems(data, alias = () => null) {
  return (data?.nas || []).map((n0) => {
    const n = { ...n0, name: alias(nasKey(n0)) || n0.name };
    const bays = Array.from({ length: n.disks?.length || 8 }, (_, i) => (n.disks?.[i] ? diskTone(n.disks[i]) : 'off'));
    const vols = (n.raids || []).filter((r) => !isPool(r));
    const vol = vols.length ? Math.max(...vols.map((r) => r.usedPct ?? 0)) : n.volumes?.length ? Math.max(...n.volumes.map((v) => v.usedPct ?? 0)) : null;
    return {
      id: `nas:${n.host}`, kind: 'nas', label: n.name, tone: nasTone(n), bays, model: n.model,
      values: { cpu: n.cpu, mem: n.mem, disk: vol },
      note: !n.ok ? n.error : realIssues(n).length ? realIssues(n)[0].msg : `${n.model} · ${n.disks?.length || 0} discos · ${n.temp ?? '—'} °C`,
      onClick: () => document.getElementById('nas')?.scrollIntoView({ behavior: 'smooth' }),
    };
  });
}

/** Avisa (una vez por problema) cuando un NAS tiene un problema crítico o de atención. */
export function useSynologyWatcher(toast) {
  useEffect(() => {
    let alive = true;
    const told = new Set();
    const run = async () => {
      let d; try { d = await loadSynology(); } catch { return; }
      if (!alive || !d?.configured) return;
      for (const n of d.nas || []) {
        const list = n.ok ? realIssues(n).filter((i) => i.sev !== 'info') : [{ sev: 'crit', msg: n.error || 'Sin respuesta' }];
        for (const i of list) {
          const k = `${n.host}|${i.msg}`; if (told.has(k)) continue; told.add(k);
          (i.sev === 'crit' ? toast.error : toast.warn)(/nas/i.test(n.name) ? n.name : `NAS ${n.name}`, i.msg, { key: `nas-${k}`, action: { label: 'Ver NAS', fn: () => { location.hash = '#/'; setTimeout(() => document.getElementById('nas')?.scrollIntoView({ behavior: 'smooth' }), 300); } } });
        }
      }
    };
    const first = setTimeout(run, 15e3);
    const iv = setInterval(run, 5 * 60e3);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function Setup() {
  return (
    <div className="p-4 text-[12.5px] text-ink2 grid md:grid-cols-2 gap-5">
      <div>
        <div className="text-ink font-semibold mb-2">1 · En el NAS (DSM)</div>
        <ol className="list-decimal pl-5 space-y-1">
          <li><b>Panel de control → Terminal y SNMP → pestaña SNMP</b>.</li>
          <li>Marca <b>Habilitar servicio SNMP</b>.</li>
          <li>Recomendado: <b>SNMPv3</b> · usuario <span className="font-mono">monitoreo</span> · protocolo <b>SHA</b> · contraseña (mín. 8) · privacidad <b>AES</b> con otra contraseña. Deja v1/v2c desmarcado.</li>
          <li>Aplicar. Es solo lectura: el panel no puede cambiar nada del NAS.</li>
          <li>Si usas el firewall del NAS (<b>Seguridad → Firewall</b>), permite <b>UDP 161</b> desde el equipo del panel (10.30.50.26).</li>
        </ol>
      </div>
      <div>
        <div className="text-ink font-semibold mb-2">2 · En el panel (server/.env)</div>
        <pre className="bg-bg1 border border-line rounded-lg p-3 font-mono text-[11.5px] whitespace-pre-wrap">{`SYNOLOGY_HOSTS=192.168.10.180=NAS sistemas
SYNOLOGY_SNMP_USER=monitoreo
SYNOLOGY_SNMP_AUTH=<contraseña SHA>
SYNOLOGY_SNMP_PRIV=<contraseña AES>`}</pre>
        <p className="text-faint text-[11.5px] mt-2">Varios NAS: sepáralos con coma (<span className="font-mono">192.168.10.180=NAS sistemas,192.168.10.181=NAS respaldo</span>). Luego reinicia el panel (<span className="font-mono">npm start</span>).</p>
      </div>
    </div>
  );
}

function Nas({ n: n0, open, onToggle }) {
  const act = useHostActions();
  const n = { ...n0, name: act.alias(nasKey(n0)) || n0.name };
  const canEdit = useCanEdit();
  const renameBtn = !canEdit ? null : <span role="button" tabIndex={0} title="Cambiar nombre" aria-label="Cambiar nombre" className="ml-1.5 text-faint hover:text-info cursor-pointer text-[12px]" onClick={(e) => { e.stopPropagation(); act.askRename(nasKey(n0), n0.name); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); act.askRename(nasKey(n0), n0.name); } }}>✎</span>;
  const tone = nasTone(n);
  if (!n.ok) return (
    <div className="p-4 border-b border-line last:border-0 flex items-center gap-3"><Pulse tone="crit" /><div><div className="text-ink font-mono">{n.name} <span className="text-faint">{n.host}</span></div><div className="text-crit text-[12px]">{n.error}</div></div></div>
  );
  const bays = Array.from({ length: n.disks.length || 8 }, (_, i) => n.disks[i] || null);
  const users = n.services.filter((s) => s.users > 0);
  const badDisks = n.disks.filter((d) => diskTone(d) !== 'ok').length;
  const vols = (n.raids.length ? n.raids : n.volumes).filter((r) => !isPool(r));
  const maxVol = vols.length ? Math.max(...vols.map((r) => r.usedPct ?? 0)) : null;
  const nIss = realIssues(n).length;
  return (
    <div className="border-b border-line last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className={`w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 hover:bg-bg1/60 transition-colors ${open ? 'bg-bg1/40' : ''}`}>
        <span className={`text-faint text-[12px] transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
        <div className="flex items-center gap-2.5"><Pulse tone={tone} /><div><div className="text-ink font-semibold">{n.name}{renameBtn}</div><div className="text-faint font-mono text-[11px]">{n.host} · {n.model} · {n.dsm}</div></div></div>
        <Badge tone={tone === 'off' ? 'off' : tone}>{tone === 'ok' ? 'Saludable' : tone === 'warn' ? 'Atención' : 'Falla'}</Badge>
        <div className="text-[12px]"><span className="text-faint">Temperatura </span><span className={`font-mono ${n.temp >= 60 ? 'text-warn' : 'text-ink'}`}>{n.temp ?? '—'} °C</span></div>
        <div className="text-[12px]"><span className="text-faint">Discos </span>{badDisks ? <span className="text-warn">{badDisks} con problemas</span> : <span className="text-ok">{n.disks.length} OK</span>}</div>
        <div className="w-36"><div className="text-faint text-[11px]">Volumen más lleno</div><Meter value={maxVol} base="#22D3EE" /></div>
        <div className="w-32"><div className="text-faint text-[11px]">CPU</div><Meter value={n.cpu} /></div>
        <div className="w-32"><div className="text-faint text-[11px]">Memoria</div><Meter value={n.mem} base="#A3E635" /></div>
        {nIss > 0 && !open && <span className="text-[11.5px] text-warn">{nIss} aviso(s) · clic para ver</span>}
      </button>

      {open && (<div className="px-4 pb-4 pt-1">
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3">
        <div className="text-[12px]"><span className="text-faint">Ventiladores </span><span className={n.fans.system === 2 || n.fans.cpu === 2 ? 'text-crit' : 'text-ok'}>{n.fans.system === 2 || n.fans.cpu === 2 ? 'Falla' : 'OK'}</span></div>
        <div className="text-[12px]"><span className="text-faint">Fuente </span><span className={n.power === 2 ? 'text-crit' : 'text-ok'}>{n.power === 2 ? 'Falla' : 'OK'}</span></div>
        <div className="text-[12px]"><span className="text-faint">Encendido </span><span className="font-mono text-ink">{n.uptime != null ? dur(n.uptime) : '—'}</span></div>
        {n.ups && <div className="text-[12px]"><span className="text-faint">UPS </span><span className="font-mono text-ink">{n.ups.charge ?? '—'}%</span></div>}
      </div>
      {realIssues(n).length > 0 && (
        <div className="flex flex-col gap-1 mb-3">{realIssues(n).map((i) => <div key={i.msg} className="flex items-center gap-2 text-[12px]"><Badge tone={SEVT[i.sev]}>{i.sev === 'crit' ? 'Crítico' : i.sev === 'warn' ? 'Atención' : 'Info'}</Badge><span className="text-ink2">{i.msg}</span></div>)}</div>
      )}

      <div className="text-[11px] uppercase tracking-wide text-faint mb-1.5">Discos</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
        {bays.map((d, i) => { const t = diskTone(d); return (
          <div key={i} className={`rounded-lg border p-2 text-[11.5px] ${d ? 'border-line bg-bg1' : 'border-dashed border-line opacity-60'}`}>
            <div className="flex items-center justify-between mb-1"><span className="text-ink font-semibold">Bahía {i + 1}</span>{d && <Pulse tone={t} />}</div>
            {d ? (<>
              <div className="font-mono text-ink2 truncate" title={d.model}>{d.model || d.name}</div>
              <div className="flex justify-between text-faint"><span>{d.temp ?? '—'} °C</span><span className={t === 'ok' ? 'text-ok' : t === 'warn' ? 'text-warn' : 'text-crit'}>{d.healthLabel || d.statusLabel}</span></div>
              {d.bad > 0 && <div className="text-warn">{d.bad} sectores dañados</div>}
              {d.life != null && d.life > 0 && <div className="text-faint">Vida útil {d.life}%</div>}
            </>) : <div className="text-faint">Vacía</div>}
          </div>); })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-faint mb-1.5">Almacenamiento</div>
          <table className="tbl"><thead><tr><th>Volumen / grupo</th><th>Estado</th><th>Uso</th><th className="num">Libre</th><th className="num">Total</th></tr></thead>
            <tbody>{(n.raids.length ? n.raids : n.volumes).map((r) => (
              <tr key={r.name}><td className="font-mono text-ink">{r.name}</td>
                <td>{r.statusLabel ? <Badge tone={r.status === 1 || r.status === 13 ? 'ok' : r.status === 11 || r.status === 12 ? 'crit' : 'warn'}>{r.statusLabel}</Badge> : '—'}</td>
                <td className="w-40">{isPool(r) ? <span className="text-faint text-[11.5px]">{r.usedPct >= 99 ? 'Todo asignado al volumen (normal)' : `${Math.round(r.usedPct)}% asignado`}</span> : <Meter value={r.usedPct} base="#22D3EE" />}</td>
                <td className="num">{TB(r.free ?? (r.total != null && r.used != null ? r.total - r.used : null))}</td><td className="num">{TB(r.total)}</td></tr>))}
            </tbody></table>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-faint mb-1.5">Conexiones y red</div>
          <div className="flex flex-wrap gap-1.5 mb-3">{users.length ? users.map((s) => <Badge key={s.name} tone="off">{s.name}: {s.users} usuario(s)</Badge>) : <span className="text-faint text-[12px]">Nadie conectado a carpetas compartidas en este momento</span>}</div>
          <table className="tbl"><thead><tr><th>Interfaz</th><th className="num">Recibe</th><th className="num">Envía</th></tr></thead>
            <tbody>{n.net.length ? n.net.map((x) => <tr key={x.name}><td className="font-mono">{x.name}</td><td className="num">{x.rxRate != null ? rate(x.rxRate) : '…'}</td><td className="num">{x.txRate != null ? rate(x.txRate) : '…'}</td></tr>) : <tr><td colSpan={3} className="text-faint">—</td></tr>}</tbody></table>
          <div className="text-faint text-[11px] mt-2">Serie {n.serial} · DSM {n.upgrade === 'Disponible' ? 'con actualización disponible' : n.upgrade === 'Al día' ? 'al día' : '—'}</div>
        </div>
      </div>
      </div>)}
    </div>
  );
}

/** Tarjeta compacta de un NAS (vista ejecutiva). Clic → sección NAS del Resumen. */
export function NasCard({ n: n0 }) {
  const act = useHostActions();
  const n = { ...n0, name: act.alias(nasKey(n0)) || n0.name };
  const tone = nasTone(n);
  const vols = (n.raids || []).filter((r) => !isPool(r));
  const maxVol = vols.length ? Math.max(...vols.map((r) => r.usedPct ?? 0)) : null;
  const bad = (n.disks || []).filter((d) => diskTone(d) !== 'ok').length;
  const iss = realIssues(n);
  return (
    <button type="button" onClick={() => { location.hash = '#/'; setTimeout(() => document.getElementById('nas')?.scrollIntoView({ behavior: 'smooth' }), 400); }}
      className="panel text-left p-4 hover:border-info/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2"><Pulse tone={tone} /><div><div className="text-ink font-mono font-semibold text-[13.5px]">{n.name}</div><div className="text-faint font-mono text-[11px]">NAS · {n.model || '—'} · {n.host}</div></div></div>
        <Badge tone={tone}>{!n.ok ? 'Sin respuesta' : tone === 'ok' ? 'Saludable' : tone === 'warn' ? 'Atención' : 'Falla'}</Badge>
      </div>
      {n.ok ? (<>
        <div className="flex gap-1 mb-3">{(n.disks || []).map((d, i) => { const t = diskTone(d); return <span key={i} title={`Bahía ${i + 1}: ${d.model} · ${d.temp ?? '—'} °C`} className={`flex-1 h-7 rounded-[3px] border border-line ${t === 'ok' ? 'bg-ok/25' : t === 'warn' ? 'bg-warn/50' : 'bg-crit/60'}`} />; })}</div>
        <div className="mb-2"><div className="text-[11px] text-faint mb-0.5">Volumen más lleno</div><Meter value={maxVol} base="#22D3EE" /></div>
        <div className="flex justify-between text-[11.5px] text-faint"><span>{n.temp ?? '—'} °C · {bad ? <span className="text-warn">{bad} disco(s) con problemas</span> : `${n.disks.length} discos OK`}</span>{iss.length > 0 && <span className="text-warn">{iss.length} aviso(s)</span>}</div>
      </>) : <div className="text-crit text-[12px]">{n.error}</div>}
    </button>
  );
}

export function SynologyPanel({ st }) {
  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('infra.nas.open') || '{}'); } catch { return {}; } });
  const toggle = (h) => setOpen((o) => { const x = { ...o, [h]: !o[h] }; try { localStorage.setItem('infra.nas.open', JSON.stringify(x)); } catch { /* sin almacenamiento */ } return x; });
  const d = st?.data;
  if (!d) return null;
  const list = d.nas || [];
  return (
    <section id="nas" className="mb-4">
      <Panel title="NAS Synology" meta={d.configured ? `${list.length} equipo(s) · SNMP solo lectura${d.demo ? ' · demostración' : ''}` : 'sin configurar'}>
        {!d.configured ? <Setup /> : list.map((n) => <Nas key={n.host} n={n} open={!!open[n.host]} onToggle={() => toggle(n.host)} />)}
        {st.error && <div className="text-warn text-[12px] px-4 py-2">No se pudo consultar: {st.error}</div>}
      </Panel>
    </section>
  );
}

function demo() {
  const disk = (i, extra = {}) => ({ id: `Disk ${i}`, name: `Disco ${i}`, model: 'WD40EFRX-68N32N0', type: 'SATA', status: 1, statusLabel: 'Normal', temp: 36 + (i % 4), bad: 0, life: null, health: 1, healthLabel: 'Normal', ...extra });
  return {
    configured: true, demo: true, at: Date.now(), nas: [{
      host: '192.168.10.180', name: 'NAS sistemas', ok: true, model: 'DS1813+', serial: '1380LON001742', dsm: 'DSM 7.1.1-42962 Update 9', upgrade: 'Al día',
      temp: 44, system: 1, power: 1, fans: { system: 1, cpu: 1 }, cpu: 9, mem: 58, uptime: 50 * 86400 + 18 * 3600, ups: null,
      disks: [disk(1), disk(2), disk(3), disk(4), disk(5, { bad: 8, health: 2, healthLabel: 'Advertencia' }), disk(6), disk(7), disk(8)],
      raids: [{ name: 'Storage Pool 1', status: 1, statusLabel: 'Normal', total: 21.8e12, free: 6.1e12, usedPct: 72 }, { name: 'Volume 1', status: 1, statusLabel: 'Normal', total: 21.5e12, free: 6.0e12, usedPct: 72.1 }],
      volumes: [], services: [{ name: 'CIFS', users: 14 }, { name: 'AFP', users: 0 }, { name: 'NFS', users: 2 }],
      net: [{ name: 'eth0', rxRate: 2.4e6, txRate: 8.1e6 }, { name: 'eth1', rxRate: 0, txRate: 0 }],
      issues: [{ sev: 'warn', msg: 'Disco 5: salud en advertencia (WD40EFRX-68N32N0)' }, { sev: 'warn', msg: 'Disco 5: 8 sectores dañados' }],
    }],
  };
}
