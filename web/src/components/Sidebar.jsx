// Navegación lateral estilo consoInfra Opsrial.
//  - Escritorio: expandida (240px) o colapsada a íconos (64px) con tooltips; se recuerda la preferencia.
//  - Móvil/tablet (<1024px): cajón deslizable con fondo oscuro; se cierra al navegar o con Esc.
import { useEffect, useState } from 'react';
import { useCanEdit } from '../lib/me.js';
import { DEMO } from '../config.js';
import { pulseTone } from '../hooks/useFleetRows.js';
import { Pulse } from './ui.jsx';
import { BrandLogo } from './Brand.jsx';
import { IAlert, IChevron, ICollapse, IGlobe, IGrid, INetwork, ILogs, IDatabase, ICompass, IFlame, IReport, IMonitor, ICube, IHistory, IServer, IShield, ISliders, IX, IChart3D, ICloud } from './icons.jsx';

function NavItem({ href, icon, label, active, collapsed, badge, onNavigate }) {
  return (
    <a href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined}
      className={`group relative flex items-center gap-3 h-9 rounded-lg no-underline transition-colors
        ${collapsed ? 'justify-center px-0 mx-2' : 'px-3 mx-2.5'}
        ${active ? 'bg-info/[.12] text-ink' : 'text-muted hover:bg-surface hover:text-ink'}`}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-info -ml-2.5" aria-hidden="true" />}
      <span className={`shrink-0 ${active ? 'text-info' : ''}`}>{icon}</span>
      {!collapsed && <span className="flex-1 truncate font-medium text-[13px]">{label}</span>}
      {badge}
      {collapsed && (
        <span role="tooltip" className="pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md bg-[#0a1a1f] border border-line2 text-ink text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50 shadow-lg">{label}</span>
      )}
    </a>
  );
}

const Num = ({ n, tone, collapsed }) => {
  if (!n) return null;
  const cls = tone === 'crit' ? 'bg-crit text-white' : tone === 'warn' ? 'bg-warn text-[#1a1203]' : 'bg-line2 text-ink2';
  return collapsed
    ? <span className={`absolute top-1 right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-mono font-semibold grid place-items-center ${cls}`}>{n > 99 ? '99+' : n}</span>
    : <span className={`min-w-[20px] h-[18px] px-1.5 rounded-full text-[11px] font-mono font-semibold grid place-items-center ${cls}`}>{n}</span>;
};

const Section = ({ label, collapsed }) => collapsed
  ? <div className="h-px bg-line mx-4 my-3" />
  : <div className="px-5 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-[.1em] text-faint uppercase">{label}</div>;

