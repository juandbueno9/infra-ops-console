import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_RANGE, DEMO as DEMO_MODE, RANGES, REFRESH_OPTIONS, REFRESH_S } from './config.js';
import { loadDetail, loadFleet } from './lib/prom.js';
import { loadSite, loadSites, SITE_RANGES } from './lib/sites.js';
import { usePolling } from './hooks/usePolling.js';
import { useHashRoute } from './hooks/useHashRoute.js';
import { useHostActions } from './hooks/useHostActions.jsx';
import { useFleetRows } from './hooks/useFleetRows.js';
import { useToast } from './components/Toasts.jsx';
import { useScanWatcher } from './components/Scans.jsx';
import { useNetscanWatcher } from './components/NetScan.jsx';
import { useUpdatesWatcher } from './components/Updates.jsx';
import { useClonesWatcher } from './components/Clones.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { TopBar } from './components/TopBar.jsx';
import { IdleGuard } from './components/IdleGuard.jsx';
import { useSynologyWatcher } from './components/Synology.jsx';
import { Soc } from './pages/Soc.jsx';
import { Fleet } from './pages/Fleet.jsx';
import { Host } from './pages/Host.jsx';
import { Alerts } from './pages/Alerts.jsx';
import { Security } from './pages/Security.jsx';
import { Sites } from './pages/Sites.jsx';
import { Site } from './pages/Site.jsx';
import { Audit } from './pages/Audit.jsx';
import { Network } from './pages/Network.jsx';
import { Logs } from './pages/Logs.jsx';
import { Databases } from './pages/Databases.jsx';
import { Explore } from './pages/Explore.jsx';
import { Incidents } from './pages/Incidents.jsx';
import { Reports } from './pages/Reports.jsx';
import { StatusBoard } from './pages/StatusBoard.jsx';
import { CommandCenter } from './pages/CommandCenter.jsx';
import { Dashboards } from './pages/Dashboards.jsx';
import { Cloud } from './pages/Cloud.jsx';
import { Firewall } from './pages/Firewall.jsx';
import { incidentsApi } from './lib/api.js';
import { loadNetwork } from './lib/network.js';
import { Settings } from './pages/Settings.jsx';

