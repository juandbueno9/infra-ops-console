// Convierte los datos reales del monitoreo en nodos para el mapa 3D.
import { pulseTone } from '../hooks/useFleetRows.js';
import { linkState } from './network.js';

const siteName = (t) => t.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

export function buildInfraNodes(model, web = [], net = null, name = (k, o) => o) {
  const nodes = [];
  for (const r of model?.all || []) {
    const tone = pulseTone(r);
    nodes.push({
      id: `s:${r.s.inst}`, kind: 'server', label: r.s.host || r.s.inst, tone, href: `#/s/${encodeURIComponent(r.s.inst)}`,
      detail: r.s.up !== 1 ? 'Sin respuesta del agente' : r.muted ? 'Alertas silenciadas' : `CPU ${pct(r.s.cpu)} · Mem ${pct(r.s.memP)} · Disco ${pct(r.s.fsP)}${r.a.A.length ? ` · ${r.a.A.length} alerta(s)` : ''}`,
    });
  }
  for (const w of web) {
    const days = w.ssl != null ? Math.floor(w.ssl / 86400) : null;
    const tone = !w.ok ? 'crit' : days != null && days < 21 ? 'warn' : 'ok';
    nodes.push({
      id: `w:${w.target}`, kind: 'site', label: name(`site:${w.target}`, siteName(w.target)), tone, href: `#/sitio/${encodeURIComponent(w.target)}`,
      detail: !w.ok ? `Caído${w.code ? ` · HTTP ${w.code}` : ''}` : `${w.dur != null ? Math.round(w.dur * 1000) + ' ms' : ''}${days != null ? ` · SSL ${days} días` : ''}`,
    });
  }
  const route = net?.route || {};
  if (route.vpn) nodes.push({ id: 'n:vpn', kind: 'agency', label: 'VPN AWS ↔ sede', tone: route.vpn.ok ? 'ok' : 'crit', href: '#/red', detail: route.vpn.ok ? `${Math.round(route.vpn.ms || 0)} ms` : 'Sin respuesta' });
  for (const a of net?.agencies || []) {
    const [lbl, tone] = linkState(a);
    nodes.push({ id: `a:${a.ip}`, kind: 'agency', label: name(`ag:${a.ip}`, a.name), tone, href: '#/red', detail: `${lbl}${a.rtt != null ? ` · ${Math.round(a.rtt)} ms` : ''} · ${a.ip}` });
  }
  const crit = nodes.filter((n) => n.tone === 'crit').length, warn = nodes.filter((n) => n.tone === 'warn').length;
  return { nodes, health: crit ? 'crit' : warn ? 'warn' : 'ok', crit, warn };
}

export const fxEnabled = () => { try { return localStorage.getItem('infra.fx3d') !== 'off'; } catch { return true; } };
export const setFx = (on) => { try { localStorage.setItem('infra.fx3d', on ? 'on' : 'off'); } catch { /* sin almacenamiento */ } };