export function Sidebar({ route, model, collapsed, onToggle, mobileOpen, onCloseMobile, health, netDown = 0, openIncidents = 0 }) {
  const [hostsOpen, setHostsOpen] = useState(true);
  const canEdit = useCanEdit(); // la auditoría solo la ven administradores
  useEffect(() => {
    if (!mobileOpen) return;
    const k = (e) => e.key === 'Escape' && onCloseMobile();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [mobileOpen, onCloseMobile]);

  const c = collapsed && !mobileOpen;           // en móvil siempre expandida
  const nav = mobileOpen ? onCloseMobile : undefined;
  const hosts = model.all;
  const promOk = health?.prometheus;

  const content = (
    <div className="flex flex-col h-full">
      <div className={`flex items-center h-14 border-b border-line shrink-0 ${c ? 'justify-center' : 'px-4 gap-2.5'}`}>
        <a href="#/" onClick={nav} className="flex items-center gap-2.5 no-underline min-w-0" aria-label="Inicio">
          <BrandLogo compact={c} />
        </a>
        {mobileOpen && <button type="button" onClick={onCloseMobile} aria-label="Cerrar menú" className="ml-auto kebab"><IX size={16} /></button>}
      </div>

      <nav className={`flex-1 py-2 ${c ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden'}`} aria-label="Navegación principal">
        <Section label="Monitoreo" collapsed={c} />
        <NavItem href="#/" icon={<IGrid size={17} />} label="Resumen" active={route.view === 'fleet'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/ejecutiva" icon={<IChart3D size={17} />} label="Vista ejecutiva" active={route.view === 'dashboards'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/alertas" icon={<IAlert size={17} />} label="Alertas" active={route.view === 'alertas'} collapsed={c} onNavigate={nav}
          badge={<Num n={model.crit || model.warn} tone={model.crit ? 'crit' : 'warn'} collapsed={c} />} />
        <NavItem href="#/soc" icon={<IShield size={17} />} label="Centro de seguridad" active={route.view === 'soc'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/seguridad" icon={<IShield size={17} />} label="Seguridad" active={route.view === 'seguridad'} collapsed={c} onNavigate={nav}
          badge={<Num n={model.secIssues} tone="crit" collapsed={c} />} />
        <NavItem href="#/sitios" icon={<IGlobe size={17} />} label="Sitios y SSL" active={route.view === 'sitios' || route.view === 'sitio'} collapsed={c} onNavigate={nav}
          badge={<Num n={model.webDown} tone="crit" collapsed={c} />} />
        <NavItem href="#/red" icon={<INetwork size={17} />} label="Red y agencias" active={route.view === 'red'} collapsed={c} onNavigate={nav}
          badge={<Num n={netDown} tone="crit" collapsed={c} />} />
        <NavItem href="#/fortigate" icon={<IShield size={17} />} label="FortiGate" active={route.view === 'fortigate'} collapsed={c} onNavigate={nav} />

        <Section label="Infraestructura" collapsed={c} />
        {c ? (
          <NavItem href={hosts[0] ? `#/s/${encodeURIComponent(hosts[0].s.inst)}` : '#/'} icon={<IServer size={17} />} label={`Hosts (${hosts.length})`} active={route.view === 'host'} collapsed
            badge={<Num n={model.count('bad')} tone="crit" collapsed />} />
        ) : (
          <>
            <button type="button" onClick={() => setHostsOpen((o) => !o)} aria-expanded={hostsOpen}
              className="flex items-center gap-3 h-9 px-3 mx-2.5 w-[calc(100%-20px)] rounded-lg text-muted hover:bg-surface hover:text-ink">
              <IServer size={17} /><span className="flex-1 text-left font-medium text-[13px]">Hosts</span>
              <span className="font-mono text-[11px] text-faint">{model.online}/{hosts.length}</span>
              <IChevron size={14} className={`transition-transform ${hostsOpen ? 'rotate-90' : ''}`} />
            </button>
            {hostsOpen && (
              <ul className="m-0 p-0 list-none mt-0.5 mb-1">
                {hosts.map((r) => {
                  const active = route.view === 'host' && route.host === r.s.inst;
                  return (
                    <li key={r.s.inst}>
                      <a href={`#/s/${encodeURIComponent(r.s.inst)}`} onClick={nav} aria-current={active ? 'page' : undefined} title={r.s.inst}
                        className={`flex items-center gap-2.5 h-8 pl-9 pr-3 mx-2.5 rounded-md no-underline font-mono text-[12px] ${active ? 'bg-info/[.12] text-ink' : 'text-ink2/80 hover:bg-surface hover:text-ink'}`}>
                        <Pulse tone={pulseTone(r)} />
                        <span className="truncate flex-1">{r.s.inst}</span>
                        {!r.muted && r.a.A.length > 0 && <span className={`text-[10.5px] ${r.a.level === 'bad' ? 'text-crit' : 'text-warn'}`}>{r.a.A.length}</span>}
                      </a>
                    </li>
                  );
                })}
                {!hosts.length && <li className="pl-9 pr-3 py-1.5 text-faint text-xs">Sin hosts</li>}
              </ul>
            )}
          </>
        )}

        <NavItem href="#/nube" icon={<ICloud size={17} />} label="Costos AWS y S3" active={route.view === 'nube'} collapsed={c} onNavigate={nav} />

        <Section label="Observabilidad" collapsed={c} />
        <NavItem href="#/logs" icon={<ILogs size={17} />} label="Logs" active={route.view === 'logs'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/bd" icon={<IDatabase size={17} />} label="Bases de datos" active={route.view === 'bd'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/explorar" icon={<ICompass size={17} />} label="Explorar" active={route.view === 'explorar'} collapsed={c} onNavigate={nav} />

        <Section label="Operación" collapsed={c} />
        <NavItem href="#/incidentes" icon={<IFlame size={17} />} label="Incidentes" active={route.view === 'incidentes'} collapsed={c} onNavigate={nav}
          badge={<Num n={openIncidents} tone="crit" collapsed={c} />} />
        <NavItem href="#/reportes" icon={<IReport size={17} />} label="Reportes SLA" active={route.view === 'reportes'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/3d" icon={<ICube size={17} />} label="Centro de mando 3D" active={route.view === '3d'} collapsed={c} onNavigate={nav} />
        <NavItem href="#/estado" icon={<IMonitor size={17} />} label="Estado de servicios" active={route.view === 'estado'} collapsed={c} onNavigate={nav} />

        <Section label="Administración" collapsed={c} />
        {canEdit && <NavItem href="#/auditoria" icon={<IHistory size={17} />} label="Auditoría" active={route.view === 'auditoria'} collapsed={c} onNavigate={nav} />}
        <NavItem href="#/config" icon={<ISliders size={17} />} label="Configuración" active={route.view === 'config'} collapsed={c} onNavigate={nav} />
      </nav>

      <div className="border-t border-line shrink-0 p-2.5">
        {!c ? (
          <div className="px-2 py-1.5 text-[11.5px] space-y-1.5">
            
            <div className="flex items-center gap-2"><Pulse tone={health ? 'ok' : 'crit'} /><span className="text-muted">API</span><span className="ml-auto font-mono text-faint">{health ? 'en línea' : 'sin conexión'}</span></div>
            <div className="flex items-center gap-2"><Pulse tone={DEMO ? 'off' : promOk ? 'ok' : 'crit'} /><span className="text-muted">Prometheus</span><span className="ml-auto font-mono text-faint">{DEMO ? 'modo demo' : promOk ? 'conectado' : 'sin conexión'}</span></div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-1" title={`API ${health ? 'en línea' : 'sin conexión'} · Prometheus ${DEMO ? 'demo' : promOk ? 'conectado' : 'sin conexión'}`}>
            <Pulse tone={health ? 'ok' : 'crit'} /><Pulse tone={DEMO ? 'off' : promOk ? 'ok' : 'crit'} />
          </div>
        )}
        {!mobileOpen && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'} title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            className={`mt-1.5 flex items-center gap-2.5 h-8 rounded-md text-faint hover:text-ink hover:bg-surface w-full ${c ? 'justify-center' : 'px-2'}`}>
            <ICollapse size={16} className={c ? 'rotate-180' : ''} />{!c && <span className="text-xs">Colapsar</span>}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className={`hidden lg:block sticky top-0 h-screen shrink-0 glass-side border-r border-line transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-[264px]'}`}>
        {content}
      </aside>
      {/* Móvil / tablet */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-[rgba(2,6,23,.65)] backdrop-blur-[2px] animate-fade" onClick={onCloseMobile} />
          <aside className="absolute left-0 top-0 bottom-0 w-[280px] bg-bg1 border-r border-line shadow-2xl animate-[slidein_.2s_ease-out]" role="dialog" aria-modal="true" aria-label="Menú">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
