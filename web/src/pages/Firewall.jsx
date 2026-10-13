// FortiGate de la sede (INFRA OPS-PPAL): equipo, SD-WAN, VPN, Wi-Fi, navegación por agencia, aplicaciones y amenazas.
// Solo lectura por la API REST del FortiGate (ver server/src/fortigate.js). Si aún no hay token, muestra los pasos.
import { useEffect, useMemo, useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { DEMO } from '../config.js';
import { AGENCY_GEO } from '../lib/agencyGeo.js';
import { KpiCard } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { IRefresh } from '../components/icons.jsx';

const LATEST_HINT = 'Compárala con la última 7.4.x publicada en FortiGuard';
const bytes = (b) => { if (b == null || !isFinite(b)) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = +b; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`; };
const bps = (b) => (b == null ? '—' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : b >= 1e3 ? `${Math.round(b / 1e3)} kbps` : `${b} bps`);
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const net24 = (ip) => (ip ? ip.split('.').slice(0, 3).join('.') : '');
const agencyOf = (net) => AGENCY_GEO.find((a) => net24(a.ip) === net)?.name || null;
const agencyByPub = (ip) => AGENCY_GEO.find((a) => a.pub && a.pub === ip)?.name || null;
const isUp = (s) => /^(alive|up)$/i.test(s || '');
const apOk = (s) => /^(connected|online|up)$/i.test(s || '');
const checkName = (c) => String(c || '').replace(/^lo[_ -]?/i, '').replace(/_/g, ' ');
const ago = (ts) => { if (!ts) return '—'; const s = Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts); return s < 120 ? 'ahora' : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 172800 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`; };

async function api(path, force) {
  if (DEMO) return demo(path);
  const r = await fetch(`api/fortigate/${path}${force ? '?force=1' : ''}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function Setup({ error }) { // eslint-disable-line react/prop-types
  return (
    <Panel title="Conectar el FortiGate (solo lectura)" className="mb-4" bodyClass="p-5 text-[13px] space-y-3">
      {error && <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-warn text-[12.5px]">{error}</div>}
      <p className="text-ink2">Hoy el panel vigila el FortiGate desde afuera (ping, VPN y agencias en <a href="#/red" className="text-info">Red y agencias</a>). Para ver lo de adentro (navegación por agencia, SD-WAN, túneles, amenazas, Wi-Fi) el <b className="text-ink">super administrador</b> debe crear un usuario de API de solo lectura:</p>
      <pre className="bg-bg1 border border-line rounded-lg p-3 font-mono text-[11.5px] text-ink overflow-x-auto">{`config system accprofile
    edit "monitoreo-lectura"
        set secfabgrp read
        set ftviewgrp read
        set authgrp read
        set sysgrp read
        set netgrp read
        set loggrp read
        set fwgrp read
        set vpngrp read
        set utmgrp read
        set wifi read
    next
end
config system api-user
    edit "infra-ops-console"
        set accprofile "monitoreo-lectura"
        set vdom "root"
        config trusthost
            edit 1
                set ipv4-trusthost 172.31.33.88 255.255.255.255
            next
        end
    next
end
execute api-user generate-key infra-ops-console`}</pre>
      <ol className="list-decimal pl-5 space-y-1.5 text-ink2">
        <li>Permitir acceso administrativo <b className="text-ink">HTTPS</b> en la interfaz por donde entra la VPN de AWS (solo desde 172.31.33.88).</li>
        <li>Guardar el token en <code className="font-mono text-info">server/.env</code> (nunca en el navegador ni en el chat):
          <pre className="mt-1.5 bg-bg1 border border-line rounded-lg p-2.5 font-mono text-[12px] text-ink">{'FORTIGATE_URL=https://192.168.10.253:10443\nFORTIGATE_TOKEN=el-token-generado'}</pre></li>
        <li>Reiniciar el servidor del panel. Esta página se llena sola.</li>
        <li>Para ver la <b className="text-ink">navegación por agencia</b>: en las políticas de salida a Internet de las agencias activar Web Filter y Application Control en modo <i>monitor</i>, SSL <i>certificate-inspection</i> y registrar todo el tráfico permitido.</li>
      </ol>
    </Panel>
  );
}

export function Firewall() {
  const [st, setSt] = useState({ loading: true });
  const [tr, setTr] = useState({ loading: true });
  const [net, setNet] = useState('');
  const [big, setBig] = useState({});
  const [devQ, setDevQ] = useState('');
  const [ipQ, setIpQ] = useState('');
  const [openIp, setOpenIp] = useState(null);
  const [openAp, setOpenAp] = useState(null);
  // Botón "Ampliar": quita el alto máximo del panel para ver todas las filas
  const ex = (k, cls) => (big[k] ? cls.replace(/max-h-\[\d+px\]/, '') : cls);
  const exBtn = (k) => <button type="button" className="text-[11.5px] text-info hover:underline" onClick={() => setBig((b) => ({ ...b, [k]: !b[k] }))}>{big[k] ? 'Reducir' : 'Ampliar'}</button>;
  const load = (force) => {
    api('status', force).then((d) => setSt({ data: d })).catch((e) => setSt({ error: e.message }));
    api('traffic', force).then((d) => setTr({ data: d })).catch((e) => setTr({ error: e.message }));
  };
  useEffect(() => { load(false); const t = setInterval(() => load(false), 60e3); return () => clearInterval(t); }, []);
  const S = st.data, T = tr.data;
  const notConf = S?.configured === false || T?.configured === false;
  const selNet = useMemo(() => (T?.byNet || []).find((n) => n.net === net) || null, [T, net]);
  // SD-WAN agrupado por prueba de salud (una fila por agencia/destino), con el mejor enlace arriba
  const sdGroups = useMemo(() => {
    const m = {};
    for (const x of S?.sdwan || []) (m[x.check] ||= []).push(x);
    return Object.entries(m).map(([check, mem]) => {
      const up = mem.filter((x) => isUp(x.status)).sort((a, b) => (a.latency ?? 1e9) - (b.latency ?? 1e9));
      return { check, mem, best: up[0] || null, ok: up.length > 0, upN: up.length };
    }).sort((a, b) => a.ok - b.ok || a.check.localeCompare(b.check));
  }, [S]);
  const sdDown = sdGroups.filter((g) => !g.ok).length;
  const tunDown = (S?.tunnels || []).filter((x) => !x.up).length;
  const apDown = (S?.wifi || []).filter((x) => !apOk(x.status)).length;

  return (
    <>
      <PageHead title="FortiGate de la sede" sub={`INFRA OPS-PPAL · solo lectura por API${DEMO ? ' · datos de demostración' : ''}`}>
        {S?.cachedAt && <span className="text-[11.5px] text-faint font-mono">actualizado {new Date(S.cachedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>}
        <button type="button" className="btn" onClick={() => load(true)}><IRefresh size={14} />Actualizar</button>
      </PageHead>

      {(notConf || st.error) && <Setup error={notConf ? null : st.error} />}

      {S && !notConf && (<>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
          <KpiCard label="Firmware" value={S.version || '—'} foot={S.firmwareAvailable?.length ? `Disponibles: ${S.firmwareAvailable.slice(-2).join(', ')}` : LATEST_HINT} lead={<Pulse tone={S.firmwareAvailable?.length && S.firmwareAvailable.at(-1) !== S.version ? 'warn' : 'ok'} />} />
          <KpiCard label="CPU" value={pct(S.cpu)} foot={S.model || S.serial || ''} lead={<Pulse tone={S.cpu > 85 ? 'crit' : S.cpu > 70 ? 'warn' : 'ok'} />} />
          <KpiCard label="Memoria" value={pct(S.mem)} foot="Uso actual" lead={<Pulse tone={S.mem > 85 ? 'crit' : S.mem > 75 ? 'warn' : 'ok'} />} />
          <KpiCard label="Sesiones" value={S.sessions != null ? Math.round(S.sessions).toLocaleString('es-CO') : '—'} foot="Conexiones activas" />
          <KpiCard label="Alta disponibilidad" value={S.ha?.length ? `${S.ha.length} equipos` : '—'} foot={S.ha?.map((h) => `${h.host}${h.primary ? ' (principal)' : ''}`).join(' · ') || 'Sin datos de HA'} lead={<Pulse tone={S.ha?.length >= 2 ? 'ok' : 'warn'} />} />
          <KpiCard label="Enlaces / túneles caídos" value={sdDown + tunDown} foot={`${sdDown} SD-WAN · ${tunDown} VPN · ${apDown} Wi-Fi`} lead={<Pulse tone={sdDown + tunDown ? 'crit' : 'ok'} />} />
        </div>

        <div className="grid grid-cols-12 gap-4 mb-4">
          <Panel title="Enlaces SD-WAN (salud)" meta={`${sdGroups.length} destinos · ${sdDown} sin enlace`} actions={exBtn('sd')} className="col-span-12 xl:col-span-7" bodyClass={ex('sd', 'overflow-x-auto max-h-[420px]')}>
            {sdGroups.length ? (
              <table className="tbl"><thead><tr><th>Destino (prueba)</th><th>Estado</th><th>Mejor enlace</th><th className="num">Latencia</th><th className="num">Jitter</th><th className="num">Pérdida</th><th>Enlaces</th></tr></thead>
                <tbody>{sdGroups.map((g) => (
                  <tr key={g.check}><td><div className="text-ink"><EditName k={`fgc:${g.check}`} orig={checkName(g.check)} /></div><div className="text-[10.5px] text-faint font-mono">{g.check}</div></td>
                    <td><Badge tone={g.ok ? 'ok' : 'crit'}>{g.ok ? 'En línea' : 'Sin enlace'}</Badge></td>
                    <td className="font-mono text-[12px]">{g.best ? <EditName k={`fgm:${g.best.member}`} orig={g.best.member} /> : <span className="text-crit">ninguno</span>}</td>
                    <td className={`num ${g.best?.latency > 150 ? 'text-warn' : ''}`}>{g.best?.latency != null ? `${g.best.latency.toFixed(0)} ms` : '—'}</td>
                    <td className="num">{g.best?.jitter != null ? `${g.best.jitter.toFixed(1)} ms` : '—'}</td>
                    <td className={`num ${g.best?.loss > 2 ? 'text-crit' : ''}`}>{g.best?.loss != null ? `${g.best.loss.toFixed(1)}%` : '—'}</td>
                    <td><div className="flex flex-wrap gap-1">{g.mem.map((m) => <span key={m.member} title={isUp(m.status) ? 'responde' : `no responde (${m.status})`} className={`px-1.5 py-px rounded border text-[10.5px] font-mono ${isUp(m.status) ? 'border-ok/40 text-ok' : 'border-crit/50 text-crit'}`}>{m.member}</span>)}</div></td></tr>))}</tbody></table>
            ) : <Empty>Sin pruebas de salud SD-WAN configuradas o sin permiso de lectura.</Empty>}
            {sdGroups.length > 0 && <div className="px-4 py-2 text-[11px] text-faint border-t border-line">Cada destino se mide por varios enlaces. Es normal que los de respaldo (p. ej. port4 o wan2) no respondan si solo se usan cuando falla el principal; la agencia está en línea si al menos uno responde.</div>}
          </Panel>
          <Panel title="Túneles VPN" meta={`${(S.tunnels || []).length} túneles · ${tunDown} caídos`} actions={exBtn('tun')} className="col-span-12 xl:col-span-5" bodyClass={ex('tun', 'overflow-x-auto max-h-[420px]')}>
            {S.tunnels?.length ? (
              <table className="tbl"><thead><tr><th>Túnel</th><th>Estado</th><th className="num">Entrada</th><th className="num">Salida</th></tr></thead>
                <tbody>{S.tunnels.map((t) => (
                  <tr key={t.name} className={t.up ? '' : 'bg-crit/[.06]'}><td><div className="text-ink"><EditName k={`fgt:${t.name}`} orig={agencyByPub(t.remote) ? `${agencyByPub(t.remote)} (${t.name})` : t.name} /></div><div className="text-[10.5px] text-faint font-mono">{t.remote}</div></td>
                    <td><Badge tone={t.up ? 'ok' : 'crit'}>{t.up ? 'Arriba' : 'Caído'}</Badge></td><td className="num">{bytes(t.inBytes)}</td><td className="num">{bytes(t.outBytes)}</td></tr>))}</tbody></table>
            ) : <Empty>Sin túneles IPsec.</Empty>}
          </Panel>
        </div>
        <Panel title="Usuarios conectados por VPN" meta={`${(S.vpnUsers || []).length} conectado(s) ahora · SSL-VPN e IPsec de acceso remoto`} actions={exBtn('vpnu')} className="mb-4" bodyClass={ex('vpnu', 'overflow-x-auto max-h-[420px]')}>
          {S.vpnUsers?.length ? (
            <table className="tbl"><thead><tr><th>Usuario</th><th>Tipo</th><th>Conectado desde (IP pública)</th><th>IP asignada</th><th>Tiempo conectado</th><th className="num">Recibido</th><th className="num">Enviado</th></tr></thead>
              <tbody>{S.vpnUsers.map((u, i) => (
                <tr key={`${u.user}-${u.from}-${i}`}><td><div className="text-ink">{u.user || '—'}</div>{u.group && <div className="text-[10.5px] text-faint">{u.group}</div>}</td>
                  <td><Badge tone="info">{u.kind}</Badge>{u.mode && u.kind === 'SSL-VPN' && <span className="ml-1 text-[11px] text-faint">{u.mode}</span>}</td>
                  <td className="font-mono text-[12px]">{u.from || '—'}</td><td className="font-mono text-[12px]">{u.ip || '—'}</td>
                  <td className="text-[12px]">{u.duration != null ? fmtDur(u.duration) : '—'}</td>
                  <td className="num">{bytes(u.outBytes)}</td><td className="num">{bytes(u.inBytes)}</td></tr>))}</tbody></table>
          ) : <Empty>{S.errors?.['usuarios VPN'] ? `No se pudo leer: ${S.errors['usuarios VPN']}` : 'Nadie conectado por VPN en este momento.'}</Empty>}
        </Panel>
      </>)}

      {T && !notConf && (<>
        <h2 className="text-[14px] font-semibold text-ink mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-info shadow-[0_0_8px_#1FA9C0]" />Navegación y aplicaciones{T.window ? <span className="text-[11.5px] text-faint font-normal">· registros del {T.window.from} al {T.window.to} (el FortiGate guarda solo unas horas en memoria)</span> : null}</h2>
        {T.onlyBlocked && <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn">El filtro web solo está registrando los sitios <b>bloqueados</b>. Para ver todo lo que navegan, las categorías permitidas deben quedar en acción <b>Monitor</b> (no "Allow") en el perfil de Web Filter de las políticas de las agencias.</div>}
        {T.hint && <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn">{T.hint}</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <KpiCard label="Visitas web registradas" value={T.totals.web.toLocaleString('es-CO')} foot="En la ventana de logs" />
          <KpiCard label="Sitios bloqueados" value={T.totals.blocked} foot="Por el filtro web" lead={<Pulse tone={T.totals.blocked ? 'warn' : 'ok'} />} />
          <KpiCard label="Eventos de aplicaciones" value={T.totals.apps.toLocaleString('es-CO')} foot="Control de aplicaciones" />
          <KpiCard label="Amenazas" value={T.totals.threats} foot="IPS y antivirus" lead={<Pulse tone={T.totals.threats ? 'crit' : 'ok'} />} />
        </div>
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Panel title="Navegación por agencia" meta="clic para ver sus sitios" className="col-span-12 xl:col-span-5" bodyClass="overflow-x-auto max-h-[460px]">
            {T.byNet?.length ? (
              <table className="tbl"><thead><tr><th>Agencia / red</th><th className="num">Visitas</th><th className="num">Equipos</th><th className="num">Bloqueos</th></tr></thead>
                <tbody>{T.byNet.map((n) => (
                  <tr key={n.net} className={`cursor-pointer ${net === n.net ? 'bg-hover' : ''}`} onClick={() => setNet(net === n.net ? '' : n.net)}>
                    <td><div className="text-ink"><EditName k={`fgn:${n.net}`} orig={agencyOf(n.net) || 'Red sin nombre'} /></div><div className="text-[10.5px] text-faint font-mono">{n.net}.0/24{n.iface ? ` · ${n.iface}` : ''}</div></td>
                    <td className="num">{n.req}</td><td className="num">{n.users}</td><td className={`num ${n.blocked ? 'text-warn' : ''}`}>{n.blocked || '—'}</td></tr>))}</tbody></table>
            ) : <Empty>Aún no hay registros de navegación.</Empty>}
          </Panel>
          <Panel title={selNet ? `Sitios más visitados · ${agencyOf(selNet.net) || selNet.net}` : 'Sitios más visitados · todas las agencias'} meta={selNet ? <button type="button" className="text-info" onClick={() => setNet('')}>ver todas</button> : ''} className="col-span-12 xl:col-span-4" bodyClass="p-3 max-h-[460px] overflow-auto">
            {(selNet ? selNet.topSites : T.topSites).map((s, i, arr) => (
              <div key={s.k} className="flex items-center gap-2 py-1 text-[12px]"><span className="w-5 text-faint font-mono text-[10.5px]">{i + 1}</span><span className="flex-1 truncate font-mono text-ink2" title={s.k}>{s.k}</span>
                <span className="w-24 h-1.5 rounded-full bg-line/60 overflow-hidden"><i className="block h-full bg-info rounded-full" style={{ width: `${(s.v / arr[0].v) * 100}%` }} /></span><span className="w-10 text-right font-mono text-faint">{s.v}</span></div>))}
            {!(selNet ? selNet.topSites : T.topSites).length && <Empty>Sin datos.</Empty>}
          </Panel>
          <Panel title="Categorías" meta={selNet ? agencyOf(selNet.net) || selNet.net : 'todas'} className="col-span-12 xl:col-span-3" bodyClass="p-3 max-h-[460px] overflow-auto">
            {(selNet ? selNet.topCats : T.topCats).map((c) => <div key={c.k} className="flex justify-between py-1 text-[12px]"><span className="text-ink2 truncate">{c.k}</span><span className="font-mono text-faint">{c.v}</span></div>)}
            {T.blockedSites?.length > 0 && !selNet && (<><div className="text-[11px] uppercase tracking-[.1em] text-warn mt-3 mb-1">Bloqueados</div>
              {T.blockedSites.map((c) => <div key={c.k} className="flex justify-between py-0.5 text-[11.5px]"><span className="font-mono text-ink2 truncate">{c.k}</span><span className="font-mono text-faint">{c.v}</span></div>)}</>)}
          </Panel>
        </div>
        <Panel title="Quién navega (por equipo / IP)" meta={`${(T.byIp || []).length} equipos · clic en una fila para ver todo`} className="mb-4" bodyClass={ex('ip', 'overflow-x-auto max-h-[520px]')}
          actions={<div className="flex items-center gap-2"><input value={ipQ} onChange={(e) => setIpQ(e.target.value)} placeholder="Buscar IP, equipo, sitio o app…" aria-label="Buscar" className="bg-bg1 border border-line rounded-md h-[26px] px-2 text-[12px] text-ink outline-none w-56" />{exBtn('ip')}</div>}>
          {T.byIp?.length ? (
            <table className="tbl"><thead><tr><th>Equipo / IP</th><th>Agencia</th><th className="num">Eventos</th><th className="num">Bloqueos</th><th>Sitios principales</th><th>Aplicaciones</th></tr></thead>
              <tbody>{T.byIp.filter((u) => !ipQ || `${u.ip} ${u.name} ${u.sites.map((x) => x.k).join(' ')} ${u.apps.map((x) => x.k).join(' ')}`.toLowerCase().includes(ipQ.toLowerCase())).slice(0, 300).map((u) => {
                const op = openIp === u.ip;
                return [
                  <tr key={u.ip} className="cursor-pointer" onClick={() => setOpenIp(op ? null : u.ip)}>
                    <td><div className="text-ink"><EditName k={`fgd:${u.ip}`} orig={u.name || u.ip} /></div>{u.name && <div className="text-[10.5px] text-faint font-mono">{u.ip}</div>}</td>
                    <td className="text-[11.5px]">{agencyOf(u.net) || u.iface || '—'}</td>
                    <td className="num">{u.events}</td><td className={`num ${u.blocked ? 'text-warn' : ''}`}>{u.blocked || '—'}</td>
                    <td className="text-[11.5px] font-mono text-ink2 max-w-[340px] truncate" title={u.sites.map((x) => x.k).join(', ')}>{u.sites.slice(0, 3).map((x) => x.k).join(', ') || '—'}</td>
                    <td className="text-[11.5px] text-ink2 max-w-[260px] truncate" title={u.apps.map((x) => x.k).join(', ')}>{u.apps.slice(0, 3).map((x) => x.k).join(', ') || '—'}</td>
                  </tr>,
                  op && <tr key={u.ip + '-d'} className="bg-bg1/50"><td colSpan={6} className="py-3">
                    <div className="grid md:grid-cols-3 gap-4 text-[12px]">
                      <div><div className="text-[11px] uppercase tracking-wide text-faint mb-1">Sitios ({u.sites.length})</div>{u.sites.map((x) => <div key={x.k} className="flex justify-between gap-2"><span className="font-mono text-ink2 truncate">{x.k}</span><span className="font-mono text-faint">{x.v}</span></div>)}{!u.sites.length && <span className="text-faint">—</span>}</div>
                      <div><div className="text-[11px] uppercase tracking-wide text-faint mb-1">Aplicaciones ({u.apps.length})</div>{u.apps.map((x) => <div key={x.k} className="flex justify-between gap-2"><span className="text-ink2 truncate">{x.k}</span><span className="font-mono text-faint">{x.v}</span></div>)}{!u.apps.length && <span className="text-faint">—</span>}</div>
                      <div><div className="text-[11px] uppercase tracking-wide text-faint mb-1">Categorías</div>{u.cats.map((x) => <div key={x.k} className="flex justify-between gap-2"><span className="text-ink2 truncate">{x.k}</span><span className="font-mono text-faint">{x.v}</span></div>)}{!u.cats.length && <span className="text-faint">—</span>}{u.bytes > 0 && <div className="mt-2 text-faint">Tráfico: {bytes(u.bytes)}</div>}</div>
                    </div></td></tr>,
                ];
              })}</tbody></table>
          ) : <Empty>Aún no hay registros por equipo.</Empty>}
        </Panel>
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Panel title="Aplicaciones que más consumen" className="col-span-12 xl:col-span-5" bodyClass="p-3 max-h-[380px] overflow-auto">
            {T.topApps?.length ? T.topApps.map((a) => <div key={a.k} className="flex justify-between py-1 text-[12px]"><span className="text-ink2 truncate">{a.k}</span><span className="font-mono text-faint">{a.v.toLocaleString('es-CO')} eventos{a.b > 0 ? ` · ${bytes(a.b)}` : ''}</span></div>) : <Empty>Sin datos de control de aplicaciones.</Empty>}
            {T.riskyApps?.length > 0 && (<><div className="text-[11px] uppercase tracking-[.1em] text-crit mt-3 mb-1">Aplicaciones de riesgo alto</div>{T.riskyApps.map((a) => <div key={a.k} className="flex justify-between py-0.5 text-[11.5px]"><span className="text-ink2">{a.k}</span><span className="font-mono text-faint">{a.v}</span></div>)}</>)}
          </Panel>
          <Panel title="Amenazas detectadas (IPS y antivirus)" meta={`${T.threats.length}`} className="col-span-12 xl:col-span-7" bodyClass="overflow-x-auto max-h-[380px]">
            {T.threats.length ? (
              <table className="tbl"><thead><tr><th>Hora</th><th>Tipo</th><th>Amenaza</th><th>Origen → destino</th><th>Acción</th></tr></thead>
                <tbody>{T.threats.slice(0, 80).map((x, i) => (
                  <tr key={i}><td className="text-[11px] font-mono whitespace-nowrap">{x.ts}</td><td><Badge tone={x.kind === 'Antivirus' ? 'crit' : 'warn'}>{x.kind}</Badge></td><td className="text-ink text-[12px]">{x.name}</td>
                    <td className="font-mono text-[11px]">{x.src} → {x.dst}</td><td className={`text-[11.5px] ${/block|drop|deny|reset/i.test(x.action) ? 'text-ok' : 'text-crit'}`}>{x.action || '—'}</td></tr>))}</tbody></table>
            ) : <Empty>Sin amenazas en la ventana de logs.</Empty>}
          </Panel>
        </div>
      </>)}

      {S && !notConf && (
        <div className="grid grid-cols-12 gap-4 mb-6">
          <Panel title="Access points Wi-Fi (FortiAP)" meta={`${(S.wifi || []).length} · ${apDown} desconectados`} actions={exBtn('ap')} className="col-span-12 xl:col-span-5" bodyClass={ex('ap', 'overflow-x-auto max-h-[400px]')}>
            {S.wifi?.length ? (
              <table className="tbl"><thead><tr><th>Access point</th><th>Redes (SSID)</th><th>Estado</th><th className="num">Clientes</th></tr></thead>
                <tbody>{[...S.wifi].sort((x, y) => apOk(x.status) - apOk(y.status)).flatMap((a) => [(<tr key={a.serial} className={`cursor-pointer ${apOk(a.status) ? '' : 'bg-crit/[.06]'}`} onClick={() => setOpenAp(openAp === a.serial ? null : a.serial)}><td><div className="text-ink whitespace-normal"><EditName k={`fgap:${a.serial}`} orig={a.full || a.name} /></div><div className="text-[10.5px] text-faint font-mono">{a.ip}{a.serial ? ` · ${a.serial}` : ''}</div></td><td className="text-[11.5px]">{a.ssids?.length ? <div className="flex flex-wrap gap-1">{a.ssids.map((x) => <span key={x} className="px-1.5 py-px rounded border border-line text-ink2">{x}</span>)}</div> : <span className="text-faint">—</span>}</td>
                  <td><Badge tone={apOk(a.status) ? 'ok' : 'crit'}>{apOk(a.status) ? 'Conectado' : a.status === 'disconnected' ? 'Desconectado' : a.status || '—'}</Badge></td><td className="num">{a.clients ?? a.clientList?.length ?? '—'}</td></tr>), openAp === a.serial && (<tr key={a.serial + '-c'} className="bg-bg1/50"><td colSpan={4} className="py-2">{a.clientList?.length ? <table className="tbl"><thead><tr><th>Cliente</th><th>IP</th><th>SSID</th><th className="num">Señal</th></tr></thead><tbody>{a.clientList.map((c) => <tr key={c.mac}><td className="text-[12px]"><EditName k={`fgd:${c.mac}`} orig={c.user ? `${c.host || c.mac} (${c.user})` : c.host || c.mac} /><div className="text-[10.5px] text-faint">{c.os}</div></td><td className="font-mono text-[11.5px]">{c.ip}</td><td className="text-[11.5px]">{c.ssid}</td><td className="num text-[11.5px]">{c.signal != null ? `${c.signal} dBm` : '—'}</td></tr>)}</tbody></table> : <span className="text-faint text-[12px] px-3">Sin clientes conectados (o sin permiso para leer clientes Wi-Fi).</span>}</td></tr>)])}</tbody></table>
            ) : <Empty>Sin FortiAP o sin permiso de lectura de Wi-Fi.</Empty>}
          </Panel>
          <Panel title="Interfaces" actions={exBtn('if')} className="col-span-12 xl:col-span-7" bodyClass={ex('if', 'overflow-x-auto max-h-[400px]')}>
            <table className="tbl"><thead><tr><th>Interfaz</th><th>Enlace</th><th className="num">Bajada</th><th className="num">Subida</th><th className="num">Total recibido</th></tr></thead>
              <tbody>{(S.interfaces || []).slice(0, 40).map((i) => (<tr key={i.name}><td><div className="font-mono text-ink"><EditName k={`fgi:${i.name}`} orig={i.name} /></div>{i.alias && <div className="text-[10.5px] text-faint">{i.alias}</div>}</td>
                <td>{i.link ? <Badge tone="ok">Arriba{i.speed ? ` · ${i.speed} Mbps` : ''}</Badge> : <Badge tone="crit">Abajo</Badge>}</td><td className="num">{bps(i.rxRate)}</td><td className="num">{bps(i.txRate)}</td><td className="num">{bytes(i.rx)}</td></tr>))}</tbody></table>
          </Panel>
          <Panel title="Equipos conectados a la red (vistos por el FortiGate)" meta={`${(S.devices || []).length} equipos`} className="col-span-12" bodyClass={ex('dev', 'overflow-x-auto max-h-[420px]')}
            actions={<div className="flex items-center gap-2"><input value={devQ} onChange={(e) => setDevQ(e.target.value)} placeholder="Buscar nombre, IP, MAC…" aria-label="Buscar equipo" className="bg-bg1 border border-line rounded-md h-[26px] px-2 text-[12px] text-ink outline-none w-48" />{exBtn('dev')}</div>}>
            <div className="px-4 py-2 text-[11.5px] text-faint border-b border-line">Computadores, celulares, impresoras y demás equipos que el FortiGate ha visto en sus redes. "Dónde" indica la agencia o la red por la que se conectó; "Visto" es la última vez que tuvo tráfico.</div>
            {S.devices?.length ? (
              <table className="tbl"><thead><tr><th>Equipo</th><th>Tipo / sistema</th><th>IP</th><th>Dónde</th><th>Visto</th><th>MAC</th></tr></thead>
                <tbody>{S.devices.filter((d) => !devQ || `${d.host} ${d.ip} ${d.mac} ${d.os} ${d.vendor}`.toLowerCase().includes(devQ.toLowerCase())).slice(0, 500).map((d) => (
                  <tr key={d.mac + d.ip}><td><div className="flex items-center gap-2"><Pulse tone={d.online === false ? 'off' : 'ok'} /><span className="text-ink"><EditName k={`fgd:${d.mac || d.ip}`} orig={d.host || (d.vendor ? `Equipo ${d.vendor}` : 'Sin nombre')} /></span></div></td>
                    <td className="text-[11.5px]">{d.os || d.type || '—'}{d.vendor && d.host ? <span className="text-faint"> · {d.vendor}</span> : null}</td>
                    <td className="font-mono text-[11.5px]">{d.ip || '—'}</td>
                    <td className="text-[11.5px]">{agencyOf(net24(d.ip)) || d.iface || '—'}</td>
                    <td className="text-[11.5px] text-faint whitespace-nowrap">{d.online ? 'ahora' : ago(d.lastSeen)}</td>
                    <td className="font-mono text-[11px] text-faint">{d.mac}</td></tr>))}</tbody></table>
            ) : <Empty>Sin dispositivos detectados (requiere detección de dispositivos activa en las interfaces).</Empty>}
          </Panel>
        </div>
      )}
      {(S?.errors && Object.keys(S.errors).length > 0) || (T?.errors && Object.keys(T.errors).length > 0) ? (
        <p className="text-[11px] text-faint">Sin acceso a: {[...Object.keys(S?.errors || {}), ...Object.keys(T?.errors || {})].join(', ')} (revisar permisos del perfil "monitoreo-lectura").</p>
      ) : null}
    </>
  );
}

const fmtDur = (sec) => { const m = Math.floor(sec / 60); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };

// ---------- demo ----------
function demo(path) {
  if (path === 'status') return {
    host: 'INFRA OPS-PPAL', serial: 'FGT90GTK00000000', version: 'v7.4.7', model: 'FortiGate-90G', cpu: 4, mem: 41, sessions: 1620, firmwareAvailable: ['v7.4.8', 'v7.4.9'],
    ha: [{ host: 'INFRA OPS-PPAL', primary: true }, { host: 'INFRA OPS-SEC', primary: false }],
    sdwan: [{ check: 'Internet', member: 'wan1 (Claro)', status: 'alive', latency: 18.2, jitter: 1.4, loss: 0 }, { check: 'Internet', member: 'wan2 (Tigo)', status: 'alive', latency: 26.9, jitter: 3.1, loss: 0.4 }, { check: 'AWS', member: 'vpn-aws', status: 'alive', latency: 78, jitter: 2.2, loss: 0 }],
    tunnels: [{ name: 'vpn-aws', remote: '3.x.x.x', up: true, inBytes: 9.2e9, outBytes: 3.1e9 }, { name: 'vpn-azure', remote: '20.x.x.x', up: true, inBytes: 1.2e8, outBytes: 2.1e8 }, { name: 'agencia-cartagena', remote: '190.x.x.x', up: false, inBytes: 0, outBytes: 0 }],
    vpnUsers: [{ kind: 'SSL-VPN', user: 'ana.admin', group: 'VPN-TI', from: '203.0.113.43', ip: '10.30.50.91', mode: 'túnel', duration: 5400, inBytes: 4.1e7, outBytes: 3.3e8 }, { kind: 'SSL-VPN', user: 'proveedor.soporte', group: 'VPN-Proveedores', from: '203.0.113.44', ip: '10.30.50.92', mode: 'túnel', duration: 900, inBytes: 2e6, outBytes: 9e6 }],
    wifi: [{ name: 'AP-Piso1', serial: 'FP1', status: 'connected', clients: 14, ip: '192.168.10.21' }, { name: 'AP-Piso2', serial: 'FP2', status: 'connected', clients: 9, ip: '192.168.10.22' }, { name: 'AP-Medellín', serial: 'FP3', status: 'disconnected', clients: 0, ip: '192.168.11.20' }],
    interfaces: [{ name: 'wan1', alias: 'Claro', link: true, speed: 1000, rxRate: 42e6, txRate: 8e6, rx: 9.1e11 }, { name: 'wan2', alias: 'Tigo', link: true, speed: 1000, rxRate: 11e6, txRate: 2e6, rx: 2.2e11 }, { name: 'internal', alias: 'LAN', link: true, speed: 1000, rxRate: 9e6, txRate: 44e6, rx: 3.3e11 }],
    devices: [{ host: 'CAJA-01', ip: '192.168.10.51', mac: 'aa:bb:cc:00:00:01', os: 'Windows 11', vendor: 'Dell' }, { host: '', ip: '192.168.11.77', mac: 'aa:bb:cc:00:00:02', os: 'Android', vendor: 'Samsung' }],
    errors: {}, cachedAt: Date.now(),
  };
  const sites = (base) => base.map((k, i) => ({ k, v: 120 - i * 9 }));
  return {
    window: { from: '2026-10-01 07:02', to: '2026-10-01 11:40' }, totals: { web: 5230, blocked: 41, apps: 3880, threats: 3 },
    topSites: sites(['www.google.com', 'outlook.office365.com', 'web.whatsapp.com', 'www.youtube.com', 'empresa.com', 'login.microsoftonline.com', 'www.facebook.com', 'www.dian.gov.co', 'core.empresa.com']),
    topCats: [{ k: 'Motores de búsqueda', v: 980 }, { k: 'Correo web', v: 820 }, { k: 'Redes sociales', v: 410 }, { k: 'Streaming de video', v: 260 }, { k: 'Finanzas y banca', v: 240 }],
    blockedSites: [{ k: 'freegames.example', v: 12 }, { k: 'torrent.example', v: 7 }],
    topApps: [{ k: 'YouTube', v: 8.2e9 }, { k: 'Microsoft.Teams', v: 4.1e9 }, { k: 'WhatsApp', v: 1.3e9 }, { k: 'Windows.Update', v: 9.9e8 }], riskyApps: [{ k: 'AnyDesk', v: 6 }],
    byNet: [{ net: '192.168.10', iface: 'internal', req: 3100, users: 48, blocked: 20, topSites: sites(['www.google.com', 'outlook.office365.com', 'web.whatsapp.com', 'www.youtube.com']), topCats: [{ k: 'Correo web', v: 600 }] },
      { net: '192.168.11', iface: 'vpn-medellin', req: 820, users: 9, blocked: 11, topSites: sites(['www.youtube.com', 'www.google.com', 'www.facebook.com']), topCats: [{ k: 'Streaming de video', v: 210 }] }],
    threats: [{ kind: 'IPS', ts: '2026-10-01 09:14:02', name: 'Apache.Log4j.Error.Log.Remote.Code.Execution', src: '203.0.113.18', dst: '203.0.113.10', action: 'dropped' }, { kind: 'Antivirus', ts: '2026-10-01 10:02:11', name: 'W32/Agent.ABC!tr', src: '192.168.11.77', dst: 'http://malo.example/x.exe', action: 'blocked' }],
    errors: {}, cachedAt: Date.now(),
  };
}