const readPref = (k, d) => { try { return localStorage.getItem('infra.' + k) ?? d; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem('infra.' + k, String(v)); } catch { /* sin almacenamiento */ } };
const readCollapsed = () => { try { return localStorage.getItem('infra.sidebar') === 'collapsed'; } catch { return false; } };
const fetchHealth = async () => { const r = await fetch('api/health', { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

export default function App() {
  const route = useHashRoute();
  const toast = useToast();
  const act = useHostActions();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshS, setRefreshS] = useState(() => { const v = Number(readPref('refresh', REFRESH_S)); return REFRESH_OPTIONS.includes(v) ? v : REFRESH_S; });
  const [range, setRange] = useState(() => { const v = readPref('range', DEFAULT_RANGE); return RANGES[v] ? v : DEFAULT_RANGE; });
  const changeRefresh = (v) => { setRefreshS(v); savePref('refresh', v); };
  const changeRange = (v) => { setRange(v); savePref('range', v); };
  const [siteRange, setSiteRange] = useState(() => { const v = readPref('siteRange', '1h'); return SITE_RANGES[v] ? v : '1h'; });
  const changeSiteRange = (v) => { setSiteRange(v); savePref('siteRange', v); };

  const fleet = usePolling(loadFleet, refreshS, []);
  const host = usePolling(() => (route.host ? loadDetail(route.host, range) : Promise.resolve(null)), refreshS, [route.host, range]);
  const sitesOn = route.view === 'sitios' || route.view === 'estado';
  const sites = usePolling(() => (sitesOn ? loadSites() : Promise.resolve(null)), Math.max(refreshS, 15) || 0, [sitesOn]);
  const site = usePolling(() => (route.site ? loadSite(route.site, siteRange) : Promise.resolve(null)), Math.max(refreshS, 15) || 0, [route.site, siteRange]);
  const net = usePolling(loadNetwork, Math.max(refreshS, 30) || 0, []);
  const incs = usePolling(() => (DEMO_MODE ? Promise.resolve([{ status: 'investigando' }]) : incidentsApi.list()), 60, []);
  const health = usePolling(fetchHealth, Math.max(refreshS, 30) || 30, []);
  const model = useFleetRows(fleet.data);
  useNetscanWatcher(toast); // ping y escaneos de red desde una misma IP (FortiGate + servidores)
  useScanWatcher(toast); // avisa de escaneos y ataques nuevos aunque estés en otra página
  useUpdatesWatcher(model, toast); // una vez al día: parches de seguridad o reinicio pendiente
  useSynologyWatcher(toast); // problemas en los NAS Synology (discos, RAID, temperatura)
  useClonesWatcher(toast); // cada 6 h: dominios parecidos o clones de empresa.com

  const toggleCollapsed = useCallback(() => setCollapsed((c) => {
    try { localStorage.setItem('infra.sidebar', c ? 'expanded' : 'collapsed'); } catch { /* sin almacenamiento */ }
    return !c;
  }), []);
  // El botón ☰ colapsa en escritorio y abre el cajón en móvil
  const onMenu = () => (window.matchMedia('(min-width: 1024px)').matches ? toggleCollapsed() : setMobileOpen(true));

  // #/s/ sin host → primer host visible
  useEffect(() => {
    if (route.view === 'host' && !route.host && model.all.length) location.replace('#/s/' + encodeURIComponent(model.all[0].s.inst));
  }, [route, model.all]);

  // Toast persistente al perder Prometheus; aviso al recuperar
  const hadError = useRef(false);
  useEffect(() => {
    if (fleet.error) {
      if (!hadError.current) {
        toast.error('No se pudo consultar Prometheus', 'Los datos en pantalla pueden estar desactualizados. Se reintentará automáticamente.', {
          key: 'conn', every: 0,
          details: `Error: ${fleet.error.message}\n${fleet.error.details || ''}\nHora: ${new Date().toISOString()}\n\n¿Está abierto el túnel? → npm run tunnel`,
          action: { label: 'Reintentar ahora', fn: () => fleet.refresh() },
        });
      }
      hadError.current = true;
      if (/sesión/i.test(fleet.error.message)) setTimeout(() => (location.href = '/login'), 2500);
    } else if (fleet.data && hadError.current) {
      hadError.current = false;
      toast.dismiss('conn');
      toast.success('Conexión con Prometheus restablecida');
    }
  }, [fleet.error, fleet.data, fleet.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = () => { fleet.refresh(); host.refresh(); sites.refresh(); site.refresh(); health.refresh(); act.reload(); toast.info('Actualizando datos…', '', { ms: 1800 }); };
  useEffect(() => {
    const k = (e) => {
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && !document.querySelector('[role="alertdialog"],[role="dialog"]')) refreshAll();
      if (e.key === '[' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) toggleCollapsed();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });

  useEffect(() => {
    const t = { fleet: 'Resumen', dashboards: 'Vista ejecutiva', nube: 'Costos AWS y S3', alertas: 'Alertas', seguridad: 'Seguridad', sitios: 'Sitios web', red: 'Red y agencias', fortigate: 'FortiGate', logs: 'Logs', bd: 'Bases de datos', explorar: 'Explorar', incidentes: 'Incidentes', reportes: 'Reportes SLA', estado: 'Estado de servicios', '3d': 'Centro de mando 3D', auditoria: 'Auditoría', config: 'Configuración' }[route.view];
    document.title = route.view === 'host' && route.host ? `${route.host} · Infra Ops` : `${t || 'Observabilidad'} · Infra Ops`;
  }, [route]);

  let page;
  switch (route.view) {
    case 'host': page = <Host d={host.data && host.data.inst === route.host ? host.data : null} loading={host.loading} range={range} onRange={changeRange} />; break;
    case 'alertas': page = <Alerts model={model} />; break;
    case 'seguridad': page = <Security model={model} />; break;
    case 'soc': page = <Soc model={model} data={fleet.data} />; break;
    case 'sitios': page = <Sites sites={sites.data?.sites} certs={sites.data?.certs} exposure={sites.data?.exposure} loading={sites.loading} />; break;
    case 'sitio': page = <Site d={site.data && site.data.target === route.site ? site.data : null} loading={site.loading} range={siteRange} onRange={changeSiteRange} />; break;
    case 'red': page = <Network data={net.data?.agencies} route={net.data?.route} loading={net.loading} error={net.error} />; break;
    case 'logs': page = <Logs />; break;
    case 'bd': page = <Databases />; break;
    case 'explorar': page = <Explore />; break;
    case 'incidentes': page = <Incidents />; break;
    case 'reportes': page = <Reports />; break;
    case 'estado': page = <StatusBoard model={model} sites={sites.data?.sites} net={net.data} />; break;
    case 'nube': page = <Cloud />; break;
    case 'fortigate': page = <Firewall />; break;
    case 'dashboards': page = <Dashboards data={fleet.data} model={model} net={net.data} />; break;
    case '3d': page = <CommandCenter model={model} web={fleet.data?.web} net={net.data} />; break;
    case 'auditoria': page = <Audit tab={route.tab} params={route.params} />; break;
    case 'config': page = <Settings health={health.data} refreshS={refreshS} />; break;
    default: page = <Fleet data={fleet.data} model={model} net={net.data} />;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar route={route} model={model} openIncidents={(incs.data || []).filter((i) => i.status !== 'resuelto').length} netDown={(net.data?.agencies || []).filter((a) => !a.ok).length + Object.values(net.data?.route || {}).filter((r) => !r.ok).length} collapsed={collapsed} onToggle={toggleCollapsed}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} health={health.error ? null : health.data} />
      <div className="flex-1 min-w-0 flex flex-col">
        <IdleGuard />
        <TopBar route={route} model={model} live={{ error: fleet.error, at: fleet.updatedAt }} onRefresh={refreshAll} onMenu={onMenu} refreshS={refreshS} onRefreshS={changeRefresh} />
        <main className="flex-1 w-full max-w-[1840px] mx-auto px-4 lg:px-6 pt-5 pb-8">
          {page}
          <footer className="flex gap-4 flex-wrap border-t border-line mt-6 pt-3.5 text-faint text-xs">
            <span>IT Infrastructure Team · <span className="font-mono">admin@empresa.com</span></span>
            <span className="flex-1" />
            <span>Acceso restringido a personal autorizado · Actividad monitoreada (Ley 1273 de 2009)</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
