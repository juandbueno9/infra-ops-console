// Suplantación de la página web: dominios parecidos a empresa.com y certificados SSL con "empresa".
import { useEffect, useState } from 'react';
import { DEMO } from '../config.js';
import { KpiCard } from './charts.jsx';
import { Badge, Empty, Panel, Pulse } from './ui.jsx';

const SEV = { crit: ['crit', '⚠ Posible clon'], warn: ['warn', 'Sospechoso'], info: ['off', 'Vigilar'] };
const SRC = { typo: 'Error de tipeo', combo: 'Nombre + palabra', tld: 'Otra terminación', cert: 'Certificado SSL', 'typo+cert': 'Tipeo + certificado', 'combo+cert': 'Nombre + certificado', 'tld+cert': 'Terminación + certificado' };

export async function loadClones(force = false) {
  if (DEMO) return demo();
  const r = await fetch(`api/clones${force ? '?force=1' : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

/** Revisa cada 6 h y avisa una vez por dominio sospechoso nuevo. */
export function useClonesWatcher(toast) {
  useEffect(() => {
    let alive = true;
    const run = async () => {
      let d; try { d = await loadClones(); } catch { return; }
      if (!alive) return;
      let seen = []; try { seen = JSON.parse(localStorage.getItem('infra.clones.seen') || '[]'); } catch { /* sin almacenamiento */ }
      const fresh = (d.domains || []).filter((x) => x.sev !== 'info' && !seen.includes(x.domain));
      if (!fresh.length) return;
      try { localStorage.setItem('infra.clones.seen', JSON.stringify([...seen, ...fresh.map((x) => x.domain)].slice(-300))); } catch { /* sin almacenamiento */ }
      const crit = fresh.filter((x) => x.sev === 'crit');
      const t = crit.length ? `⚠ Posible clon de la página: ${crit[0].domain}` : `Dominio sospechoso: ${fresh[0].domain}`;
      (crit.length ? toast.error : toast.warn)(t, `${fresh.length} dominio(s) nuevo(s) parecido(s) a empresa.com`, { key: 'clones', action: { label: 'Ver en Seguridad', fn: () => { location.hash = '#/seguridad'; setTimeout(() => document.getElementById('clones')?.scrollIntoView({ behavior: 'smooth' }), 300); } } });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') try { new Notification(t, { tag: 'infra-clones' }); } catch { /* sin notificaciones */ }
    };
    const first = setTimeout(run, 20e3); // después de cargar el panel
    const iv = setInterval(run, 6 * 3600e3);
    return () => { alive = false; clearTimeout(first); clearInterval(iv); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ClonesPanel() {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const [open, setOpen] = useState(null);
  const load = (force) => { setSt((s) => ({ ...s, loading: true })); loadClones(force).then((d) => setSt({ loading: false, data: d, error: null })).catch((e) => setSt((s) => ({ ...s, loading: false, error: e.message }))); };
  useEffect(() => { load(false); }, []);
  const D = st.data, list = D?.domains || [];
  const crit = list.filter((x) => x.sev === 'crit').length, warn = list.filter((x) => x.sev === 'warn').length, certs = list.filter((x) => String(x.source).includes('cert')).length;

  return (
    <section id="clones" className="mb-6">
      <div className="flex items-center justify-between mb-3 mt-2 flex-wrap gap-2">
        <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-sm bg-crit shadow-[0_0_8px_#EF4444]" />Suplantación de la página web (clones y dominios falsos)</h2>
        <div className="flex items-center gap-2 text-[11.5px] text-faint">
          {D?.at && <span>revisado {new Date(D.at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · cada 12 h</span>}
          <button type="button" className="btn h-[28px]" disabled={st.loading} onClick={() => load(true)}>{st.loading ? 'Revisando… (≈1 min)' : 'Revisar ahora'}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Posibles clones" lead={<Pulse tone={crit ? 'crit' : 'ok'} />} value={D ? crit : '—'} foot="Usan la marca y piden contraseña o copian el sitio" />
        <KpiCard label="Dominios sospechosos" lead={<Pulse tone={warn ? 'warn' : 'ok'} />} value={D ? warn : '—'} foot="Mencionan la empresa, correo o SSL reciente" />
        <KpiCard label="Dominios parecidos registrados" value={D ? list.length : '—'} foot={D ? `de ${D.checked} variantes revisadas` : 'Errores de tipeo, palabras, terminaciones'} />
        <KpiCard label="Certificados con 'empresa'" value={D ? (D.certsOk ? certs : '—') : '—'} foot={D && !D.certsOk ? 'crt.sh no respondió esta vez' : 'Registro público de certificados SSL'} />
      </div>
      <Panel title="Dominios encontrados" meta={D ? `${list.length} · ${D.demo ? 'demostración' : D.fromCache ? 'desde caché' : 'recién revisado'}` : ''} bodyClass="overflow-x-auto max-h-[520px]">
        {st.error && <div className="text-warn text-[12px] px-4 py-2">No se pudo revisar: {st.error}</div>}
        {list.length ? (
          <table className="tbl">
            <thead><tr><th>Riesgo</th><th>Dominio</th><th>Cómo se parece</th><th>IP / correo</th><th>Qué hay en la página</th><th /></tr></thead>
            <tbody>
              {list.map((x) => [
                <tr key={x.domain} className="cursor-pointer" onClick={() => setOpen(open === x.domain ? null : x.domain)} title="Clic para ver la evidencia y abrir el sitio">
                  <td><Badge tone={SEV[x.sev][0]}>{SEV[x.sev][1]}</Badge></td>
                  <td className="font-mono text-ink whitespace-nowrap">{open === x.domain ? '▾ ' : '▸ '}{x.domain}</td>
                  <td className="text-[11.5px]">{SRC[x.source] || x.source}{x.certFirst ? <div className="text-faint">SSL desde {String(x.certFirst).slice(0, 10)}</div> : null}</td>
                  <td className="font-mono text-[11px]">{(x.ips || []).slice(0, 2).join(', ') || '—'}{x.mx?.length ? <div className="text-warn">correo: {x.mx[0]}</div> : null}</td>
                  <td className="text-[11.5px] max-w-[380px]"><div className={x.sev === 'crit' ? 'text-crit font-semibold' : 'text-ink2'}>{x.reason}</div>{x.http?.title ? <div className="text-faint truncate" title={x.http.title}>“{x.http.title}”</div> : null}</td>
                  <td className="whitespace-nowrap text-[11.5px]">
                    <a href={`https://who.is/whois/${x.domain}`} target="_blank" rel="noreferrer" className="text-info hover:underline" onClick={(e) => e.stopPropagation()}>Whois ›</a>
                    {x.ips?.[0] && <a href={`https://www.abuseipdb.com/check/${x.ips[0]}`} target="_blank" rel="noreferrer" className="text-info hover:underline ml-2" onClick={(e) => e.stopPropagation()}>IP ›</a>}
                  </td>
                </tr>,
                open === x.domain && (
                  <tr key={x.domain + '-d'} className="sub-row"><td /><td colSpan={5} className="py-3 text-[12px] space-y-1.5">
                    <div><span className="text-faint">Dirección de la página: </span><span className="font-mono text-ink break-all">{x.http?.finalUrl || `http://${x.domain}/`}</span>{x.http?.finalUrl && !x.http.finalUrl.includes(x.domain) ? <span className="text-warn"> · redirige a otro dominio</span> : null}</div>
                    {x.http?.title && <div><span className="text-faint">Título: </span><span className="text-ink2">{x.http.title}</span></div>}
                    {x.http?.desc && <div><span className="text-faint">Descripción: </span><span className="text-ink2">{x.http.desc}</span></div>}
                    {x.http?.excerpt ? <div><span className="text-faint">Dónde menciona a la empresa: </span><span className="text-ink2 italic">“…{x.http.excerpt}…”</span></div>
                      : x.http?.inCode ? <div className="text-ink2">La marca no aparece en el texto visible, solo en el código de la página (enlaces o imágenes).</div> : null}
                    {x.http?.brandLinks?.length > 0 && <div><span className="text-faint">Enlaces con “empresa”: </span>{x.http.brandLinks.map((l) => <span key={l} className="font-mono text-[11px] text-ink2 mr-2 break-all">{l}</span>)}</div>}
                    {!x.http && <div className="text-ink2">No tiene página web activa (solo el dominio{x.mx?.length ? ' y correo' : ''}).</div>}
                    {x.http && !x.http.excerpt && !x.http.brandLinks?.length && x.http.mentionsBrand && <div className="text-faint">Pulsa “Revisar ahora” para obtener el detalle de dónde aparece la marca.</div>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a className="btn h-[28px] no-underline" href={`https://urlscan.io/domain/${x.domain}`} target="_blank" rel="noopener noreferrer">Ver captura segura (urlscan.io)</a>
                      <a className="btn h-[28px] no-underline" href={`https://web.archive.org/web/2026*/${x.domain}`} target="_blank" rel="noopener noreferrer">Historial (Wayback Machine)</a>
                      <a className="btn h-[28px] no-underline" href={x.http?.finalUrl || `http://${x.domain}/`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => { if (!window.confirm(`Vas a abrir ${x.domain} en una pestaña nueva.\n\nNo inicies sesión ni escribas datos en esa página. ¿Continuar?`)) e.preventDefault(); }}>Abrir el sitio ↗</a>
                    </div>
                  </td></tr>
                ),
              ])}
            </tbody>
          </table>
        ) : <Empty>{st.loading ? 'Revisando cientos de variantes del dominio… la primera vez tarda cerca de 1 minuto.' : 'No se encontraron dominios parecidos registrados.'}</Empty>}
      </Panel>
      <div className="text-[11px] text-faint mt-2 space-y-1">
        <p>Por seguridad <b className="text-ink2">no abras</b> estos dominios desde tu equipo; usa los enlaces de Whois e IP. Si uno resulta ser un clon: repórtalo al registrador (abuse en el Whois), a Google Safe Browsing (safebrowsing.google.com/safebrowsing/report_phish) y al CSIRT de Colombia (ColCERT), y avisa a los asociados.</p>
        <p>Dominios propios que no se marcan: <span className="font-mono">{(D?.legit || ['empresa.com']).join(', ')}</span> (se agregan en server/.env → CLONES_LEGIT).</p>
      </div>
    </section>
  );
}

function demo() {
  return {
    at: Date.now() - 3 * 3600e3, checked: 728, certsOk: true, legit: ['empresa.com'], demo: true, domains: [
      { domain: 'empresa-sucursalvirtual.online', source: 'combo+cert', certFirst: '2026-09-21', ips: ['203.0.113.12'], mx: [], http: { status: 200, title: 'Sucursal Virtual la empresa', mentionsBrand: true, hasPassword: true }, sev: 'crit', reason: 'Usa el nombre la empresa y pide contraseña: posible página de phishing' },
      { domain: '3mpresa.com', source: 'typo', ips: ['203.0.113.13'], mx: ['mx.zoho.com'], http: null, sev: 'warn', reason: 'Tiene correo configurado (MX): podrían enviar correos haciéndose pasar por la empresa' },
      { domain: 'empresa.co', source: 'tld', ips: ['203.0.113.14'], mx: [], http: { status: 200, title: 'empresa.co está a la venta', parked: true }, sev: 'info', reason: 'Dominio parqueado o a la venta (vigilar)' },
    ],
  };
}
