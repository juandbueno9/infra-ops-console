import { useEffect, useState } from 'react';

// Rutas:
//   #/            Resumen de infraestructura
//   #/alertas     Alertas de toda la flota
//   #/seguridad   Postura de seguridad (puertos, SSH, sesiones, parches)
//   #/sitios      Sitios web y certificados SSL
//   #/red         Red SD-WAN y agencias
//   #/fortigate   FortiGate de la sede (API de solo lectura)
//   #/logs #/bd #/explorar          Observabilidad (logs, bases de datos, PromQL)
//   #/incidentes #/reportes #/estado  Operación (incidentes, SLA, tablero de estado)
//   #/auditoria[/acciones|accesos|ssh][?host=x]   Auditoría (acciones del panel, ingresos, accesos SSH)
//   #/config      Configuración y estado de la conexión
//   #/s/<host>    Detalle de un host
//   #/sitio/<url> Detalle de un sitio web
export const PAGES = ['soc', 'dashboards', 'nube', 'fortigate', 'alertas', 'seguridad', 'sitios', 'red', 'logs', 'bd', 'explorar', 'incidentes', 'reportes', 'estado', '3d', 'auditoria', 'config'];

const parse = () => {
  const h = location.hash;
  const m = h.match(/^#\/s\/(.*)$/);
  if (m) return { view: 'host', host: decodeURIComponent(m[1]) };
  const w = h.match(/^#\/sitio\/(.*)$/);
  if (w) return { view: 'sitio', host: null, site: decodeURIComponent(w[1]) };
  const [path, qs = ''] = h.replace(/^#\/?/, '').split('?');
  const [p0, tab] = path.split('/');
  const p = p0 === 'ejecutiva' ? 'dashboards' : p0; // #/ejecutiva (nombre visible) = vista interna 'dashboards'
  return { view: PAGES.includes(p) ? p : 'fleet', host: null, tab: tab || null, params: Object.fromEntries(new URLSearchParams(qs)) };
};

export function useHashRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const goFleet = () => { location.hash = '#/'; };
export const goHost = (h) => { location.hash = '#/s/' + encodeURIComponent(h); };
export const goSite = (t) => { location.hash = '#/sitio/' + encodeURIComponent(t); };
export const go = (page) => { location.hash = page === 'fleet' ? '#/' : `#/${page}`; };
