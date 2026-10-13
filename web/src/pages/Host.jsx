import { PORT_NAMES, RANGES, SVC_DESC } from '../config.js';
import { useCanEdit } from '../lib/me.js';
import { analyze, classify, ipKind, LEVEL, portRule } from '../lib/analyze.js';
import { GB, clock, hhmm, meterColor, pct, rate, since } from '../lib/format.js';
import { useHostActions } from '../hooks/useHostActions.jsx';
import { KpiCard, LineChart } from '../components/charts.jsx';
import { HostMenu } from '../components/HostMenu.jsx';
import { Badge, Empty, Kv, Panel, Pulse } from '../components/ui.jsx';
import { IBack, IOk } from '../components/icons.jsx';
import { IpCell, KeyCell, SshAccessPanel } from '../components/ssh.jsx';

const PORT_CLASS = {
  critical: ['Crítico', 'crit'], review: ['Revisar', 'warn'], allowed: ['Permitido', 'ok'],
  office: ['Solo oficina', 'warn'], sg: ['Cerrado en SG', 'sg'], internal: ['Interno', 'info'],
};
const PORT_ORDER = { critical: 0, review: 1, allowed: 2, office: 3, sg: 4, internal: 5 };
const exposure = (p, k) => p.scope === 'local' ? 'Loopback (127.0.0.1)' : p.scope === 'private' ? 'Red privada'
  : { allowed: 'Internet', office: 'IP de oficina', critical: 'Internet', review: '0.0.0.0 · verificar SG', sg: '0.0.0.0 · bloqueado en AWS' }[k];

function Res({ name, v, base, sub }) {
  return (
    <div className="py-2.5 border-b border-line last:border-b-0">
      <div className="flex justify-between items-baseline mb-1.5"><span className="text-ink2 font-medium">{name}</span><b className="font-mono text-[13px] text-ink">{pct(v)}</b></div>
      <div className="h-1.5 bg-[#0e2228] rounded overflow-hidden"><i className="block h-full rounded" style={{ width: `${Math.min(100, v || 0)}%`, background: meterColor(v, base) }} /></div>
      {sub && <div className="font-mono text-[11.5px] text-faint mt-1">{sub}</div>}
    </div>
  );
}
function Check({ tone, title, right, children }) {
  return (
    <div className="flex gap-2.5 py-2.5 border-b border-line last:border-b-0">
      <Pulse tone={tone} className="mt-1.5" />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2 text-ink font-medium flex-wrap"><span>{title}</span>{right}</div>
        {children && <div className="text-xs text-muted mt-0.5">{children}</div>}
      </div>
    </div>
  );
}

