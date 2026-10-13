import { useState } from 'react';
import { EditName } from '../components/EditName.jsx';
import { SSL_WARN_DAYS } from '../config.js';
import { goSite } from '../hooks/useHashRoute.js';
import { KpiCard } from '../components/charts.jsx';
import { PageHead, sslTone } from '../components/tables.jsx';
import { Badge, Empty, Panel, Pulse } from '../components/ui.jsx';
import { UptimeBars, pctUp, upTone } from '../components/UptimeBars.jsx';
import { IChevron, ISearch, IServer } from '../components/icons.jsx';
import { ExposurePanel } from '../components/Exposure.jsx';

// 'certbot' (agente anterior) se trata como automático
const renewalKind = (v) => (v === 'certbot-auto' || v === 'certbot' ? 'auto' : v === 'certbot-manual' ? 'certbot-manual' : 'manual');
const RenewalBadge = ({ v, method }) => {
  const k = renewalKind(v);
  if (k === 'auto') return <Badge tone="info" title={method ? `Método: ${method}` : undefined}>Automática (certbot)</Badge>;
  if (k === 'certbot-manual') return <Badge tone="warn" title={method ? `Método: ${method}` : undefined}>Manual (certbot)</Badge>;
  return <Badge tone="off">Manual (comprado)</Badge>;
};

/** Estado de un certificado del servidor. Certbot renueva a los 30 días: si baja de 25, la renovación automática probablemente falla. */
function certState(c) {
  const d = Math.floor(c.secs / 86400);
  if (d < 0) return { d, tone: 'crit', label: `Vencido hace ${-d} d`, hint: 'Los visitantes ven un error de certificado' };
  const r = renewalKind(c.renewal);
  if (r === 'auto' && d < 25) return { d, tone: d <= 7 ? 'crit' : 'warn', label: `${d} días`, hint: 'Debió renovarse sola a los 30 días: la renovación automática está fallando' };
  if (r === 'certbot-manual' && d <= 21) return { d, tone: d <= 7 ? 'crit' : 'warn', label: `${d} días`, hint: 'Renovación manual con certbot: renuévalo antes de que venza' };
  if (r === 'manual' && d <= 30) return { d, tone: d <= 7 ? 'crit' : 'warn', label: `${d} días`, hint: 'Certificado comprado: gestiona la renovación con el proveedor' };
  return { d, tone: 'ok', label: `${d} días`, hint: { auto: 'Se renueva automáticamente', 'certbot-manual': 'Se renueva a mano con certbot', manual: 'Certificado comprado, renovación manual' }[r] };
}

const fmtDate = (secs) => new Date(Date.now() + secs * 1000).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const WORST = { crit: 0, warn: 1, ok: 2 };

