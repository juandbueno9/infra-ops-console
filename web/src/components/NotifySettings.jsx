// Configuración → Alertas por correo: tabla de notificaciones × correos. Cada correo marca qué le llega.
// Los correos solo se envían cuando algo se cae y cuando vuelve (nunca repetidos mientras siga caído).
import { Fragment, useEffect, useRef, useState } from 'react';
import { DEMO } from '../config.js';
import { checkSession, useCanEdit } from '../lib/me.js';
import { Panel, Pulse } from './ui.jsx';

const fmtT = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

async function call(method, path, body) {
  if (DEMO) return demo();
  const r = await fetch(`api/notify${path}`, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (checkSession(r, d)) throw new Error('Sesión vencida');
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}

export function NotifySettings() {
  const canEdit = useCanEdit();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty0] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const dirtyRef = useRef(false);
  const setDirty = (v) => { dirtyRef.current = v; setDirty0(v); };

  const load = () => call('GET', '').then((d) => { setData(d); if (!dirtyRef.current) setCfg(structuredClone(d.config)); }).catch((e) => setMsg({ tone: 'crit', text: e.message }));
  useEffect(() => { load(); const t = setInterval(load, 60e3); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn) => { setCfg((c) => { const n = structuredClone(c); fn(n); return n; }); setDirty(true); };
  const save = async () => {
    setBusy(true); setMsg(null);
    try { const d = await call('PUT', '', cfg); setData(d); setCfg(structuredClone(d.config)); setDirty(false); setMsg({ tone: 'ok', text: 'Guardado.' }); }
    catch (e) { setMsg({ tone: 'crit', text: e.message }); } finally { setBusy(false); }
  };
  const test = async (emails) => {
    if (dirty) return setMsg({ tone: 'warn', text: 'Guarda los cambios antes de enviar la prueba.' });
    setBusy(true); setMsg(null);
    try { const r = await call('POST', '/test', { emails }); setMsg({ tone: 'ok', text: `Correo de prueba enviado a ${r.to.join(', ')}. Revisa la bandeja (y el correo no deseado).` }); load(); }
    catch (e) { setMsg({ tone: 'crit', text: e.message }); } finally { setBusy(false); }
  };
  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL.test(e)) return setMsg({ tone: 'warn', text: 'Escribe un correo válido.' });
    if (cfg.recipients.some((r) => r.email === e)) return setMsg({ tone: 'warn', text: 'Ese correo ya está en la lista.' });
    const def = Object.entries(data.items).filter(([, it]) => it.def).map(([k]) => k);
    edit((c) => { c.recipients.push({ email: e, items: def, enabled: true }); }); setNewEmail(''); setMsg(null);
  };

  if (!data || !cfg) return <Panel title="Alertas por correo" className="col-span-12" bodyClass="p-4 text-[13px] text-muted">{msg?.text || 'Cargando…'}</Panel>;
  const items = data.items, st = data.status || {};
  const groups = Object.entries(items).reduce((g, [k, it]) => { (g[it.group] ||= []).push([k, it]); return g; }, {});
  const R = cfg.recipients;
  const inp = 'h-8 px-2.5 bg-bg border border-line rounded-md text-[12.5px] text-ink outline-none focus:border-info disabled:opacity-60';
  const toggle = (ri, k) => edit((c) => { const s = new Set(c.recipients[ri].items); s.has(k) ? s.delete(k) : s.add(k); c.recipients[ri].items = [...s]; });
  const rowAll = (k, on) => edit((c) => { c.recipients.forEach((r) => { const s = new Set(r.items); on ? s.add(k) : s.delete(k); r.items = [...s]; }); });
  const errs = Object.entries(st.collectorErrors || {});

  return (
    <Panel title="Alertas por correo" className="col-span-12" bodyClass="p-4 space-y-4"
      meta={`${cfg.enabled ? 'activadas' : 'desactivadas'} · ${R.length} correo(s) · solo caídas y restablecimientos`}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5 text-[12.5px] min-w-[230px]">
          <div className="flex items-center gap-2"><Pulse tone={data.configured ? 'ok' : 'crit'} /><span className="text-ink2">Aplicación de Microsoft 365</span><span className="ml-auto text-faint">{data.configured ? 'lista' : 'faltan credenciales'}</span></div>
          <div className="flex items-center gap-2"><Pulse tone={st.lastError ? 'warn' : st.lastSend ? 'ok' : 'off'} /><span className="text-ink2">Último envío</span><span className="ml-auto text-faint">{fmtT(st.lastSend)}</span></div>
        </div>
        <label className="text-[12px] text-muted flex-1 min-w-[260px]">Enviar desde (opcional · vacío = cuenta del primer destinatario)
          <input className={`${inp} w-full mt-1`} disabled={!canEdit} placeholder="vacío = primer destinatario" value={cfg.sender} onChange={(e) => edit((c) => { c.sender = e.target.value; })} />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink2 h-8"><input type="checkbox" disabled={!canEdit} checked={cfg.enabled} onChange={(e) => edit((c) => { c.enabled = e.target.checked; })} /> Enviar correos</label>
        {canEdit && <button type="button" disabled={busy || !dirty} onClick={save} className="h-8 px-4 rounded-md bg-info/20 border border-info/40 text-info text-[12.5px] font-medium disabled:opacity-40">Guardar cambios</button>}
      </div>
      {st.lastError && <div className="text-[12px] text-warn bg-warn/[.07] border border-warn/25 rounded-md px-3 py-2">Último error al enviar: {st.lastError}</div>}
      {msg && <div className={`text-[12px] rounded-md px-3 py-2 border ${msg.tone === 'ok' ? 'text-ok border-ok/30 bg-ok/[.07]' : msg.tone === 'warn' ? 'text-warn border-warn/30 bg-warn/[.07]' : 'text-crit border-crit/30 bg-crit/[.07]'}`}>{msg.text}</div>}

      {/* Tabla notificaciones × correos */}
      <div className="overflow-x-auto border border-line rounded-lg">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-bg1">
              <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-faint font-medium min-w-[300px]">Notificación</th>
              {R.map((r, ri) => (
                <th key={r.email} className="px-2 py-2 align-bottom min-w-[150px] border-l border-line">
                  <div className={`font-mono text-[11.5px] break-all ${r.enabled ? 'text-ink' : 'text-faint line-through'}`}>{r.email}</div>
                  {canEdit && <div className="flex justify-center gap-2 mt-1 text-[10.5px]">
                    <button type="button" className="text-info hover:underline disabled:opacity-40" disabled={busy} onClick={() => test([r.email])}>prueba</button>
                    <button type="button" className="text-muted hover:underline" onClick={() => edit((c) => { c.recipients[ri].enabled = !c.recipients[ri].enabled; })}>{r.enabled ? 'pausar' : 'activar'}</button>
                    <button type="button" className="text-crit hover:underline" onClick={() => { if (confirm(`¿Quitar ${r.email} de las alertas?`)) edit((c) => { c.recipients.splice(ri, 1); }); }}>quitar</button>
                  </div>}
                </th>
              ))}
              {canEdit && <th className="px-2 py-2 border-l border-line min-w-[230px] align-bottom">
                <div className="flex gap-1.5"><input className={`${inp} flex-1 min-w-0`} placeholder="agregar correo…" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEmail()} />
                  <button type="button" onClick={addEmail} className="h-8 px-2.5 rounded-md border border-line text-info hover:bg-surface">+</button></div>
              </th>}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([g, list]) => (
              <Fragment key={g}>
                <tr><td colSpan={R.length + 2} className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint border-t border-line">{g}</td></tr>
                {list.map(([k, it]) => {
                  const allOn = R.length && R.every((r) => r.items.includes(k));
                  return (
                    <tr key={k} className="hover:bg-surface/60">
                      <td className="px-3 py-1.5">
                        <div className="text-ink2">{it.label}</div>
                        {it.desc && <div className="text-[11px] text-faint">{it.desc}</div>}
                      </td>
                      {R.map((r, ri) => (
                        <td key={r.email} className="text-center border-l border-line">
                          <input type="checkbox" className="w-4 h-4 accent-[#5AB8FF] cursor-pointer disabled:cursor-default" disabled={!canEdit} checked={r.items.includes(k)} onChange={() => toggle(ri, k)} aria-label={`${it.label} → ${r.email}`} />
                        </td>
                      ))}
                      {canEdit && <td className="border-l border-line px-2"><button type="button" disabled={!R.length} className="text-[11px] text-muted hover:text-info" onClick={() => rowAll(k, !allOn)}>{allOn ? 'quitar a todos' : 'marcar a todos'}</button></td>}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-faint">Cada caída se avisa una sola vez cuando se confirma (2 revisiones seguidas, ≈2 min) y otra vez cuando se restablece, con lo que pasó y cuánto duró. Las de seguridad se avisan una vez por IP. En la pantalla del panel las notificaciones se repiten como máximo una vez por hora.</div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-6">
          <div className="text-[12px] text-muted mb-1.5">Caídas activas ahora ({data.active.length})</div>
          <div className="border border-line rounded-md max-h-[220px] overflow-auto divide-y divide-line text-[12px]">
            {!data.active.length && <div className="p-3 text-faint">Nada caído.</div>}
            {data.active.map((a) => <div key={a.key} className="px-3 py-1.5 flex gap-2"><span className="text-crit">●</span><span className="text-ink2 flex-1">{a.title}</span><span className="text-faint whitespace-nowrap">desde {fmtT(a.since)}</span></div>)}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <div className="text-[12px] text-muted mb-1.5">Últimos correos enviados</div>
          <div className="border border-line rounded-md max-h-[220px] overflow-auto divide-y divide-line text-[12px]">
            {!data.log.length && <div className="p-3 text-faint">Aún no se ha enviado ningún correo.</div>}
            {data.log.map((l, i) => <div key={i} className="px-3 py-1.5"><span className={l.ok ? 'text-ok' : 'text-crit'}>{l.ok ? '✔' : '✘'}</span> <span className="text-faint">{fmtT(l.at)}</span> <span className="text-ink2">{l.subject}</span>
              <div className="text-faint truncate">{(l.to || []).join(', ')}{l.error ? ` · ${l.error}` : ''}</div></div>)}
          </div>
        </div>
      </div>
      {errs.length > 0 && <div className="text-[11.5px] text-faint">Fuentes que no respondieron en la última revisión: {errs.map(([k, e]) => `${k}: ${e}`).join(' · ')}</div>}
      {!data.configured && <div className="text-[12px] text-ink2 bg-warn/[.07] border border-warn/25 rounded-md p-3">Faltan las credenciales de la aplicación de Microsoft 365 en el servidor (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) con permiso de aplicación <b>Mail.Send</b>.</div>}
    </Panel>
  );
}

function demo() {
  const items = {
    agencia: { group: 'Red', label: 'Agencia sin conexión / restablecida', desc: 'Qué agencia se cayó, por qué enlace y cuándo volvió', def: true },
    vpn_aws: { group: 'Red', label: 'Túnel VPN AWS ↔ sede caído / restablecido', desc: 'Sin conexión entre AWS y la sede principal', def: true },
    fortigate: { group: 'Red', label: 'FortiGate de la sede sin respuesta', desc: '', def: false },
    sitio_principal: { group: 'Sitios web', label: 'Página empresa.com caída / restablecida', desc: '', def: true },
    sitios: { group: 'Sitios web', label: 'Otros sitios web caídos / restablecidos', desc: '', def: false },
    ssl: { group: 'Sitios web', label: 'Certificado SSL a 3 días de vencer', desc: '', def: true },
    servidor: { group: 'Servidores', label: 'Servidor sin respuesta / restablecido', desc: '', def: false },
    nas: { group: 'NAS Synology', label: 'Falla grave en un NAS', desc: '', def: false },
    escaneo: { group: 'Seguridad', label: 'Escaneo o ping desde una misma IP', desc: '', def: false },
  };
  return { configured: true, items, status: { lastSend: Date.now() - 3600e3, collectorErrors: {} },
    config: { enabled: true, sender: '', recipients: [
      { email: 'admin@empresa.com', items: ['agencia', 'vpn_aws', 'sitio_principal', 'ssl', 'nas'], enabled: true },
      { email: 'admin@empresa.com', items: ['agencia', 'vpn_aws', 'sitio_principal', 'ssl'], enabled: true }] },
    active: [{ key: 'a', title: 'Agencia Cartagena sin conexión', since: Date.now() - 12 * 60e3 }],
    log: [{ at: Date.now() - 3600e3, to: ['admin@empresa.com', 'admin@empresa.com'], subject: '[RESTABLECIDO] Agencia Neiva restablecida · 6 min sin servicio', ok: true }] };
}
