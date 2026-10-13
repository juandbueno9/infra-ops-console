import { PORT_POLICY, PORT_POLICY_BY_SERVER, PORT_NAMES, KNOWN_IPS } from '../config.js';
import { pct } from './format.js';

// Reglas definidas desde el panel (estado compartido): tienen prioridad sobre config.js
let overrides = {};
export const setPortOverrides = (o) => { overrides = o || {}; };
export const portRule = (inst, port) => overrides[inst]?.[port] || null;
export const policy = (inst, port) => portRule(inst, port)?.cls || ((PORT_POLICY_BY_SERVER[inst] || {})[port] ?? PORT_POLICY[port]);
export const classify = (inst, p) => (p.scope !== 'public' ? 'internal' : policy(inst, p.port) || 'review');

const isPrivIP = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip || '');

/** Devuelve [etiqueta, tono] para una IP de origen. */
export const ipKind = (ip) =>
  !ip || ip === 'local' || ip.startsWith(':') ? ['Consola local', 'info']
    : KNOWN_IPS[ip] ? [KNOWN_IPS[ip], 'ok']
      : isPrivIP(ip) ? ['Red privada', 'info']
        : ['IP desconocida', 'crit'];

/**
 * Evalúa un host y devuelve sus alertas.
 * A: lista de [severidad, texto] con severidad 'bad' | 'warn'
 */
export function analyze(s) {
  const A = [];
  const add = (k, t) => A.push([k, t]);
  const cls = { allowed: [], office: [], sg: [], critical: [], review: [], internal: [] };
  (s.ports || []).forEach((p) => cls[classify(s.inst, p)].push(p));
  const sshBad = !!(s.sshcfg && (s.sshcfg.password_auth === 'yes' || s.sshcfg.root_login === 'yes'));

  if (s.up !== 1) {
    add('bad', 'Servidor sin respuesta: el agente de monitoreo no contesta');
    return { A, level: 'bad', cls, sshBad };
  }
  (s.svcDown || []).forEach((n) => add('bad', `Servicio ${n} caído`));
  (s.ctrBad || []).forEach((n) => add('bad', `Contenedor ${n} con problemas (unhealthy/reiniciando)`));
  cls.critical.forEach((p) => add('bad', `Puerto ${p.port} (${p.app || PORT_NAMES[p.port] || '?'}) expuesto a todas las IPs`));
  if (sshBad) add('bad', 'SSH permite contraseña o acceso root');
  if (s.fsP >= 90) add('bad', `Disco / al ${pct(s.fsP)}`); else if (s.fsP >= 85) add('warn', `Disco / al ${pct(s.fsP)}`);
  if (s.memP >= 95) add('bad', `Memoria al ${pct(s.memP)}`); else if (s.memP >= 90) add('warn', `Memoria al ${pct(s.memP)}`);
  if (s.cpus && s.load && s.load[1] >= s.cpus) add('warn', `Carga alta: ${s.load[1].toFixed(2)} con ${s.cpus} vCPU`);
  if (s.sec > 0) add('warn', `${s.sec} actualización(es) de seguridad pendiente(s)`);
  if (s.reboot === 1) add('warn', 'Reinicio pendiente tras actualizaciones');
  if (s.ssh >= 50) add('bad', `${s.ssh} intentos SSH fallidos en 24 h`); else if (s.ssh >= 10) add('warn', `${s.ssh} intentos SSH fallidos en 24 h`);
  if (cls.review.length) add('warn', `${cls.review.length} puerto(s) público(s) sin clasificar: ${cls.review.map((p) => p.port).join(', ')}`);
  if (s.diskDays != null && s.diskDays < 7) add(s.diskDays < 2 ? 'bad' : 'warn', `Al ritmo actual el disco / se llena en ~${s.diskDays < 2 ? Math.round(s.diskDays * 24) + ' h' : Math.round(s.diskDays) + ' días'}`);
  (s.sessions || []).filter((x) => ipKind(x.from)[1] === 'crit').forEach((x) => add('bad', `Sesión activa de ${x.user} desde IP desconocida ${x.from}`));
  (s.logins || []).filter((x) => ipKind(x.from)[1] === 'crit').forEach((x) => add('warn', `Acceso SSH de ${x.user} desde IP desconocida ${x.from} (${x.count} en 24 h)`));
  (s.logins || []).filter((x) => x.key === 'llave desconocida').forEach((x) => add('warn', `Acceso SSH de ${x.user} con una llave no registrada desde ${x.from}`));
  (s.logins || []).filter((x) => x.method === 'password').forEach((x) => add('warn', `${x.user} entró por SSH con contraseña desde ${x.from}`));
  if (s.tfage != null && s.tfage > 300) add('warn', 'Métricas infra desactualizadas (revisa el cron del agente)');

  const level = A.some((a) => a[0] === 'bad') ? 'bad' : A.length ? 'warn' : 'ok';
  return { A, level, cls, sshBad };
}

export const LEVEL = {
  ok: { label: 'Saludable', tone: 'ok' },
  warn: { label: 'Atención', tone: 'warn' },
  bad: { label: 'Crítico', tone: 'crit' },
};