export function Host({ d, loading, range, onRange }) {
  const act = useHostActions();
  const canEdit = useCanEdit();
  if (!d) return <Empty>{loading ? 'Cargando host…' : 'No hay datos para este host.'}</Empty>;

  const a = analyze(d), sil = act.silencedUntil(d.inst);
  const host = act.alias(d.inst) || d.info.hostname || d.inst, region = d.info.az ? d.info.az.replace(/[a-z]$/, '') : '—';
  const hostRef = { ...d, host, hostOrig: act.alias(d.inst) ? d.info.hostname || d.inst : undefined, iid: d.info.instance_id, ip: d.info.private_ip };
  const cpuH = d.cpuHour || [], memH = d.memHour || [];
  const rl = RANGES[range]?.label || '';
  const RangeSel = (
    <div className="seg ml-auto" role="group" aria-label="Rango de tiempo">
      {Object.entries(RANGES).map(([k, v]) => <button key={k} type="button" aria-pressed={range === k} onClick={() => onRange(k)}>{v.label}</button>)}
    </div>
  );
  const nBad = a.A.filter((x) => x[0] === 'bad').length, c = a.cls, ssh = d.ssh ?? 0;
  const tone = sil ? 'off' : d.up !== 1 ? 'crit' : LEVEL[a.level].tone;

  const seen = new Map();
  d.ports.forEach((p) => { const e = seen.get(p.port); if (!e || (p.scope === 'public' && e.scope !== 'public')) seen.set(p.port, p); });
  const ports = [...seen.values()].map((p) => ({ ...p, k: classify(d.inst, p) })).sort((x, y) => PORT_ORDER[x.k] - PORT_ORDER[y.k] || x.port - y.port);
  const running = d.ctr.filter((x) => x.state === 'running').length;

  return (
    <>
      <div className="flex items-center gap-3.5 mb-4 flex-wrap">
        <a href="#/" className="inline-flex items-center gap-1.5 text-muted no-underline font-medium px-2.5 py-1.5 rounded-md border border-line hover:text-ink hover:bg-surface2"><IBack size={14} />Infraestructura</a>
        <Pulse tone={tone} className="ml-1" />
        <div>
          <h1 className="m-0 font-mono text-xl font-semibold text-ink tracking-tight">{host}</h1>
          <div className="font-mono text-xs text-faint mt-0.5">{[d.itype, d.info.az, d.info.instance_id, d.info.private_ip].filter(Boolean).join(' · ')}</div>
        </div>
        {sil ? <Badge tone="off">Silenciado hasta {clock(sil)}</Badge> : d.up !== 1 ? <Badge tone="crit">Sin respuesta</Badge> : <Badge tone={LEVEL[a.level].tone}>{LEVEL[a.level].label}</Badge>}
        <div className="flex-1" />
        <HostMenu host={hostRef} inDetail buttonClass="kebab !w-[34px] !h-[34px] border border-line" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
        <KpiCard label="CPU" value={d.cpu != null ? d.cpu.toFixed(1) : '—'} unit="%" delta={d.cpu != null && cpuH.length > 50 ? d.cpu - cpuH[0] : null} spark={cpuH} color="#1FA9C0" foot={`${d.cpus ?? '—'} vCPU · última hora`} />
        <KpiCard label="Memoria" value={d.memP != null ? d.memP.toFixed(1) : '—'} unit="%" delta={d.memP != null && memH.length > 50 ? d.memP - memH[0] : null} spark={memH} color="#A3E635" foot={`${GB(d.memT - d.memA)} de ${GB(d.memT)}`} />
        <KpiCard label="Disco /" value={d.fsP != null ? d.fsP.toFixed(1) : '—'} unit="%" foot={d.diskDays != null && d.diskDays < 90 ? <span className={d.diskDays < 7 ? 'text-crit' : d.diskDays < 30 ? 'text-warn' : ''}>Se llena en ~{d.diskDays < 2 ? `${Math.round(d.diskDays * 24)} h` : `${Math.round(d.diskDays)} días`} al ritmo actual</span> : `${GB(d.fsA)} libres de ${GB(d.fsS)}`} />
        <KpiCard label="Carga (1 min)" value={d.load[0] != null ? d.load[0].toFixed(2) : '—'} unit={d.cpus ? ` / ${d.cpus}` : ''} spark={d.spLoad.map((x) => x[1])} color="#22D3EE" foot={`5 m ${d.load[1]?.toFixed(2) ?? '—'} · 15 m ${d.load[2]?.toFixed(2) ?? '—'}`} />
        <KpiCard label="Tráfico de red" value={rate((d.rx || 0) + (d.tx || 0)).split(' ')[0]} unit={' ' + (rate((d.rx || 0) + (d.tx || 0)).split(' ')[1] || '')} spark={d.spNet.map((x) => x[1])} color="#1FA9C0" foot={`↑ ${rate(d.tx)} · ↓ ${rate(d.rx)}`} />
        <KpiCard label="Alertas" lead={<Pulse tone={sil ? 'off' : nBad ? 'crit' : a.A.length ? 'warn' : 'ok'} />} value={a.A.length}
          foot={<><span className="text-crit">{nBad} críticas</span> · <span className="text-warn">{a.A.length - nBad} atención</span></>} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 flex items-center gap-3 -mb-1">
          <span className="text-[13px] font-semibold text-ink">Tendencias</span>
          <span className="text-xs text-faint">Rango seleccionado: {rl}</span>
          {RangeSel}
        </div>
        <Panel title="CPU" meta={`últimos ${rl}`} className="col-span-12 lg:col-span-6" bodyClass="px-3 pt-2 pb-2.5"><LineChart series={d.chCpu} color="#1FA9C0" label="CPU" /></Panel>
        <Panel title="Memoria" meta={`últimos ${rl}`} className="col-span-12 lg:col-span-6" bodyClass="px-3 pt-2 pb-2.5"><LineChart series={d.chMem} color="#A3E635" label="Memoria" /></Panel>

        <Panel title="Sistema" className="col-span-12 lg:col-span-4" bodyClass="p-4">
          <Kv rows={[['Hostname', host], ['Sistema operativo', d.os], ['Kernel', d.uname.release], ['Capacidad', `${d.cpus ?? '—'} vCPU · ${GB(d.memT)}`],
            ['IP privada', d.info.private_ip], ['IP pública', d.info.public_ip || '—'], ['Uptime', since(d.boot)], ['Arranque', d.boot ? hhmm(d.boot) : '—']]} />
        </Panel>
        <Panel title="Recursos" className="col-span-12 lg:col-span-4" bodyClass="px-4 py-1.5">
          <Res name="CPU" v={d.cpu} base="#1FA9C0" sub={`carga ${d.load.map((v) => (v == null ? '—' : v.toFixed(2))).join(' · ')}`} />
          <Res name="Memoria" v={d.memP} base="#A3E635" sub={`${GB(d.memT - d.memA)} / ${GB(d.memT)}`} />
          {d.swT ? <Res name="Swap" v={(1 - d.swF / d.swT) * 100} base="#A3E635" sub={`${GB(d.swT - d.swF)} / ${GB(d.swT)}`} />
            : <div className="py-2.5 border-b border-line flex justify-between"><span className="text-ink2 font-medium">Swap</span><span className="font-mono text-faint">no configurada</span></div>}
          <Res name="Disco /" v={d.fsP} base="#22D3EE" sub={`${GB(d.fsS - d.fsA)} / ${GB(d.fsS)} · libres ${GB(d.fsA)}${d.diskDays != null && d.diskDays < 365 ? ` · se llena en ~${Math.round(d.diskDays)} d` : d.fsP != null ? ' · estable' : ''}`} />
        </Panel>
        <Panel title="Alertas del host" meta={sil ? 'silenciado' : a.A.length} className="col-span-12 lg:col-span-4" bodyClass="overflow-auto max-h-[300px]">
          {a.A.length ? a.A.map(([k, t], i) => (
            <div key={i} className="flex gap-2.5 items-start px-4 py-2.5 border-b border-line/70 last:border-b-0">
              <Pulse tone={sil ? 'off' : k === 'bad' ? 'crit' : 'warn'} className="mt-1.5" />
              <div><div className="text-ink">{t}</div><div className="text-faint text-[11.5px]">{k === 'bad' ? 'Crítica' : 'Atención'}{sil ? ' · silenciada' : ''}</div></div>
            </div>)) : <Empty><IOk size={16} className="text-ok inline -mt-0.5 mr-1" />Sin alertas activas</Empty>}
        </Panel>

        <Panel title="Servicios" meta={`${d.svcTotal - d.svcDown.length}/${d.svcTotal}`} className="col-span-12 lg:col-span-4">
          <table className="tbl"><thead><tr><th>Servicio</th><th>Función</th><th>Estado</th></tr></thead><tbody>
            {d.svc.length ? d.svc.map((s) => (
              <tr key={s.name}><td className="font-mono text-ink">{s.name}</td><td className="text-muted">{SVC_DESC[s.name] || ''}</td>
                <td><Badge tone={s.up ? 'ok' : 'crit'} dot={s.up ? 'ok' : 'crit'}>{s.up ? 'Activo' : 'Caído'}</Badge></td></tr>))
              : <tr><td colSpan={3}><Empty>Sin datos de servicios</Empty></td></tr>}
          </tbody></table>
        </Panel>
        <Panel title="Puertos en escucha" meta={`${ports.length} puertos`} className="col-span-12 lg:col-span-8" bodyClass="overflow-auto max-h-[440px]">
          <table className="tbl"><thead><tr><th className="num w-[70px]">Puerto</th><th>Aplicación / proceso</th><th>Exposición</th><th>Clasificación</th></tr></thead><tbody>
            {ports.length ? ports.map((p) => (
              <tr key={p.port}>
                <td className="num text-ink">{p.port}</td>
                <td><span className="font-mono text-ink">{p.app || '—'}</span>{PORT_NAMES[p.port] && <span className="text-faint text-[11.5px]"> · {PORT_NAMES[p.port]}</span>}{portRule(d.inst, p.port)?.note && <div className="text-[11px] text-info">{portRule(d.inst, p.port).note}</div>}</td>
                <td className={`text-xs ${p.k === 'critical' ? 'text-crit' : 'text-muted'}`}>{exposure(p, p.k)}</td>
                <td><button type="button" title="Editar la regla de este puerto" className="inline-flex items-center gap-1.5 group/pr" disabled={!canEdit} onClick={() => canEdit && act.askPortRule({ inst: d.inst, host, port: p.port, app: p.app, public: p.scope === 'public', cls: portRule(d.inst, p.port)?.cls || '', note: portRule(d.inst, p.port)?.note || '' })}><Badge tone={PORT_CLASS[p.k][1]}>{PORT_CLASS[p.k][0]}</Badge>{portRule(d.inst, p.port)?.cls && <span className="text-[10px] text-faint" title="Regla definida en el panel">●</span>}<span className="text-faint opacity-30 group-hover/pr:opacity-100 text-[11px]">✎</span></button></td>
              </tr>)) : <tr><td colSpan={4}><Empty>Sin datos de puertos</Empty></td></tr>}
          </tbody></table>
        </Panel>

        <Panel title="Seguridad" className="col-span-12 lg:col-span-4" bodyClass="px-4 py-1.5">
          <Check tone={!d.sshcfg ? 'warn' : a.sshBad ? 'crit' : 'ok'} title="Configuración SSH" right={d.sshcfg && <Badge tone={a.sshBad ? 'crit' : 'ok'}>{a.sshBad ? 'Insegura' : 'Segura'}</Badge>}>
            {d.sshcfg ? <>Puerto <span className="font-mono">{d.sshcfg.port}</span> · llaves {d.sshcfg.pubkey === 'yes' ? 'sí' : 'no'} · contraseña {d.sshcfg.password_auth === 'no' ? 'no' : <span className="text-crit">sí</span>} · root {d.sshcfg.root_login === 'no' ? 'no' : d.sshcfg.root_login === 'yes' ? <span className="text-crit">sí</span> : 'solo llave'}</> : 'Sin datos'}
          </Check>
          <Check tone={ssh >= 50 ? 'crit' : ssh >= 10 ? 'warn' : 'ok'} title="Intentos SSH fallidos · 24 h" right={<span className="font-mono text-ink">{ssh}</span>}>
            <div className="flex gap-[3px] mt-1.5">{Array.from({ length: 20 }, (_, i) => <i key={i} className={`w-[9px] h-1.5 rounded-[1px] ${i < Math.min(20, ssh) ? (ssh >= 50 ? 'bg-crit' : ssh >= 10 ? 'bg-warn' : 'bg-ok') : 'bg-[#0e2228]'}`} />)}</div>
          </Check>
          <Check tone={c.critical.length ? 'crit' : 'ok'} title="Puertos críticos expuestos">{c.critical.length ? <span className="text-crit font-mono">{c.critical.map((p) => p.port).join(', ')}</span> : 'Ninguno'}</Check>
          <Check tone={c.review.length ? 'warn' : 'ok'} title="Puertos públicos sin clasificar">{c.review.length ? <span className="text-warn font-mono">{c.review.map((p) => p.port).join(', ')}</span> : 'Ninguno'}</Check>
          <Check tone={d.sec ? 'warn' : 'ok'} title="Parches de seguridad" right={<span className="font-mono text-ink">{d.sec ?? 0}</span>}>{d.upd ?? 0} actualizaciones en total · reinicio {d.reboot === 1 ? <span className="text-warn">pendiente</span> : 'no requerido'}</Check>
        </Panel>
        <Panel title="Contenedores" meta={d.ctr.length ? `${running}/${d.ctr.length} en ejecución` : ''} className="col-span-12 lg:col-span-8" bodyClass="overflow-auto max-h-[440px]">
          <table className="tbl"><thead><tr><th>Contenedor</th><th>Imagen</th><th>Estado</th><th>Salud</th><th className="num">Activo</th><th className="num">Reinicios</th></tr></thead><tbody>
            {d.ctr.length ? d.ctr.map((x) => {
              const st = x.state === 'running' ? ['En ejecución', 'ok'] : x.state === 'restarting' ? ['Reiniciando', 'crit'] : x.state === 'exited' ? ['Detenido', 'off'] : [x.state, 'warn'];
              const hl = { healthy: ['Sano', 'ok'], unhealthy: ['Enfermo', 'crit'], starting: ['Iniciando', 'warn'] }[x.health] || ['Sin healthcheck', 'off'];
              return (
                <tr key={x.name}>
                  <td className="font-mono text-ink">{x.name}</td>
                  <td className="font-mono text-muted text-[11.5px] max-w-[260px] truncate" title={x.image}>{x.image}</td>
                  <td><Badge tone={st[1]} dot={st[1]}>{st[0]}</Badge></td><td><Badge tone={hl[1]}>{hl[0]}</Badge></td>
                  <td className="num">{x.state === 'running' && x.started ? since(x.started) : '—'}</td>
                  <td className={`num ${x.restarts > 5 ? 'text-warn' : ''}`}>{x.restarts ?? '—'}</td>
                </tr>);
            }) : <tr><td colSpan={6}><Empty>Sin contenedores Docker (o falta actualizar el agente)</Empty></td></tr>}
          </tbody></table>
        </Panel>

        <Panel title="Sesiones activas" meta={`${d.sessions.length} activa(s)`} className="col-span-12 2xl:col-span-6" bodyClass="overflow-auto max-h-[320px]">
          <table className="tbl"><thead><tr><th>Persona / llave</th><th>Usuario</th><th>TTY</th><th>Origen</th><th className="num">Conectado</th></tr></thead><tbody>
            {d.sessions.length ? d.sessions.map((x, i) => (
              <tr key={i}><td><KeyCell k={x.key} /></td><td className="font-mono text-ink">{x.user}</td><td className="font-mono text-muted">{x.tty}</td><td><IpCell ip={x.from} /></td>
                <td className="num">{since(x.since)} <span className="text-faint">· {hhmm(x.since)}</span></td></tr>))
              : <tr><td colSpan={5}><Empty>Nadie conectado en este momento</Empty></td></tr>}
          </tbody></table>
        </Panel>
        <SshAccessPanel d={d} className="col-span-12 2xl:col-span-6" />

        <Panel title="AWS y agente" className="col-span-12" bodyClass="p-4">
          <Kv cols={3} rows={[['Tipo', d.itype], ['ID de instancia', d.info.instance_id], ['Región', region], ['Zona', d.info.az], ['IP pública', d.info.public_ip || '—'], ['IP privada', d.info.private_ip],
            ['node_exporter', d.up === 1 ? 'En línea' : 'Caído'], ['Métricas infra', d.tfage == null ? 'Sin datos' : d.tfage < 300 ? `hace ${Math.round(d.tfage)} s` : 'Desactualizadas'], ['Reinicio requerido', d.reboot === 1 ? 'Sí' : 'No']]} />
        </Panel>
      </div>
    </>
  );
}