/** Certificados agrupados por servidor (clic para desplegar) y, dentro, por archivo de certificado. */
function CertServers({ certs, loading }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (h) => setOpen((o) => { const n = new Set(o); n.has(h) ? n.delete(h) : n.add(h); return n; });

  const servers = Object.values(certs.reduce((acc, c) => {
    const srv = (acc[c.host] ||= { host: c.host, files: {} });
    const f = (srv.files[c.file] ||= { file: c.file, issuer: c.issuer, renewal: c.renewal, secs: c.secs, domains: [] });
    f.domains.push(c.domain);
    f.secs = Math.min(f.secs, c.secs);
    return acc;
  }, {})).map((srv) => {
    const files = Object.values(srv.files).map((f) => ({ ...f, st: certState(f) })).sort((a, b) => a.secs - b.secs);
    const worst = files.reduce((w, f) => (WORST[f.st.tone] < WORST[w] ? f.st.tone : w), 'ok');
    const rows = certs.filter((c) => c.host === srv.host).map((c) => ({ ...c, st: certState(c) }))
      .sort((a, b) => a.secs - b.secs || a.domain.localeCompare(b.domain));
    return { ...srv, files, rows, worst, next: files[0], domains: rows.length, issues: rows.filter((r) => r.st.tone !== 'ok').length };
  }).sort((a, b) => WORST[a.worst] - WORST[b.worst] || a.next.secs - b.next.secs);

  const totalIssues = servers.reduce((t, s) => t + s.issues, 0);
  return (
    <section className="panel mb-4">
      <header className="panel-h">
        <h2>Certificados en los servidores</h2>
        <span className="panel-meta">{servers.length ? `${servers.length} servidor(es) · ${certs.length} dominios · ${totalIssues} requieren atención` : ''}</span>
        {servers.length > 0 && (
          <button type="button" className="text-xs text-info hover:underline ml-3" onClick={() => setOpen(open.size ? new Set() : new Set(servers.map((s) => s.host)))}>
            {open.size ? 'Contraer todo' : 'Expandir todo'}
          </button>
        )}
      </header>
      {!servers.length ? <Empty>{loading ? 'Cargando…' : 'Sin datos: requiere el agente actualizado (lee los certificados configurados en nginx).'}</Empty> : (
        <ul className="m-0 p-0 list-none">
          {servers.map((srv) => {
            const isOpen = open.has(srv.host);
            return (
              <li key={srv.host} className="border-b border-line last:border-b-0">
                <button type="button" onClick={() => toggle(srv.host)} aria-expanded={isOpen}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface2 ${isOpen ? 'bg-surface2' : ''}`}>
                  <IChevron size={15} className={`text-faint transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                  <Pulse tone={srv.worst} />
                  <IServer size={16} className="text-muted shrink-0" />
                  <span className="font-mono text-ink font-medium">{srv.host}</span>
                  <span className="text-xs text-faint hidden sm:inline">{srv.domains} dominio(s) · {srv.files.length} certificado(s)</span>
                  <span className="flex-1" />
                  {srv.issues > 0 && <Badge tone={srv.worst}>{srv.issues} requiere(n) atención</Badge>}
                  <span className="text-xs text-muted whitespace-nowrap hidden md:inline">Próximo vencimiento</span>
                  <span className="font-mono text-xs text-ink2 whitespace-nowrap">{fmtDate(srv.next.secs)}</span>
                  <Badge tone={srv.next.st.tone}>{srv.next.st.label}</Badge>
                </button>
                {isOpen && (
                  <div className="bg-bg/40 border-t border-line overflow-x-auto">
                    <table className="tbl">
                      <thead><tr><th className="!pl-11">Dominio</th><th className="num">Vence en</th><th>Fecha</th><th>Emisor</th><th>Renovación</th><th>Archivo</th></tr></thead>
                      <tbody>
                        {srv.rows.map((c) => (
                          <tr key={c.domain + c.file} title={c.st.hint}>
                            <td className="!pl-11 whitespace-nowrap"><span className="inline-flex items-center gap-2"><Pulse tone={c.st.tone} /><span className="font-mono text-ink">{c.domain}</span></span></td>
                            <td className="num"><Badge tone={c.st.tone}>{c.st.label}</Badge></td>
                            <td className="font-mono text-xs whitespace-nowrap">{fmtDate(c.secs)}</td>
                            <td className="text-xs text-ink2 whitespace-nowrap">{c.issuer || '—'}</td>
                            <td>
                              <RenewalBadge v={c.renewal} method={c.method} />
                              {c.st.tone !== 'ok' && <div className="text-[11px] text-muted mt-1 max-w-[240px]">{c.st.hint}</div>}
                            </td>
                            <td className="font-mono text-[11px] text-faint max-w-[300px] truncate" title={c.file}>{c.file}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Sites({ sites, certs = [], exposure, loading }) {
  const [q, setQ] = useState('');
  const list = sites || [];
  const rows = list.filter((s) => !q || s.name.includes(q.toLowerCase()));
  const up = list.filter((s) => s.ok).length;
  const avg = (k) => { const v = list.map((s) => s[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lat = avg('lat24');
  const days = [...list.map((s) => (s.ssl != null ? Math.floor(s.ssl / 86400) : null)), ...certs.map((c) => Math.floor(c.secs / 86400))].filter((d) => d != null);
  const certIssues = certs.filter((c) => certState(c).tone !== 'ok').length;
  const minDays = days.length ? Math.min(...days) : null;
  const soon = days.filter((d) => d <= SSL_WARN_DAYS).length;

  return (
    <>
      <PageHead title="Sitios web y SSL" sub="Disponibilidad, certificados y exposición a Internet de tus proyectos y la sucursal virtual">
        <label className="flex items-center gap-1.5 bg-bg1 border border-line rounded-lg px-2.5 h-[30px]">
          <ISearch size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar sitio…" aria-label="Buscar sitio" className="bg-transparent border-0 text-ink font-mono text-[12.5px] outline-none w-48" />
        </label>
      </PageHead>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
        <KpiCard label="En línea" lead={<Pulse tone={up === list.length ? 'ok' : 'crit'} />} value={up} unit={` / ${list.length}`} foot={list.length - up ? `${list.length - up} caído(s) ahora` : 'Todos responden'} />
        <KpiCard label="Uptime promedio 24 h" value={pctUp(avg('u24'), 2)} foot="Media de todos los sitios" />
        <KpiCard label="Uptime promedio 30 días" value={pctUp(avg('u30'), 2)} foot="Requiere 30 días de historial" />
        <KpiCard label="Respuesta media 24 h" value={lat != null ? Math.round(lat * 1000) : '—'} unit={lat != null ? ' ms' : ''} foot="Tiempo total de la sonda" />
        <KpiCard label="Certificado más próximo" lead={minDays != null && <Pulse tone={minDays <= 7 ? 'crit' : minDays <= SSL_WARN_DAYS ? 'warn' : 'ok'} />}
          value={minDays ?? '—'} unit={minDays != null ? ' días' : ''} foot={soon ? `${soon} vence(n) en menos de ${SSL_WARN_DAYS} días` : 'Ninguno por vencer'} />
      </div>

      <section className="panel mb-4">
        <header className="panel-h"><h2>Monitores</h2><span className="panel-meta">{list.length} sitios · clic para ver el detalle</span></header>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Sitio</th><th className="min-w-[220px]">Últimas 24 h</th><th className="num">24 h</th><th className="num">7 días</th><th className="num">30 días</th><th className="num">Respuesta</th><th className="num">SSL vence</th><th /></tr></thead>
            <tbody>
              {rows.length ? rows.map((s) => {
                const d = s.ssl != null ? Math.floor(s.ssl / 86400) : null;
                return (
                  <tr key={s.target} className="cursor-pointer" onClick={() => goSite(s.target)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && goSite(s.target)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Pulse tone={!s.ok ? 'crit' : s.flaky ? 'warn' : 'ok'} />
                        <div><div className="font-mono text-ink text-[12.5px]"><EditName k={`site:${s.target}`} orig={s.name} /></div>
                          <div className="text-[11px] text-faint">{!s.ok ? <span className="text-crit">Caído · {s.code ? `HTTP ${s.code}` : 'sin respuesta'}</span>
                            : s.flaky ? <span className="text-warn" title="Alguna prueba de los últimos 5 minutos falló, pero el sitio sigue respondiendo">Intermitente · {s.fails5m} falla(s) en 5 min{s.lastFailed ? ' · la última falló' : ''}</span>
                            : `HTTP ${s.code ?? ''} · hace ${Math.round(s.age ?? 0)} s`}</div></div>
                      </div>
                    </td>
                    <td><UptimeBars values={s.bars} /></td>
                    <td className={`num ${upTone(s.u24)}`}>{pctUp(s.u24, 2)}</td>
                    <td className={`num ${upTone(s.u7)}`}>{pctUp(s.u7)}</td>
                    <td className={`num ${upTone(s.u30)}`}>{pctUp(s.u30)}</td>
                    <td className="num">{s.dur != null ? `${Math.round(s.dur * 1000)} ms` : '—'}</td>
                    <td className="num"><Badge tone={sslTone(d)}>{d == null ? '—' : `${d} d`}</Badge></td>
                    <td className="w-8 text-faint"><IChevron size={15} /></td>
                  </tr>
                );
              }) : <tr><td colSpan={8}><Empty>{loading ? 'Cargando…' : 'Sin sondas Blackbox. Agrega tus dominios (ver abajo).'}</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <CertServers certs={certs} loading={loading} />

      <ExposurePanel exposure={exposure} loading={loading} />

      <Panel title="Agregar o quitar sitios" bodyClass="p-4 text-[12.5px] text-ink2 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2.5">
          <p className="m-0">Los sitios salen del job <span className="font-mono text-ink">blackbox_http</span> de Prometheus. La configuración con todos tus proyectos está en <span className="font-mono text-ink">deploy/prometheus-blackbox.yml</span> del proyecto.</p>
          <p className="m-0 text-muted">Para ver uptime de 30 días, Prometheus debe guardar al menos 30 días de historial (<span className="font-mono">--storage.tsdb.retention.time=90d</span>).</p>
          <p className="m-0 text-muted">Las sondas corren desde el mismo servidor: si este se cae, no habrá datos. Mantén UptimeRobot como vigilancia externa.</p>
        </div>
        <pre className="m-0 bg-bg border border-line rounded-lg p-3 font-mono text-[11.5px] text-ink2 overflow-auto">{`static_configs:
  - targets:
      - https://empresa.com/
      - https://crm.empresa.com/
      - https://vault.empresa.com/
      # …

# Recargar sin reiniciar:
curl -X POST http://127.0.0.1:9090/-/reload`}</pre>
      </Panel>
    </>
  );
}
