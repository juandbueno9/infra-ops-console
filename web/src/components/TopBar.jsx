import { useEffect, useState } from 'react';
import { DEMO, REFRESH_OPTIONS } from '../config.js';
import { useHostActions } from '../hooks/useHostActions.jsx';
import { goFleet, goHost } from '../hooks/useHashRoute.js';
import { Menu } from './Menu.jsx';
import { Pulse } from './ui.jsx';
import { IAuto, IBell, IChevron, IHistory, IInfo, IMenu, IMoon, IRefresh, IServer, ISettings, ISun, IUndo } from './icons.jsx';
import { THEME_LABEL, useTheme } from '../lib/theme.js';
import { useMe } from '../lib/me.js';

/** Botón de tema: Noche → Día → Automático */
function ThemeButton() {
  const [pref, eff, change] = useTheme();
  const next = { dark: 'light', light: 'auto', auto: 'dark' }[pref];
  const Icon = pref === 'auto' ? IAuto : eff === 'light' ? ISun : IMoon;
  return (
    <button type="button" className="theme-btn" onClick={() => change(next)} aria-label={`Tema: ${THEME_LABEL[pref]}. Cambiar a ${THEME_LABEL[next]}`}
      title={`Tema: ${THEME_LABEL[pref]} · clic para ${THEME_LABEL[next]}`}>
      <Icon key={pref} size={16} className={eff === 'light' && pref !== 'auto' ? 'text-warn' : pref === 'dark' ? 'text-sg' : ''} />
    </button>
  );
}

const TITLES = { fleet: 'Resumen', dashboards: 'Vista ejecutiva', nube: 'Costos AWS y S3', red: 'Red y agencias', '3d': 'Centro de mando 3D', alertas: 'Alertas', seguridad: 'Seguridad', sitios: 'Sitios y SSL', auditoria: 'Auditoría', config: 'Configuración', host: 'Hosts', sitio: 'Sitios y SSL' };

function Clock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return (
    <span className="font-mono text-xs text-ink2 whitespace-nowrap hidden 2xl:inline">
      {new Date(now).toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} COT
    </span>
  );
}

