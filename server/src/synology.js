// Synology NAS por SNMP — SOLO LECTURA (no puede cambiar nada en el NAS).
//  En el NAS: Panel de control → Terminal y SNMP → SNMP → activar SNMPv3 (recomendado) o v1/v2c con comunidad de solo lectura.
//  server/.env:
//    SYNOLOGY_HOSTS=192.168.10.180=NAS sistemas            (varios separados por coma)
//    SNMPv3 (recomendado): SYNOLOGY_SNMP_USER=monitoreo  SYNOLOGY_SNMP_AUTH=clave  [SYNOLOGY_SNMP_AUTH_PROTO=sha|md5]
//                          [SYNOLOGY_SNMP_PRIV=clave2  SYNOLOGY_SNMP_PRIV_PROTO=aes|des]
//    o SNMPv2c:            SYNOLOGY_COMMUNITY=comunidad_solo_lectura
//  OIDs: SYNOLOGY-SYSTEM/DISK/RAID/SERVICES/UPS-MIB + HOST-RESOURCES + UCD-SNMP + IF-MIB.
import snmp from 'net-snmp';

const HOSTS = (process.env.SYNOLOGY_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [h, ...n] = s.split('='); return { host: h.trim(), name: n.join('=').trim() || h.trim() }; });
// Credenciales generales y, si un NAS tiene otras, por IP: SYNOLOGY_SNMP_AUTH_192_168_10_185=... (igual USER, AUTH_PROTO, PRIV, PRIV_PROTO, COMMUNITY)
const env = (k, host) => process.env[`${k}_${host.replace(/[^0-9A-Za-z]/g, '_')}`] ?? process.env[k] ?? '';
const credOk = (host) => !!(env('SYNOLOGY_SNMP_USER', host) || env('SYNOLOGY_COMMUNITY', host));
export const synoConfigured = () => HOSTS.length > 0 && HOSTS.some((h) => credOk(h.host));

function session(host) {
  const opts = { port: Number(process.env.SYNOLOGY_SNMP_PORT) || 161, timeout: 4000, retries: 1 };
  const user3 = env('SYNOLOGY_SNMP_USER', host);
  if (user3) {
    const priv = env('SYNOLOGY_SNMP_PRIV', host);
    const user = {
      name: user3,
      level: priv ? snmp.SecurityLevel.authPriv : snmp.SecurityLevel.authNoPriv,
      authProtocol: /md5/i.test(env('SYNOLOGY_SNMP_AUTH_PROTO', host)) ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
      authKey: env('SYNOLOGY_SNMP_AUTH', host),
    };
    if (priv) Object.assign(user, { privProtocol: /des/i.test(env('SYNOLOGY_SNMP_PRIV_PROTO', host)) ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes, privKey: priv });
    return snmp.createV3Session(host, user, { ...opts, version: snmp.Version3 });
  }
  return snmp.createSession(host, env('SYNOLOGY_COMMUNITY', host), { ...opts, version: snmp.Version2c });
}

// Counter64 llega como Buffer; OctetString también.
const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (Buffer.isBuffer(v)) { if (!v.length) return 0; return Number(BigInt('0x' + v.toString('hex'))); }
  const n = Number(String(v)); return Number.isFinite(n) ? n : null;
};
const str = (v) => (v == null ? '' : Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g, '').trim() : String(v).trim());

const get = (s, oids) => new Promise((resolve) => {
  s.get(oids, (err, vbs) => {
    if (err) return resolve({ __err: err.message || String(err) });
    const o = {}; vbs.forEach((vb, i) => { o[oids[i]] = snmp.isVarbindError(vb) ? null : vb.value; }); resolve(o);
  });
});
// Recorre una tabla y devuelve { índice: { columna: valor } }
const table = (s, base) => new Promise((resolve) => {
  const rows = {};
  s.subtree(base, 20, (vbs) => {
    for (const vb of vbs) {
      if (snmp.isVarbindError(vb)) continue;
      const rest = vb.oid.slice(base.length + 1).split('.');
      const col = rest.shift(), idx = rest.join('.');
      (rows[idx] ||= {})[col] = vb.value;
    }
  }, (err) => resolve(err && !Object.keys(rows).length ? { __err: err.message || String(err) } : rows));
});

