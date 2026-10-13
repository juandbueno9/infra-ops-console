// Centro de seguridad (SOC): une TODOS los hallazgos reales del panel en un solo modelo
//   Evento → Hallazgo (con severidad y acción recomendada) → Incidente
// y calcula el Puntaje de seguridad (0–100) y el riesgo de cada equipo.
// Fuentes: agentes de los servidores (Prometheus), escaneos (Loki), reglas de alerta, sitios web, NAS Synology,
// Azure, FortiGate (VPN, SD-WAN, Wi-Fi, equipos nuevos, aplicaciones y amenazas) y dominios falsos.

export const SEV = { crit: ['Crítico', 'crit', 0], warn: ['Alto', 'warn', 1], info: ['Medio', 'off', 2] };
const W = { crit: 6, warn: 2, info: 0.5 }; // puntos que resta cada hallazgo
const CAP = 25; // máximo que puede restar una sola categoría

export const CATS = {
  exposicion: 'Exposición a Internet', acceso: 'Acceso y autenticación', parches: 'Parches y vulnerabilidades', ataques: 'Escaneos y ataques',
  disponibilidad: 'Disponibilidad', hardware: 'Hardware y almacenamiento', red: 'Red y VPN', usuarios: 'Navegación y equipos', marca: 'Suplantación de marca',
};

// Acciones recomendadas (playbooks cortos) según el tipo de hallazgo
const PLAY = [
  [/puerto .*expuesto|expuesto a todas/i, 'Cerrar el puerto en el Security Group de AWS (o limitarlo a la IP de la oficina) y verificar que el servicio no necesite estar público.'],
  [/ssh.*(inseguro|contraseña|root)/i, 'En /etc/ssh/sshd_config: PasswordAuthentication no y PermitRootLogin no; reiniciar sshd. Usar solo llaves.'],
  [/sesi[oó]n.*desconocida|ip desconocida/i, 'Verificar con el equipo quién está conectado; si nadie la reconoce, cerrar la sesión (pkill -u usuario), cambiar contraseñas y llaves y revisar /var/log/auth.log.'],
  [/fuerza bruta|ssh fallid/i, 'Bloquear la IP en el Security Group / FortiGate, confirmar que ningún intento fue exitoso (Accepted en auth.log) y activar fail2ban.'],
  [/escaneo|rutas peligrosas/i, 'Bloquear la IP de origen en el FortiGate o WAF. Si alguna ruta respondió 200, revisar ese archivo o URL de inmediato.'],
  [/parche|seguridad pendiente|actualizaci/i, 'Programar ventana de mantenimiento: sudo apt update && sudo apt upgrade (y reiniciar si lo pide).'],
  [/reinicio pendiente/i, 'Reiniciar el servidor en horario de baja carga para aplicar el kernel o librerías actualizadas.'],
  [/disco.*(lleno|%)|espacio/i, 'Liberar espacio (logs, backups viejos, docker system prune) o ampliar el volumen EBS.'],
  [/sin respuesta|ca[ií]do|no responde/i, 'Revisar si el equipo está encendido y con red; en AWS ver el estado de la instancia y los checks.'],
  [/sectores dañados|fallando|cambiar el disco|salud/i, 'Respaldar los datos de ese volumen y reemplazar el disco (cambio en caliente en Synology: Administrador de almacenamiento → Reparar).'],
  [/ventilador|fuente/i, 'Revisar el hardware: limpiar polvo o reemplazar la pieza; vigilar la temperatura mientras tanto.'],
  [/temperatura/i, 'Mejorar la ventilación del cuarto o rack y revisar los ventiladores del equipo.'],
  [/volumen|capacidad/i, 'Depurar archivos o ampliar el almacenamiento antes de que se llene.'],
  [/certificado|ssl/i, 'Renovar el certificado (certbot renew o con el proveedor) antes de la fecha de vencimiento.'],
  [/túnel|tunel|vpn/i, 'Revisar el túnel en el FortiGate (VPN → IPsec Tunnels) y en el otro extremo; confirmar el Internet de esa sede.'],
  [/sd-wan|sin enlace/i, 'Revisar el Internet de la agencia (llamar al proveedor de esa sede) y el equipo FortiGate local.'],
  [/access point|wi-fi/i, 'Revisar energía (PoE) y cable del access point; reiniciarlo desde el FortiGate (WiFi & Switch Controller).'],
  [/equipo nuevo/i, 'Confirmar que el equipo es de la empresa (por MAC, nombre o fabricante). Si nadie lo reconoce, bloquear la MAC en el FortiGate.'],
  [/acceso remoto|anydesk|teamviewer/i, 'Confirmar que el uso de acceso remoto está autorizado; si no, bloquear la aplicación en Application Control.'],
  [/pa[ií]s|conexi[oó]n saliente/i, 'Revisar qué proceso del equipo genera esa conexión; si no es legítimo, aislar el equipo y pasar antivirus.'],
  [/amenaza|ips|antivirus|virus/i, 'Aislar el equipo de origen, pasar antivirus completo y revisar si el FortiGate bloqueó la amenaza.'],
  [/clon|phishing|suplant|dominio/i, 'Reportar el dominio al registrador (abuse), a Google Safe Browsing y al ColCERT; avisar a los asociados.'],
  [/apagad|detenid/i, 'Confirmar si la máquina debe estar apagada; si no, encenderla y revisar por qué se detuvo.'],
];
export const actionFor = (text) => (PLAY.find(([re]) => re.test(text))?.[1]) || 'Revisar el detalle y documentar la causa en un incidente.';