export function TopBar({ route, model, live, onRefresh, onMenu, refreshS, onRefreshS }) {
  const a = useHostActions();
  const hidden = Object.keys(a.shared.hidden);
  const silenced = Object.keys(a.shared.silenced);
  const tag = (r) => (r.muted ? '  · silenciado' : { bad: '  ✖ crítico', warn: '  ▲ atención', ok: '' }[r.a.level]);

  const settings = [
    { header: `Hosts ocultos (${hidden.length})` },
    ...(hidden.length ? hidden.map((h) => ({ label: `Restaurar ${h}`, icon: <IUndo size={15} />, onSelect: () => a.restore(h) })) : [{ label: 'Ninguno', icon: <IInfo size={15} />, disabled: true }]),
    'sep', { header: `Silenciados (${silenced.length})` },
    ...(silenced.length ? silenced.map((h) => ({ label: `Reactivar ${h}`, icon: <IBell size={15} />, onSelect: () => a.unsilence(h) })) : [{ label: 'Ninguno', icon: <IInfo size={15} />, disabled: true }]),
    'sep',
    { label: 'Registro de auditoría', icon: <IHistory size={15} />, onSelect: () => { location.hash = '#/auditoria'; } },
    { label: 'Actualizar ahora', icon: <IRefresh size={15} />, hint: 'R', onSelect: onRefresh },
  ];

  const opts = model.all.map((r) => ({ inst: r.s.inst, label: r.s.inst + tag(r) }));
  if (route.host && !opts.some((o) => o.inst === route.host)) opts.push({ inst: route.host, label: route.host });

  return (
    <header className="topbar sticky top-0 z-30 bg-bg1/90 backdrop-blur-md border-b border-line">
      <div className="h-14 px-4 lg:px-5 flex items-center gap-3">
        <button type="button" onClick={onMenu} aria-label="Menú" title="Menú"
          className="w-9 h-9 -ml-1 rounded-lg grid place-items-center text-muted hover:text-ink hover:bg-surface border border-transparent hover:border-line">
          <IMenu size={18} />
        </button>

        <nav aria-label="Ruta" className="hidden sm:flex items-center gap-1.5 text-[13px] min-w-0">
          <a href="#/" className="text-muted hover:text-ink no-underline">Infra Ops</a>
          <IChevron size={13} className="text-faint" />
          <span className={route.view === 'host' || route.view === 'sitio' ? 'text-muted' : 'text-ink font-medium'}>{TITLES[route.view]}</span>
          {route.view === 'host' && route.host && <><IChevron size={13} className="text-faint" /><span className="text-ink font-mono font-medium truncate">{route.host}</span></>}
          {route.view === 'sitio' && route.site && <><IChevron size={13} className="text-faint" /><span className="text-ink font-mono font-medium truncate">{route.site.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span></>}
        </nav>

        <label className="flex items-center gap-2 bg-bg border border-line rounded-lg pl-2.5 pr-1 h-8 ml-2" title="Ir a un servidor">
          <IServer size={14} className="text-faint" />
          <select aria-label="Servidor" value={route.view === 'host' ? route.host : ''} onChange={(e) => (e.target.value ? goHost(e.target.value) : goFleet())}
            className="bg-transparent text-ink border-0 font-mono text-[12.5px] font-medium h-[30px] w-[150px] sm:w-[230px] cursor-pointer outline-none">
            <option value="" className="bg-bg1">Todos los hosts ({model.all.length})</option>
            {opts.map((o) => <option key={o.inst} value={o.inst} className="bg-bg1">{o.label}</option>)}
          </select>
        </label>
        {DEMO && <span className="text-[10px] font-bold tracking-wider text-[#0b0b18] bg-violet px-1.5 py-0.5 rounded">DEMO</span>}

        <div className="flex-1" />
        <span className="hidden md:inline text-[10.5px] font-semibold tracking-[.08em] text-ok bg-ok/10 border border-ok/30 px-2 py-0.5 rounded-[5px] whitespace-nowrap">PRODUCCIÓN · AWS</span>
        <span className="hidden sm:flex items-center gap-2 text-muted text-xs whitespace-nowrap">
          <Pulse tone={live.error ? 'crit' : !refreshS ? 'off' : 'ok'} />{live.error ? 'Sin conexión' : !refreshS ? 'En pausa' : live.at ? `En vivo · ${new Date(live.at).toLocaleTimeString('es-CO', { hour12: false })}` : 'Conectando…'}
        </span>
        <label className="hidden md:flex items-center gap-1.5 h-8 pl-2.5 pr-1 bg-bg border border-line rounded-lg text-xs text-muted" title="Frecuencia de actualización">
          <IRefresh size={13} className={refreshS ? 'text-faint' : 'text-warn'} />
          <select aria-label="Frecuencia de actualización" value={refreshS} onChange={(e) => onRefreshS(Number(e.target.value))}
            className="bg-transparent border-0 outline-none text-ink2 font-mono text-xs cursor-pointer">
            {REFRESH_OPTIONS.map((v) => <option key={v} value={v} className="bg-bg1">{v ? (v < 60 ? `${v} s` : `${v / 60} min`) : 'Pausado'}</option>)}
          </select>
        </label>
        <Clock />
        <ThemeButton />
        <Menu items={settings} label="Opciones" trigger={<ISettings size={16} />}
          buttonClass="w-8 h-8 rounded-lg grid place-items-center text-muted border border-transparent hover:bg-surface hover:text-ink hover:border-line aria-expanded:bg-surface" />
        <UserChip />
      </div>
    </header>
  );
}

/** Usuario de Keycloak con su rol y botón para cerrar sesión (solo cuando el panel tiene inicio de sesión). */
function UserChip() {
  const me = useMe();
  if (!me?.auth) return null;
  return (
    <div className="flex items-center gap-2 pl-2 ml-1 border-l border-line">
      <span className="w-7 h-7 rounded-full bg-info/20 text-info grid place-items-center text-[12px] font-semibold uppercase" title={me.email || me.user}>{(me.name || me.user || '?').slice(0, 1)}</span>
      <span className="hidden md:block leading-tight"><span className="block text-[12px] text-ink max-w-[140px] truncate">{me.name || me.user}</span><span className="block text-[10px] text-faint">{me.admin ? 'Administrador' : 'Solo visualización'}</span></span>
      <a href="auth/logout" className="h-[28px] px-2.5 rounded-md border border-line text-[11.5px] text-ink2 hover:text-ink hover:bg-surface grid place-items-center no-underline">Salir</a>
    </div>
  );
}