const SYS = '1.3.6.1.4.1.6574.1';
const S = {
  status: `${SYS}.1.0`, temp: `${SYS}.2.0`, power: `${SYS}.3.0`, fanSys: `${SYS}.4.1.0`, fanCpu: `${SYS}.4.2.0`,
  model: `${SYS}.5.1.0`, serial: `${SYS}.5.2.0`, dsm: `${SYS}.5.3.0`, upgrade: `${SYS}.5.4.0`,
  sysName: '1.3.6.1.2.1.1.5.0', hrUp: '1.3.6.1.2.1.25.1.1.0',
  cpuIdle: '1.3.6.1.4.1.2021.11.11.0', memTotal: '1.3.6.1.4.1.2021.4.5.0', memAvail: '1.3.6.1.4.1.2021.4.6.0', memBuf: '1.3.6.1.4.1.2021.4.14.0', memCache: '1.3.6.1.4.1.2021.4.15.0',
  load1: '1.3.6.1.4.1.2021.10.1.3.1',
  upsModel: '1.3.6.1.4.1.6574.4.1.1.0', upsStatus: '1.3.6.1.4.1.6574.4.2.1.0', upsCharge: '1.3.6.1.4.1.6574.4.3.1.1.0', upsRuntime: '1.3.6.1.4.1.6574.4.3.6.1.0',
};
const DISK_ST = { 1: 'Normal', 2: 'Inicializado', 3: 'Sin inicializar', 4: 'Partición del sistema fallida', 5: 'Dañado' };
const HEALTH = { 1: 'Normal', 2: 'Advertencia', 3: 'Crítico', 4: 'Fallando' };
const RAID_ST = { 1: 'Normal', 2: 'Reparando', 3: 'Migrando', 4: 'Expandiendo', 5: 'Eliminando', 6: 'Creando', 7: 'Sincronizando', 8: 'Verificando paridad', 9: 'Ensamblando', 10: 'Cancelando', 11: 'Degradado', 12: 'Dañado', 13: 'Depurando datos (scrubbing)', 14: 'Desplegando', 15: 'Sin desplegar', 16: 'Montando caché', 17: 'Desmontando caché', 18: 'Expansión sin terminar', 19: 'Convirtiendo SHR', 20: 'Migrando SHR1→SHR2', 21: 'Sin desplegar' };
const UPG = { 1: 'Disponible', 2: 'Al día', 3: 'Consultando', 4: 'Sin conexión', 5: 'Otro' };

const prev = new Map(); // muestras anteriores de red para calcular velocidad

async function readNas({ host, name }) {
  const s = session(host);
  try {
    const sc = await get(s, Object.values(S));
    if (sc.__err) return { host, name, ok: false, error: /timed? ?out/i.test(sc.__err) ? 'El NAS no respondió por SNMP (¿SNMP activo, firewall del NAS o credenciales?)' : sc.__err };
    const v = Object.fromEntries(Object.entries(S).map(([k, o]) => [k, sc[o]]));
    if (v.model == null && v.status == null) return { host, name, ok: false, error: 'Respondió pero sin datos Synology: revisa usuario/comunidad SNMP' };
    const [dk, rd, hr, sv, ifx] = await Promise.all([
      table(s, '1.3.6.1.4.1.6574.2.1.1'), table(s, '1.3.6.1.4.1.6574.3.1.1'), table(s, '1.3.6.1.2.1.25.2.3.1'),
      table(s, '1.3.6.1.4.1.6574.6.1.1'), table(s, '1.3.6.1.2.1.31.1.1.1'),
    ]);
    const disks = Object.values(dk.__err ? {} : dk).map((d) => ({
      id: str(d[2]), name: str(d[12]) || str(d[2]), model: str(d[3]), type: str(d[4]), status: num(d[5]), statusLabel: DISK_ST[num(d[5])] || `Código ${num(d[5])}`,
      temp: num(d[6]), role: str(d[7]), bad: num(d[9]), life: num(d[11]), health: num(d[13]), healthLabel: HEALTH[num(d[13])] || null,
    })).filter((d) => d.id);
    const raids = Object.values(rd.__err ? {} : rd).map((r) => {
      const total = num(r[5]), free = num(r[4]);
      return { name: str(r[2]), pool: /pool|grupo/i.test(str(r[2])), status: num(r[3]), statusLabel: RAID_ST[num(r[3])] || `Código ${num(r[3])}`, total, free, usedPct: total ? 100 * (1 - free / total) : null };
    }).filter((r) => r.name);
    const volumes = Object.values(hr.__err ? {} : hr).filter((x) => /^\/volume\d+$/.test(str(x[3]))).map((x) => {
      const u = num(x[4]) || 1; let size = num(x[5]), used = num(x[6]);
      if (size < 0) size += 2 ** 32; if (used < 0) used += 2 ** 32;
      return { name: str(x[3]), total: size * u, used: used * u, usedPct: size ? (100 * used) / size : null };
    });
    const services = Object.values(sv.__err ? {} : sv).map((x) => ({ name: str(x[2]), users: num(x[3]) })).filter((x) => x.name);
    const now = Date.now(), last = prev.get(host);
    const net = Object.values(ifx.__err ? {} : ifx).map((x) => ({ name: str(x[1]), rx: num(x[6]), tx: num(x[10]) }))
      .filter((x) => /^(eth|bond|ovs_eth|ovs_bond)\d/.test(x.name)).map((x) => {
        const p = last?.net?.[x.name], dt = last ? (now - last.at) / 1000 : 0;
        return { name: x.name, rxRate: p && dt > 0 && x.rx >= p.rx ? (x.rx - p.rx) / dt : null, txRate: p && dt > 0 && x.tx >= p.tx ? (x.tx - p.tx) / dt : null, rx: x.rx, tx: x.tx };
      });
    prev.set(host, { at: now, net: Object.fromEntries(net.map((x) => [x.name, { rx: x.rx, tx: x.tx }])) });
    const memTotal = num(v.memTotal), memAvail = num(v.memAvail), memFree = memAvail != null ? memAvail + (num(v.memBuf) || 0) + (num(v.memCache) || 0) : null;
    const ups = v.upsModel != null ? { model: str(v.upsModel), status: str(v.upsStatus), charge: num(v.upsCharge), runtime: num(v.upsRuntime) } : null;

    const out = {
      host, name, ok: true, sysName: str(v.sysName), model: str(v.model), serial: str(v.serial), dsm: str(v.dsm),
      upgrade: UPG[num(v.upgrade)] || null, temp: num(v.temp), system: num(v.status), power: num(v.power), fans: { system: num(v.fanSys), cpu: num(v.fanCpu) },
      cpu: v.cpuIdle != null ? Math.max(0, 100 - num(v.cpuIdle)) : null, mem: memTotal ? Math.min(100, 100 * (1 - Math.min(memFree, memTotal) / memTotal)) : null, memTotal: memTotal ? memTotal * 1024 : null,
      load: str(v.load1) ? num(str(v.load1)) : null, uptime: num(v.hrUp) != null ? num(v.hrUp) / 100 : null, disks, raids, volumes, services, net, ups,
    };
    out.issues = issues(out);
    return out;
  } catch (e) {
    return { host, name, ok: false, error: e.message };
  } finally { try { s.close(); } catch { /* ya cerrada */ } }
}

