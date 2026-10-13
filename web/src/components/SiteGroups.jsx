// Sitios web agrupados por el servidor donde viven (DNS → IP pública → instancia EC2), en desplegables.
// Los sitios cuyo dominio no apunta a ningún servidor propio quedan en su propio grupo (ej. empresa.com en hosting externo).
import { useEffect, useMemo, useState } from 'react';
import { DEMO } from '../config.js';
import { pulseTone } from '../hooks/useFleetRows.js';
import { SiteCard3D } from './cards3d.jsx';
import { EditName } from './EditName.jsx';
import { Pulse } from './ui.jsx';

const siteTone = (w) => { const d = w.ssl != null ? w.ssl / 86400 : null, ms = w.dur != null ? w.dur * 1000 : null; return !w.ok ? 'crit' : (d != null && d < 21) || (ms != null && ms > 2000) ? 'warn' : 'ok'; };
const RANK = { crit: 0, warn: 1, ok: 2, off: 3 };
const shortName = (t) => t.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');

function demoHosts(web) {
  const srv = { id: 'i-0demo', name: 'app-server', privateIp: '172.31.33.88', publicIp: '203.0.113.15' };
  return { sites: Object.fromEntries(web.map((w) => [w.target, /\/\/(www\.)?empresa\.com/.test(w.target) ? { ips: ['192.0.2.10'], server: null } : { ips: [srv.publicIp], server: srv }])) };
}

export function useSiteHosts(web) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (DEMO) return undefined;
    let a = true;
    const go = () => fetch('api/site-hosts', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => a && setSt(d)).catch(() => a && setSt(null));
    go(); const t = setInterval(go, 3600e3);
    return () => { a = false; clearInterval(t); };
  }, []);
  return DEMO ? demoHosts(web) : st;
}

export function SiteGroups({ web, all, hosts }) {
  const groups = useMemo(() => {
    const G = new Map();
    for (const w of web) {
      const h = hosts?.sites?.[w.target];
      let key, kind, server = null, row = null, ip = h?.ips?.[0] || null;
      if (!hosts) { key = 'all'; kind = 'all'; }
      else if (h?.server) {
        server = h.server; kind = 'server'; key = `ec2:${server.id}`;
        row = all.find((r) => (r.s.iid && r.s.iid === server.id) || (r.s.ip && r.s.ip === server.privateIp)) || null;
      } else if (ip) { key = `ip:${ip}`; kind = 'ip'; } else { key = 'nodns'; kind = 'nodns'; }
      if (!G.has(key)) G.set(key, { key, kind, server, row, ip, sites: [] });
      G.get(key).sites.push(w);
    }
    return [...G.values()].map((g) => {
      const tones = g.sites.map(siteTone);
      const tone = tones.sort((a, b) => RANK[a] - RANK[b])[0] || 'off';
      const down = g.sites.filter((w) => !w.ok).length;
      const ssl = g.sites.map((w) => w.ssl).filter((x) => x != null);
      const lat = g.sites.map((w) => w.dur).filter((x) => x != null);
      return { ...g, tone, down, minSsl: ssl.length ? Math.floor(Math.min(...ssl) / 86400) : null, avgMs: lat.length ? Math.round((lat.reduce((a, b) => a + b, 0) / lat.length) * 1000) : null };
    }).sort((a, b) => (a.kind === 'server' ? 0 : 1) - (b.kind === 'server' ? 0 : 1) || b.sites.length - a.sites.length);
  }, [web, all, hosts]);

  const [open, setOpen] = useState(() => { try { return JSON.parse(localStorage.getItem('infra.sitegroups.open') || '{}'); } catch { return {}; } });
  const isOpen = (g) => (g.key in open ? open[g.key] : g.kind === 'all' || g.tone === 'crit');
  const toggle = (g) => setOpen((o) => { const x = { ...o, [g.key]: !isOpen(g) }; try { localStorage.setItem('infra.sitegroups.open', JSON.stringify(x)); } catch { /* sin almacenamiento */ } return x; });

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const op = isOpen(g);
        const single = g.sites.length === 1 ? shortName(g.sites[0].target) : null;
        const title = g.kind === 'server'
          ? (g.row ? <EditName k={g.row.s.inst} orig={g.row.s.hostOrig || g.row.s.host} /> : <EditName k={`ec2:${g.server.id}`} orig={g.server.name} />)
          : g.kind === 'ip' ? <EditName k={`ip:${g.ip}`} orig={single ? `${single} · hosting externo` : `Servidor externo ${g.ip}`} />
          : g.kind === 'all' ? 'Todos los sitios' : 'Sin DNS';
        const sub = g.kind === 'server' ? `Servidor AWS${g.row?.s.itype ? ` · ${g.row.s.itype}` : ''} · IP ${g.server.publicIp || g.ip}`
          : g.kind === 'ip' ? `No está en tus servidores AWS · IP ${g.ip}` : g.kind === 'all' ? 'No se pudo saber en qué servidor está cada sitio' : 'El dominio no resuelve';
        return (
          <section key={g.key} className="panel overflow-hidden">
            <button type="button" onClick={() => toggle(g)} aria-expanded={op} className={`w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 hover:bg-bg1/60 transition-colors ${op ? 'border-b border-line' : ''}`}>
              <span className={`text-faint text-[12px] transition-transform ${op ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
              <div className="flex items-center gap-2.5 min-w-[240px]"><Pulse tone={g.row ? pulseTone(g.row) : g.tone} /><div><div className="text-ink font-semibold">{title}</div><div className="text-faint font-mono text-[11px]">{sub}</div></div></div>
              <div className="text-[12px]"><span className="font-mono text-ink">{g.sites.length}</span><span className="text-faint"> sitio{g.sites.length > 1 ? 's' : ''}</span></div>
              <div className="text-[12px]">{g.down ? <span className="text-crit">{g.down} caído{g.down > 1 ? 's' : ''}</span> : <span className="text-ok">todos en línea</span>}</div>
              <div className="text-[12px]"><span className="text-faint">SSL vence en </span><span className={`font-mono ${g.minSsl != null && g.minSsl < 21 ? 'text-warn' : 'text-ink'}`}>{g.minSsl != null ? `${g.minSsl} d` : '—'}</span></div>
              <div className="text-[12px]"><span className="text-faint">Latencia media </span><span className={`font-mono ${g.avgMs > 2000 ? 'text-warn' : 'text-ink'}`}>{g.avgMs != null ? `${g.avgMs} ms` : '—'}</span></div>
              {g.row && <div className="text-[12px]"><span className="text-faint">CPU </span><span className="font-mono text-ink">{g.row.s.cpu != null ? `${Math.round(g.row.s.cpu)}%` : '—'}</span><span className="text-faint"> · RAM </span><span className="font-mono text-ink">{g.row.s.memP != null ? `${Math.round(g.row.s.memP)}%` : '—'}</span></div>}
            </button>
            {op && <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 p-3">{g.sites.map((w) => <SiteCard3D key={w.target} w={w} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}
