// Azure por su API (solo lectura): máquinas virtuales con CPU/memoria/red de Azure Monitor y estado de las VPN.
// No necesita instalar nada en las máquinas.
import { useEffect, useState } from 'react';
import { DEMO } from '../config.js';
import { Sparkline } from './charts.jsx';
import { EditName } from './EditName.jsx';
import { Badge, Meter, Panel, Pulse } from './ui.jsx';

const GB = (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`);
const POWER = { running: ['En ejecución', 'ok'], deallocated: ['Apagada (sin costo)', 'off'], stopped: ['Detenida (con costo)', 'warn'], starting: ['Encendiendo', 'warn'], stopping: ['Apagando', 'warn'], deallocating: ['Liberando', 'warn'], unknown: ['Desconocido', 'off'] };
export const azKey = (vm) => `az:${vm.name}`;
export const vmTone = (vm) => (vm.power !== 'running' ? (vm.power === 'deallocated' ? 'off' : 'warn') : vm.cpu >= 90 || vm.mem >= 95 ? 'crit' : vm.cpu >= 80 || vm.mem >= 90 ? 'warn' : 'ok');

async function load() {
  if (DEMO) return { configured: true, demo: true, at: Date.now(), vms: [
    { id: 'd1', name: 'active-directory', rg: 'GR-INFRAESTRUCTURA-INFRA OPS', location: 'eastus2', size: 'Standard_B2ms', os: 'Windows', vcpu: 2, memMB: 8192, power: 'running', cpu: 6.2, cpuSeries: [5, 6, 7, 6, 5, 8, 6, 6, 7, 5, 6, 6], mem: 61, netIn: 3.2e8, netOut: 1.1e8 },
    { id: 'd2', name: 'applications', rg: 'GR-INFRAESTRUCTURA-INFRA OPS', location: 'eastus2', size: 'Standard_D4s_v5', os: 'Windows', vcpu: 4, memMB: 16384, power: 'running', cpu: 23, cpuSeries: [18, 22, 25, 30, 21, 19, 24, 23, 26, 22, 20, 23], mem: 72, netIn: 1.9e9, netOut: 2.4e9 },
  ], vpns: [{ name: 'vpn-ipsec-bogota', status: 'Connected', protocol: 'IKEv2' }, { name: 'vpn-ipsec-aws', status: 'Connected', protocol: 'IKEv2' }], errors: [] };
  const r = await fetch('api/azure', { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

export function useAzure(everyS = 60) {
  const [st, setSt] = useState({ data: null, error: null });
  useEffect(() => {
    let a = true;
    const go = () => load().then((d) => a && setSt({ data: d, error: null })).catch((e) => a && setSt((s) => ({ ...s, error: e.message })));
    go(); const t = setInterval(go, everyS * 1000);
    return () => { a = false; clearInterval(t); };
  }, [everyS]);
  return st;
}

/** Elementos para las vistas 3D (gabinetes y rack). */
export function azureItems(data, alias = () => null) {
  return (data?.vms || []).map((vm) => ({
    id: azKey(vm), aliasKey: azKey(vm), kind: 'azure', label: alias(azKey(vm)) || vm.name, origLabel: vm.name, tone: vmTone(vm),
    sub: vm.size?.replace('Standard_', ''), os: vm.os, values: vm.power === 'running' ? { cpu: vm.cpu, mem: vm.mem, disk: null } : {},
    note: vm.power !== 'running' ? (POWER[vm.power] || POWER.unknown)[0] : `Azure · ${vm.os || ''}`,
    onClick: () => document.getElementById('azure')?.scrollIntoView({ behavior: 'smooth' }),
  }));
}

function Setup() {
  return (
    <div className="p-4 text-[12.5px] text-ink2 grid md:grid-cols-2 gap-5">
      <div>
        <div className="text-ink font-semibold mb-2">1 · En Azure Cloud Shell (Bash)</div>
        <p className="mb-2">Crea una aplicación de <b>solo lectura</b> (rol Lector) para el panel. Cambia el ID por el de tu suscripción:</p>
        <pre className="bg-bg1 border border-line rounded-lg p-3 font-mono text-[11.5px] whitespace-pre-wrap">az ad sp create-for-rbac --name infra-ops-console-lectura --role Reader --scopes /subscriptions/ID_DE_LA_SUSCRIPCION</pre>
        <p className="text-faint text-[11.5px] mt-2">Muestra appId, password y tenant. <b className="text-warn">No los pegues en chats ni correos.</b></p>
      </div>
      <div>
        <div className="text-ink font-semibold mb-2">2 · En el panel (server/.env)</div>
        <pre className="bg-bg1 border border-line rounded-lg p-3 font-mono text-[11.5px] whitespace-pre-wrap">{`AZURE_TENANT_ID=<tenant>
AZURE_CLIENT_ID=<appId>
AZURE_CLIENT_SECRET=<password>`}</pre>
        <p className="text-faint text-[11.5px] mt-2">Reinicia el panel. Solo lee: no puede encender, apagar ni cambiar nada en Azure.</p>
      </div>
    </div>
  );
}

export function AzurePanel({ st }) {
  const d = st?.data;
  if (!d) return null;
  const vms = d.vms || [];
  return (
    <section id="azure" className="mb-4">
      <Panel title="Azure" meta={d.configured ? `${vms.length} máquina(s) · ${(d.vpns || []).length} VPN · API de solo lectura${d.demo ? ' · demostración' : ''}` : 'sin configurar'} bodyClass="overflow-x-auto">
        {!d.configured ? <Setup /> : (<>
          <table className="tbl">
            <thead><tr><th>Máquina</th><th>Estado</th><th>Tamaño</th><th>CPU</th><th>Memoria</th><th>CPU · 1 h</th><th className="num">Red 1 h (entra / sale)</th></tr></thead>
            <tbody>{vms.map((vm) => { const p = POWER[vm.power] || POWER.unknown; return (
              <tr key={vm.id}>
                <td><div className="flex items-center gap-2"><Pulse tone={vmTone(vm)} /><div><div className="font-mono text-ink text-[12.5px]"><EditName k={azKey(vm)} orig={vm.name} /></div><div className="text-[10.5px] text-faint font-mono">{vm.os} · {vm.location} · {vm.rg}</div></div></div></td>
                <td><Badge tone={p[1]}>{p[0]}</Badge></td>
                <td className="font-mono text-[11.5px]">{vm.size?.replace('Standard_', '')}<div className="text-faint text-[10.5px]">{vm.vcpu ? `${vm.vcpu} vCPU` : ''}{vm.memMB ? ` · ${Math.round(vm.memMB / 1024)} GB` : ''}</div></td>
                <td className="w-36"><Meter value={vm.cpu} /></td>
                <td className="w-36"><Meter value={vm.mem} base="#A3E635" /></td>
                <td><Sparkline values={vm.cpuSeries} /></td>
                <td className="num text-[11.5px]">{GB(vm.netIn)} / {GB(vm.netOut)}</td>
              </tr>); })}</tbody>
          </table>
          {(d.vpns || []).length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line text-[12px]">
              <span className="text-faint">VPN de Azure:</span>
              {d.vpns.map((v) => <Badge key={v.name} tone={v.status === 'Connected' ? 'ok' : 'crit'}>{v.name} · {v.status === 'Connected' ? 'Conectada' : v.status}{v.custom ? '' : ' · cifrado por defecto'}</Badge>)}
            </div>
          )}
          {d.errors?.length > 0 && <div className="px-4 py-2 text-[11.5px] text-warn border-t border-line">{d.errors.slice(0, 3).join(' · ')}</div>}
          <div className="px-4 py-2 text-[11px] text-faint border-t border-line">Datos de Azure Monitor (cada 5 min). Para ver servicios de Windows (Active Directory, DNS…) y espacio del disco C: hace falta además el agente windows_exporter.</div>
        </>)}
        {st.error && <div className="text-warn text-[12px] px-4 py-2">No se pudo consultar Azure: {st.error}</div>}
      </Panel>
    </section>
  );
}