function issues(n) {
  const I = [], add = (sev, msg) => I.push({ sev, msg });
  if (n.system === 2) add('crit', 'El NAS reporta falla del sistema');
  if (n.power === 2) add('crit', 'Falla en la fuente de poder');
  if (n.fans.system === 2 || n.fans.cpu === 2) add('crit', 'Falla en un ventilador');
  if (n.temp != null) { if (n.temp >= 70) add('crit', `Temperatura del NAS muy alta: ${n.temp} °C`); else if (n.temp >= 60) add('warn', `Temperatura del NAS alta: ${n.temp} °C`); }
  for (const d of n.disks) {
    const lbl = d.name || d.id;
    if (d.status === 4 || d.status === 5 || d.health === 3 || d.health === 4) add('crit', `${lbl}: ${d.health >= 3 ? d.healthLabel : d.statusLabel} — cambiar el disco`);
    else if (d.health === 2) add('warn', `${lbl}: salud en advertencia (${d.model})`);
    else if (d.status === 3) add('info', `${lbl}: disco sin inicializar`);
    if (d.bad > 0) add(d.bad > 50 ? 'crit' : 'warn', `${lbl}: ${d.bad} sectores dañados`);
    if (d.temp >= 55) add('warn', `${lbl}: temperatura ${d.temp} °C`);
    if (d.life != null && d.life > 0 && d.life < 20) add('warn', `${lbl}: vida útil restante ${d.life}%`);
  }
  for (const r of n.raids) {
    if (r.status === 11 || r.status === 12) add('crit', `${r.name}: ${r.statusLabel}`);
    else if (r.status && r.status !== 1 && r.status !== 13) add('warn', `${r.name}: ${r.statusLabel}`);
    if (r.usedPct != null && !r.pool) { if (r.usedPct >= 95) add('crit', `${r.name} al ${r.usedPct.toFixed(0)}% de capacidad`); else if (r.usedPct >= 85) add('warn', `${r.name} al ${r.usedPct.toFixed(0)}% de capacidad`); }
  }
  if (n.ups && n.ups.charge != null && n.ups.charge < 50) add('warn', `UPS con ${n.ups.charge}% de batería`);
  if (n.upgrade === 'Disponible') add('info', 'Hay una actualización de DSM disponible');
  return I;
}

let memo = null, running = null;
export async function synoStatus(force = false) {
  if (memo && !force && Date.now() - memo.at < 30e3) return memo;
  if (running) return running;
  running = (async () => {
    try { memo = { configured: true, at: Date.now(), nas: await Promise.all(HOSTS.map(readNas)) }; return memo; } finally { running = null; }
  })();
  return running;
}
