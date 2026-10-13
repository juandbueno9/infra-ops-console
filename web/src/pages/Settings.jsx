import { DEMO, KNOWN_IPS, NODE_JOBS, PORT_POLICY, PORT_POLICY_BY_SERVER, SSL_BAD_DAYS, SSL_WARN_DAYS } from '../config.js';
import { PageHead } from '../components/tables.jsx';
import { NotifySettings } from '../components/NotifySettings.jsx';
import { SecurityControls } from '../components/SecurityControls.jsx';
import { Badge, Kv, Panel, Pulse } from '../components/ui.jsx';

const LBL = { allowed: ['Permitido', 'ok'], office: ['Solo oficina', 'warn'], sg: ['Cerrado en SG', 'sg'], critical: ['Crítico', 'crit'] };
const PolicyTable = ({ policy }) => (
  <div className="flex flex-wrap gap-1.5">
    {Object.entries(policy).sort((a, b) => a[0] - b[0]).map(([port, k]) => (
      <span key={port} className="inline-flex items-center gap-1.5 bg-surface2 border border-line rounded-md pl-2 pr-1 py-0.5">
        <span className="font-mono text-xs text-ink">{port}</span><Badge tone={LBL[k][1]}>{LBL[k][0]}</Badge>
      </span>
    ))}
  </div>
);

export function Settings({ health, refreshS }) {
  return (
    <>
      <PageHead title="Configuración" sub="Valores activos del panel. Se editan en web/src/config.js y server/.env" />
      <div className="grid grid-cols-12 gap-4">
        <NotifySettings />
        <SecurityControls />
        <Panel title="Conexión" className="col-span-12 lg:col-span-5" bodyClass="p-4">
          <div className="space-y-2.5 mb-4 text-[13px]">
            <div className="flex items-center gap-2.5"><Pulse tone={health ? 'ok' : 'crit'} /><span className="text-ink2">Backend (API)</span><span className="ml-auto font-mono text-xs text-muted">{health ? 'en línea' : 'sin conexión'}</span></div>
            <div className="flex items-center gap-2.5"><Pulse tone={DEMO ? 'off' : health?.prometheus ? 'ok' : 'crit'} /><span className="text-ink2">Prometheus</span><span className="ml-auto font-mono text-xs text-muted">{DEMO ? 'modo demo' : health?.prometheus ? 'conectado' : 'sin conexión'}</span></div>
          </div>
          <Kv rows={[['URL de Prometheus', health?.promUrl], ['Modo', DEMO ? 'Demo (datos simulados)' : 'Datos reales'], ['Actualización', refreshS ? `cada ${refreshS} s` : 'en pausa'], ['Jobs de node_exporter', NODE_JOBS]]} />
          {!DEMO && !health?.prometheus && (
            <div className="mt-4 bg-warn/[.07] border border-warn/25 rounded-lg p-3 text-xs text-ink2">
              ¿Sin conexión? Abre el túnel en otra terminal: <span className="font-mono text-ink">npm run tunnel</span>
            </div>
          )}
        </Panel>
        <Panel title="Umbrales y confianza" className="col-span-12 lg:col-span-7" bodyClass="p-4">
          <Kv rows={[
            ['CPU / memoria / disco', 'Atención ≥ 75 % · crítico ≥ 90 % (barras); alerta de disco ≥ 85 %'],
            ['Carga', 'Atención cuando la carga de 5 min ≥ número de vCPU'],
            ['SSH fallidos (24 h)', 'Atención ≥ 10 · crítico ≥ 50'],
            ['Certificados SSL', `Atención ≤ ${SSL_WARN_DAYS} días · crítico ≤ ${SSL_BAD_DAYS} días`],
            ['IPs de confianza', Object.entries(KNOWN_IPS).map(([ip, n]) => `${ip} (${n})`).join(', ')],
          ]} />
        </Panel>
        <Panel title="Política de puertos públicos" className="col-span-12" bodyClass="p-4 space-y-4">
          <div><div className="text-xs text-muted mb-2 font-medium">Global (todos los hosts)</div><PolicyTable policy={PORT_POLICY} /></div>
          {Object.entries(PORT_POLICY_BY_SERVER).map(([host, p]) => (
            <div key={host}><div className="text-xs text-muted mb-2 font-medium">Específica de <span className="font-mono text-ink">{host}</span></div><PolicyTable policy={p} /></div>
          ))}
          <p className="m-0 text-xs text-faint">Los puertos públicos que no aparecen aquí se marcan como «Revisar».</p>
        </Panel>
      </div>
    </>
  );
}