const REMOTE = /anydesk|teamviewer|rustdesk|ultraviewer|splashtop|logmein|vnc|remote.?desktop|chrome.?remote/i;
const RISKY = /torrent|bittorrent|tor\b|proxy|vpn|psiphon|ultrasurf/i;
const BAD_COUNTRIES = /russia|china|north korea|iran|belarus|nigeria|vietnam|romania|ukraine|indonesia|brazil|india|pakistan/i;

/** Construye la lista de hallazgos a partir de todas las fuentes cargadas. */
export function buildFindings(src) {
  const F = [];
  const add = (f) => F.push({ ts: null, ...f, id: `${f.cat}|${f.asset}|${f.title}`, action: f.action || actionFor(`${f.title} ${f.detail || ''}`) });
  // 1) Servidores (agente + análisis existente)
  for (const r of src.model?.all || []) {
    const name = r.s.host || r.s.inst;
    for (const [k, t] of r.a?.A || []) {
      const cat = /puerto/i.test(t) ? 'exposicion' : /ssh|sesi/i.test(t) ? 'acceso' : /disco|memoria|cpu|carga/i.test(t) ? 'disponibilidad' : /parche|actualiz|reinicio/i.test(t) ? 'parches' : /sin respuesta/i.test(t) ? 'disponibilidad' : 'disponibilidad';
      add({ sev: k === 'bad' ? 'crit' : 'warn', cat, asset: name, assetKind: 'servidor', href: `#/s/${encodeURIComponent(r.s.inst)}`, title: t, source: 'Agente del servidor' });
    }
    if (r.s.sec > 0) add({ sev: r.s.sec >= 20 ? 'warn' : 'info', cat: 'parches', asset: name, assetKind: 'servidor', href: `#/s/${encodeURIComponent(r.s.inst)}`, title: `${r.s.sec} parche(s) de seguridad pendientes`, detail: (r.s.pkgs || []).filter((p) => p.security).slice(0, 8).map((p) => p.name).join(', '), source: 'Agente del servidor' });
    if (r.s.reboot === 1) add({ sev: 'info', cat: 'parches', asset: name, assetKind: 'servidor', href: `#/s/${encodeURIComponent(r.s.inst)}`, title: 'Reinicio pendiente para aplicar actualizaciones', source: 'Agente del servidor' });
  }
  // 2) Escaneos y fuerza bruta (Loki)
  for (const sc of src.scans?.scanners || []) {
    if (sc.sev === 'info') continue;
    add({ sev: sc.sev, cat: 'ataques', asset: (sc.servers || [])[0] || 'servidores', assetKind: 'servidor', title: `${sc.kinds.join(' + ')} desde ${sc.ip}`, detail: `${sc.ssh ? `${sc.ssh} intentos SSH · ` : ''}${sc.hits.length} rutas peligrosas${sc.ok200 ? ` · ${sc.ok200} respondieron 200` : ''}`, source: 'Registros (Loki)', ts: (sc.last || Date.now() / 1000) * 1000, href: '#/seguridad' });
  }
  // 3) Reglas de alerta de Prometheus (agrupadas por regla)
  const groups = {};
  for (const a of src.alerts || []) { if (a.state !== 'firing' || a.labels.alertname === 'Watchdog') continue; (groups[a.labels.alertname] ||= []).push(a); }
  for (const [name, list] of Object.entries(groups)) {
    const a = list[0], crit = list.some((x) => x.labels.severidad === 'critica');
    add({ sev: crit ? 'crit' : 'warn', cat: /sitio|ssl|cert/i.test(name) ? 'disponibilidad' : /disco|memoria|cpu/i.test(name) ? 'disponibilidad' : /puerto|ssh/i.test(name) ? 'exposicion' : 'disponibilidad', asset: list.length > 1 ? `${list.length} afectados` : String(a.labels.instance || a.labels.nombre || a.labels.job || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), assetKind: 'regla', title: list.length > 1 ? `${name} (${list.length})` : a.annotations?.resumen || name, detail: list.slice(0, 5).map((x) => String(x.labels.instance || '').replace(/^https?:\/\//, '')).join(', '), source: 'Reglas de alerta', ts: Date.parse(a.activeAt) || Date.now(), href: '#/alertas' });
  }
  // 4) Sitios web y certificados
  for (const w of src.web || []) {
    const site = w.target.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!w.ok) add({ sev: 'crit', cat: 'disponibilidad', asset: site, assetKind: 'sitio', title: `Sitio caído${w.code ? ` (HTTP ${w.code})` : ''}`, source: 'Sondas Blackbox', href: `#/sitio/${encodeURIComponent(w.target)}` });
    const d = w.ssl != null ? Math.floor(w.ssl / 86400) : null;
    if (d != null && d < 21) add({ sev: d < 7 ? 'crit' : 'warn', cat: 'disponibilidad', asset: site, assetKind: 'sitio', title: `Certificado SSL vence en ${d} días`, source: 'Sondas Blackbox', href: `#/sitio/${encodeURIComponent(w.target)}` });
  }
  // 5) NAS Synology
  for (const n of src.nas?.nas || []) {
    if (!n.ok) { add({ sev: 'crit', cat: 'hardware', asset: n.name, assetKind: 'nas', title: 'NAS sin respuesta', detail: n.error, source: 'SNMP Synology', href: '#/' }); continue; }
    for (const i of n.issues || []) { if (/(pool|grupo).*capacidad/i.test(i.msg) || i.sev === 'info') continue; add({ sev: i.sev, cat: 'hardware', asset: n.name, assetKind: 'nas', title: i.msg, source: 'SNMP Synology', href: '#/' }); }
  }
  // 6) Azure
  for (const vm of src.azure?.vms || []) if (vm.power !== 'running' && vm.power !== 'deallocated') add({ sev: 'warn', cat: 'disponibilidad', asset: vm.name, assetKind: 'azure', title: `Máquina de Azure ${vm.power === 'stopped' ? 'detenida (sigue cobrando)' : vm.power}`, source: 'Azure', href: '#/' });
  for (const v of src.azure?.vpns || []) {
    if (v.status !== 'Connected') add({ sev: 'crit', cat: 'red', asset: v.name, assetKind: 'vpn', title: `VPN de Azure ${v.status}`, source: 'Azure' });
    else if (!v.custom) add({ sev: 'info', cat: 'red', asset: v.name, assetKind: 'vpn', title: 'VPN con cifrado por defecto (acepta algoritmos débiles)', source: 'Azure', action: 'Definir una política IPsec propia (IKEv2, AES256, SHA256, DH14) en ambos extremos en una ventana acordada.' });
  }
  // 7) FortiGate
  const S = src.fg, T = src.fgt;
  if (S && S.configured !== false) {
    for (const t of S.tunnels || []) if (!t.up) add({ sev: 'warn', cat: 'red', asset: t.name, assetKind: 'vpn', title: `Túnel VPN caído (${t.remote || ''})`, source: 'FortiGate', href: '#/fortigate' });
    const groups2 = {};
    for (const x of S.sdwan || []) (groups2[x.check] ||= []).push(x);
    for (const [check, mem] of Object.entries(groups2)) if (!mem.some((m) => /^(alive|up)$/i.test(m.status || ''))) add({ sev: 'crit', cat: 'red', asset: check.replace(/^lo[_ -]?/i, ''), assetKind: 'agencia', title: 'Agencia sin enlace SD-WAN', detail: mem.map((m) => m.member).join(', '), source: 'FortiGate', href: '#/red' });
    for (const a of S.wifi || []) if (!/^(connected|online|up)$/i.test(a.status || '')) add({ sev: 'info', cat: 'red', asset: a.full || a.name, assetKind: 'wifi', title: 'Access point Wi-Fi desconectado', source: 'FortiGate', href: '#/fortigate' });
    for (const d of S.devices || []) if (d.firstSeen > 0 && Date.now() - d.firstSeen < 7 * 86400e3) add({ sev: 'info', cat: 'usuarios', asset: d.host || d.ip || d.mac, assetKind: 'equipo', title: `Equipo nuevo en la red${d.vendor ? ` (${d.vendor})` : ''}`, detail: `${d.ip || ''} · ${d.mac || ''} · ${d.iface || ''}`, source: 'FortiGate', ts: d.firstSeen, href: '#/fortigate' });
  }
  if (T && T.configured !== false) {
    for (const x of (T.threats || []).slice(0, 30)) add({ sev: /block|drop|deny|reset/i.test(x.action) ? 'warn' : 'crit', cat: 'ataques', asset: x.src || '—', assetKind: 'equipo', title: `Amenaza ${x.kind}: ${x.name}`, detail: `${x.src} → ${x.dst} · ${x.action || 'sin acción'}`, source: 'FortiGate', href: '#/fortigate' });
    for (const u of T.byIp || []) {
      const remote = (u.apps || []).filter((a) => REMOTE.test(a.k)), risky = (u.apps || []).filter((a) => RISKY.test(a.k));
      if (remote.length) add({ sev: 'info', cat: 'usuarios', asset: u.name || u.ip, assetKind: 'equipo', title: `Acceso remoto: ${remote.map((a) => a.k).join(', ')}`, detail: `${u.ip}`, source: 'FortiGate', href: '#/fortigate' });
      if (risky.length) add({ sev: 'warn', cat: 'usuarios', asset: u.name || u.ip, assetKind: 'equipo', title: `Aplicación de riesgo: ${risky.map((a) => a.k).join(', ')}`, detail: `${u.ip}`, source: 'FortiGate', href: '#/fortigate' });
      const bad = (u.countries || []).filter((c) => BAD_COUNTRIES.test(c.k));
      if (bad.length) add({ sev: 'warn', cat: 'usuarios', asset: u.name || u.ip, assetKind: 'equipo', title: `Conexión saliente inusual hacia ${bad.map((c) => c.k).join(', ')}`, detail: `${u.ip} · ${bad.reduce((t, c) => t + c.v, 0)} conexiones`, source: 'FortiGate', href: '#/fortigate' });
    }
  }
  // 8) Suplantación de marca
  for (const d of src.clones?.domains || []) if (d.sev !== 'info') add({ sev: d.sev, cat: 'marca', asset: d.domain, assetKind: 'dominio', title: d.reason, source: 'Vigilancia de dominios', href: '#/seguridad' });
  // sin duplicados
  const seen = new Set();
  return F.filter((f) => (seen.has(f.id) ? false : seen.add(f.id))).sort((a, b) => SEV[a.sev][2] - SEV[b.sev][2] || (b.ts || 0) - (a.ts || 0));
}

/** Puntaje 0–100 con el detalle de cuánto resta cada categoría. */
export function securityScore(findings) {
  const by = {};
  for (const f of findings) by[f.cat] = (by[f.cat] || 0) + W[f.sev];
  const parts = Object.entries(by).map(([cat, v]) => ({ cat, label: CATS[cat] || cat, minus: Math.min(CAP, v), n: findings.filter((f) => f.cat === cat).length })).sort((a, b) => b.minus - a.minus);
  const score = Math.max(0, Math.round(100 - parts.reduce((t, p) => t + p.minus, 0)));
  return { score, parts, grade: score >= 85 ? ['Buena', 'ok'] : score >= 65 ? ['Aceptable', 'warn'] : ['En riesgo', 'crit'] };
}

/** Riesgo por equipo (0–100) a partir de sus hallazgos. */
export function assetRisk(findings) {
  const m = {};
  for (const f of findings) {
    if (f.assetKind === 'regla') continue;
    const o = (m[f.asset] ||= { asset: f.asset, kind: f.assetKind, href: f.href, risk: 0, crit: 0, warn: 0, info: 0, top: [] });
    o.risk += { crit: 35, warn: 12, info: 3 }[f.sev]; o[f.sev]++; o.top.push(f.title);
  }
  return Object.values(m).map((o) => ({ ...o, risk: Math.min(100, o.risk) })).sort((a, b) => b.risk - a.risk);
}
