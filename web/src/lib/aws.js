// Datos de AWS para el panel: facturación (Cost Explorer) y almacenamiento S3. Incluye datos de demostración.
import { DEMO } from '../config.js';
import { awsApi, budgetApi, fxApi } from './api.js';

export const SERVICE_NAMES = {
  'Amazon Elastic Compute Cloud - Compute': 'EC2 (servidores)', 'EC2 - Other': 'EC2 · discos y otros', 'Amazon Simple Storage Service': 'S3 (almacenamiento)',
  'Amazon Relational Database Service': 'RDS (bases de datos)', AmazonCloudWatch: 'CloudWatch', 'Amazon Virtual Private Cloud': 'VPC / IP públicas',
  'AWS Backup': 'Backup', 'Amazon Route 53': 'Route 53 (DNS)', 'Amazon CloudFront': 'CloudFront', 'AWS Key Management Service': 'KMS', Tax: 'Impuestos',
  'Amazon Elastic Load Balancing': 'Balanceadores', 'Elastic Load Balancing': 'Balanceadores', 'AWS Lambda': 'Lambda', 'Amazon Simple Email Service': 'SES (correo)',
  'AWS Cost Explorer': 'Cost Explorer', 'AWS Amplify': 'Amplify', 'Amazon EC2 Container Registry (ECR)': 'ECR', 'AWS Secrets Manager': 'Secrets Manager', 'Amazon Simple Notification Service': 'SNS', 'Amazon Elastic Container Service': 'ECS', 'Amazon Lightsail': 'Lightsail', 'AWS Data Transfer': 'Transferencia de datos',
};
export const svcName = (s) => SERVICE_NAMES[s] || s.replace(/^Amazon |^AWS /, '');
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (v) => (v == null || !isFinite(v) ? '—' : money.format(v));
export const usd0 = (v) => (v == null || !isFinite(v) ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v));
export function bytes(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export const STORAGE_CLASS = {
  StandardStorage: 'Estándar', StandardIAStorage: 'Estándar-IA', OneZoneIAStorage: 'Una zona-IA', ReducedRedundancyStorage: 'RRS',
  IntelligentTieringFAStorage: 'Intelligent-Tiering', IntelligentTieringIAStorage: 'Int.-Tiering IA', IntelligentTieringAAStorage: 'Int.-Tiering archivo',
  GlacierStorage: 'Glacier', GlacierInstantRetrievalStorage: 'Glacier IR', DeepArchiveStorage: 'Deep Archive', GlacierStagingStorage: 'Glacier (staging)',
};

export async function loadBilling(force) { return DEMO ? demoBilling() : awsApi.billing(force); }
export async function loadS3(force) { return DEMO ? demoS3() : awsApi.s3(force); }
export async function loadFx() {
  if (DEMO) return { rate: 3928.52, prev: 3911.2, date: new Date().toISOString().slice(0, 10), source: 'TRM oficial · Superfinanciera (demo)' };
  try { return await fxApi.cop(); } catch (e) {
    // Respaldo: consultar la TRM directamente desde el navegador
    try {
      const r = await fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=2');
      const [x, y] = await r.json();
      if (x?.valor) return { rate: +x.valor, prev: y?.valor ? +y.valor : null, date: String(x.vigenciadesde).slice(0, 10), source: 'TRM oficial · Superfinanciera' };
    } catch { /* siguiente */ }
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD'); const x = await r.json();
      if (x?.rates?.COP) return { rate: +x.rates.COP, prev: null, date: new Date().toISOString().slice(0, 10), source: 'Tasa de mercado (open.er-api.com)' };
    } catch { /* sin fuente */ }
    throw e;
  }
}
export async function loadBudget() { return DEMO ? { usd: 2000 } : budgetApi.get(); }
export async function saveBudget(usd) { return DEMO ? { usd } : budgetApi.set(usd); }

/** Formateadores de dinero según la moneda elegida. Los montos de AWS vienen en USD. */
export function moneyFmt(cur, trm) {
  const copF = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const cop = (v) => (v == null || !isFinite(v) || !trm ? null : `${copF.format(v * trm)} COP`);
  if (cur === 'AMBAS') { const b = moneyFmt('USD', trm); return { ...b, cur: 'AMBAS', second: cop }; }
  if (cur === 'COP' && trm) {
    const f = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    const short = (v) => { const x = v * trm; return Math.abs(x) >= 1e6 ? `$ ${(x / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : f.format(x); };
    const shortRaw = (x) => (Math.abs(x) >= 1e6 ? `$ ${(x / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : f.format(x));
    return { fmt: (v) => (v == null || !isFinite(v) ? '—' : f.format(v * trm)), fmt0: (v) => (v == null || !isFinite(v) ? '—' : short(v)), k: trm, axis: shortRaw, cur: 'COP' };
  }
  return { fmt: usd, fmt0: usd0, k: 1, axis: (x) => (Number.isInteger(x) ? usd0(x) : usd(x)), cur: 'USD' };
}

// ---------------------------------------------------------------- ¿Qué cobra y cómo ahorrar?
// Cada regla explica el tipo de uso de AWS en español y, si aplica, el % que se podría ahorrar (estimado).
const RULES = [
  [/BoxUsage:?(.*)/, (m) => `Horas de servidor EC2${m[1] ? ` (${m[1]})` : ''}`, 'Si el servidor corre 24/7, un Savings Plan de 1 año ahorra ~28–40%. Revisa también si el tamaño es mayor al necesario (CPU promedio en el Resumen).', 0.3, 'Savings Plan / tamaño'],
  [/EBS:VolumeUsage\.gp2/, () => 'Discos EBS gp2', 'Cambiarlos a gp3 cuesta ~20% menos con igual o mejor rendimiento, sin apagar el servidor.', 0.2, 'Migrar a gp3'],
  [/EBS:VolumeUsage\.gp3/, () => 'Discos EBS gp3', 'Revisa volúmenes sin usar (estado "available") y discos con mucho espacio asignado y poco usado.', 0, 'Revisar discos'],
  [/EBS:VolumeUsage(\.st1|\.sc1|$)/, () => 'Discos EBS (magnéticos)', 'Revisa volúmenes sin adjuntar.', 0, 'Revisar discos'],
  [/EBS:(VolumeP-IOPS|VolumeIOUsage|VolumeP-Throughput)/, () => 'IOPS / rendimiento de discos', 'Confirma si necesitas IOPS aprovisionadas: gp3 ya incluye 3.000 IOPS y 125 MB/s.', 0, 'Revisar IOPS'],
  [/EBS:Snapshot/, () => 'Snapshots de EBS', 'Borra snapshots antiguos o configura retención automática (AWS Backup / Data Lifecycle Manager).', 0.25, 'Retención de snapshots'],
  [/PublicIPv4:IdleAddress/, () => 'IP públicas sin usar', 'Se pagan sin estar asignadas a nada: libéralas (EC2 → Elastic IPs).', 1, 'Liberar IP'],
  [/PublicIPv4:InUseAddress/, () => 'IP públicas IPv4 en uso', 'AWS cobra US$ 0,005/h por cada IP pública (≈ US$ 3,65 al mes). Revisa cuáles son realmente necesarias.', 0, 'Revisar IP públicas'],
  [/NatGateway/, () => 'NAT Gateway', 'Cuesta ~US$ 33 al mes más el tráfico. Evalúa endpoints de VPC para S3 o si realmente se necesita.', 0, 'Revisar NAT'],
  [/DataTransfer-Out-Bytes|CloudFront-Out/, () => 'Tráfico de salida a Internet', 'Usa CloudFront/caché y compresión; revisa descargas grandes o copias que salen de AWS.', 0, 'Reducir tráfico'],
  [/DataTransfer-Regional-Bytes|InterZone|xAZ/, () => 'Tráfico entre zonas de AWS', 'Pon en la misma zona los servidores que hablan mucho entre sí.', 0, 'Revisar tráfico'],
  [/TimedStorage-ByteHrs$/, () => 'S3 Estándar (espacio)', 'Reglas de ciclo de vida: mover a Estándar-IA o Glacier lo que no se lee en 30–90 días ahorra 40–80%.', 0.3, 'Ciclo de vida S3'],
  [/TimedStorage-(SIA|ZIA|GIR|Glacier|GDA|INT)/, () => 'S3 clases de bajo costo (espacio)', 'Ya está en una clase económica; revisa si hay datos que se puedan borrar.', 0, 'Revisar retención'],
  [/Requests-(INT-)?Tier4|Lifecycle/, () => 'Transiciones de clase en S3 (ciclo de vida)', 'Cobro de una sola vez cuando una regla de ciclo de vida mueve archivos a otra clase (Intelligent-Tiering, IA o Glacier): ~US$ 0,01–0,05 por cada 1.000 archivos. Es normal los días en que la regla mueve muchos archivos; después baja el costo de almacenamiento.', 0, 'Normal tras una regla nueva'],
  [/Requests-Tier[12]|Requests-/, () => 'Peticiones a S3', 'Revisa procesos que listan o suben archivos en bucle.', 0, 'Revisar peticiones'],
  [/(Warm|Cold)Storage|TimedBackupStorage|BackupStorage/, () => 'Almacenamiento de respaldos', 'Revisa la retención de los planes de AWS Backup (¿cuántos días se guardan?).', 0.2, 'Retención de backups'],
  [/InstanceUsage|Multi-AZUsage/, () => 'Horas de base de datos RDS', 'Instancias reservadas de RDS ahorran ~30–40% si corre 24/7; revisa también el tamaño.', 0.3, 'Reserva / tamaño'],
  [/RDS:.*Storage|RDS:ChargedBackupUsage/, () => 'Almacenamiento RDS', 'Revisa el espacio asignado y los respaldos manuales antiguos.', 0, 'Revisar almacenamiento'],
  [/DataProcessing-Bytes|VendedLog|CW:.*Log|TimedStorage-ByteHrs.*Log/, () => 'Registros de CloudWatch Logs', 'Baja el nivel de detalle de los logs y define retención (por defecto se guardan para siempre).', 0.3, 'Retención de logs'],
  [/CW:(MetricMonitorUsage|Requests|AlarmMonitorUsage|GMD-Metrics)/, () => 'Métricas y alarmas de CloudWatch', 'Revisa métricas personalizadas o alarmas que ya no uses.', 0, 'Revisar métricas'],
  [/BuildDuration|Amplify/, () => 'Amplify (compilaciones y hosting)', 'Revisa ramas que se compilan automáticamente sin necesidad.', 0, 'Revisar Amplify'],
  [/LoadBalancerUsage|LCUUsage/, () => 'Balanceador de carga', 'Cada balanceador cuesta ~US$ 16–20 al mes aunque no tenga tráfico: elimina los que no se usen.', 0, 'Revisar balanceadores'],
  [/VPN-Usage-Hours/, () => 'Conexiones VPN Site-to-Site', 'Cada conexión VPN cuesta ~US$ 36 al mes aunque no pase tráfico: revisa si hay túneles que ya no se usen.', 0, 'Revisar VPN'],
  [/AmplifyWAF/, () => 'Firewall (WAF) de Amplify', 'Revisa si todas las apps de Amplify necesitan el firewall activado.', 0, 'Revisar WAF'],
  [/WebACL|Rule|Request.*WAF/, () => 'AWS WAF', 'Revisa reglas y ACL web que ya no protejan nada.', 0, 'Revisar WAF'],
  [/^Tax$/, () => 'Impuestos (IVA)', 'Se calcula sobre el resto del consumo.', 0, ''],
];
const REGIONS = { USE1: 'N. Virginia', USE2: 'Ohio', USW1: 'California', USW2: 'Oregón', SAE1: 'São Paulo', EUW1: 'Irlanda', EU: 'Irlanda', CAN1: 'Canadá', MXC1: 'México' };
export function explainUsage(u) {
  const ut = u.service === 'Tax' ? 'Tax' : (u.usageType || '');
  const rg = (ut.match(/^([A-Z]{2,4}\d?)-/) || [])[1];
  const where = rg && rg !== 'USE1' ? ` · ${REGIONS[rg] || rg}` : '';
  for (const [re, label, tip, save, action] of RULES) { const m = ut.match(re); if (m) return { label: label(m) + where, tip: tip + (where ? ` Este recurso está en la región ${REGIONS[rg] || rg}, fuera de la principal (N. Virginia): confirma que sea intencional.` : ''), save, action }; }
  return { label: u.usageType, tip: 'Revisa en la consola de AWS (Cost Explorer → agrupar por tipo de uso).', save: 0, action: 'Revisar' };
}

/** Hallazgos de costo: crecimientos, picos diarios, presupuesto y ahorro estimado. */
export function costFindings(sum, budget) {
  const out = [];
  if (!sum) return out;
  if (budget && sum.forecast != null) {
    const p = sum.forecast / budget;
    if (p > 1) out.push({ tone: 'crit', title: 'El pronóstico supera el presupuesto', detail: `Se estima cerrar en ${Math.round(p * 100)}% del presupuesto.`, amount: sum.forecast - budget });
    else if (p > 0.9) out.push({ tone: 'warn', title: 'Cerca del presupuesto', detail: `Pronóstico en ${Math.round(p * 100)}% del presupuesto.`, amount: null });
  }
  const closed = sum.closed || [];
  if (closed.length >= 5) {
    const last = closed[closed.length - 1], prev7 = closed.slice(-8, -1), avg = prev7.reduce((t, d) => t + d.total, 0) / prev7.length;
    if (avg > 0 && last.total > avg * 1.3) {
      const why = dayReasons(sum.raw, last.date, 2)?.items.filter((x) => x.delta > 0.5) || [];
      out.push({ tone: 'warn', title: `Pico de gasto el ${last.date.slice(8, 10)}`, detail: `El último día cerrado costó ${Math.round((last.total / avg - 1) * 100)}% más que el promedio de los 7 días anteriores.${why.length ? ` Motivo: ${why.map((x) => `${x.label} (+${usd(x.delta)})`).join(', ')}.` : ''}`, amount: last.total - avg, date: last.date });
    }
    for (const [svc, v] of Object.entries(last.services)) {
      const a = prev7.reduce((t, d) => t + (d.services[svc] || 0), 0) / prev7.length;
      if (v > 3 && (a === 0 || v > a * 1.6)) out.push({ tone: 'warn', title: `${svcName(svc)} se disparó`, detail: a ? `${Math.round((v / a - 1) * 100)}% sobre su promedio diario de la última semana.` : 'Servicio nuevo en la última semana.', amount: v - a });
    }
  }
  const nClosed = Math.max(1, closed.length);
  for (const s of sum.services) {
    const closedSvc = closed.reduce((t, d) => t + (d.services[s.key] || 0), 0);
    const pace = (closedSvc / nClosed) * sum.dim;
    if (s.prev > 5 && pace > s.prev * 1.15) out.push({ tone: 'warn', title: `${s.name} va ${Math.round((pace / s.prev - 1) * 100)}% por encima del mes anterior`, detail: 'Según el ritmo diario de este mes.', amount: pace - s.prev });
    if (!s.prev && s.mtd > 5) out.push({ tone: 'info', title: `Servicio nuevo: ${s.name}`, detail: 'No aparecía el mes anterior.', amount: s.mtd });
  }
  return out.sort((a, b) => ({ crit: 0, warn: 1, info: 2 }[a.tone] - { crit: 0, warn: 1, info: 2 }[b.tone]) || (b.amount || 0) - (a.amount || 0));
}

/** Resumen de facturación listo para pintar. */
export function summarizeBilling(b) {
  if (!b?.days) return null;
  // "Hoy" lo define el servidor en hora de Colombia; así a las 9 p. m. no se salta al mes siguiente (UTC)
  const todayUTC = b.today || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  let curM = todayUTC.slice(0, 7);
  // Los primeros días del mes AWS aún no ha cerrado ningún día: se muestra el mes anterior completo (ya cerrado)
  const cutoff = new Date(Date.parse(todayUTC) - 2 * 86400e3).toISOString().slice(0, 10);
  const showingPrev = !b.days.some((d) => d.date.startsWith(curM) && d.date <= cutoff && d.total > 0) && b.days.some((d) => d.date < curM + '-01');
  if (showingPrev) curM = new Date(Date.UTC(+curM.slice(0, 4), +curM.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  const monthDays = b.days.filter((d) => d.date.startsWith(curM));
  const mtd = monthDays.reduce((t, d) => t + d.total, 0);
  const months = b.months || [];
  const prev = months.filter((m) => m.month < curM).slice(-1)[0] || null;
  const byService = {};
  for (const d of monthDays) for (const [k, v] of Object.entries(d.services)) byService[k] = (byService[k] || 0) + v;
  const prevSvc = prev?.services || {};
  const services = Object.entries(byService).map(([k, v]) => ({ key: k, name: svcName(k), mtd: v, prev: prevSvc[k] ?? 0 })).sort((a, c) => c.mtd - a.mtd);
  // Cost Explorer tarda ~24-48 h en cerrar un día: se consideran "cerrados" los días de hace 2 o más días
  const closed = monthDays.filter((d) => d.date <= cutoff);
  const yesterday = closed.length ? closed[closed.length - 1] : null;
  const avgDay = closed.length ? closed.reduce((t, d) => t + d.total, 0) / closed.length : null;
  const dim = new Date(Date.UTC(+curM.slice(0, 4), +curM.slice(5, 7), 0)).getUTCDate();
  const openDays = new Set(monthDays.filter((d) => d.date > cutoff).map((d) => d.date));
  if (showingPrev) {
    const usage = (b.usage || []).map((u) => ({ ...u, cur: u.prev, qty: u.prevQty, prev: u.prev2 ?? null, prevQty: u.prev2Qty ?? null })).filter((u) => u.cur >= 0.01).sort((a, c) => c.cur - a.cur);
    return { mtd, prev, forecast: mtd, forecastLow: null, forecastHigh: null, forecastSource: 'cerrado', nextForecast: b.forecast ? b.forecast.rest : null, services, monthDays, closed, openDays, yesterday, avgDay, months, dim, usage: b.usage ? usage : null, todayUTC, curM, day: dim, showingPrev, raw: b };
  }
  const forecast = b.forecast ? mtd + b.forecast.rest : avgDay != null ? closed.reduce((t, d) => t + d.total, 0) + avgDay * (dim - closed.length) : null;
  // Mismo punto del mes anterior (para comparar justo)
  return { mtd, prev, forecast, forecastLow: b.forecast ? mtd + b.forecast.low : null, forecastHigh: b.forecast ? mtd + b.forecast.high : null, forecastSource: b.forecast ? 'aws' : 'lineal', services, monthDays, closed, openDays, yesterday, avgDay, months, dim, usage: b.usage || null, todayUTC, curM, day: +todayUTC.slice(8, 10), raw: b };
}

// ---------------------------------------------------------------- Detalle diario: motivos de los picos y ahorro
const skipCost = (svc, ut) => svc === 'Tax' || /Tax|Credit|Refund/i.test(ut || '');
const median = (a) => { if (!a.length) return 0; const x = [...a].sort((p, q) => p - q), m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0);
const minus = (d, n) => new Date(Date.parse(d) - n * 86400e3).toISOString().slice(0, 10);

/** Agrupa el detalle diario de Cost Explorer: { fecha: { total, k: { 'servicio|tipo': costo } } } (sin impuestos ni créditos). */
export function dailyIndex(b) {
  const rows = b?.dailyUsage;
  if (!rows?.length) return null;
  const byDate = {}, meta = {};
  for (const [d, svc, ut, c] of rows) {
    if (skipCost(svc, ut) || c < 0) continue;
    const k = `${svc}|${ut}`; meta[k] = { service: svc, usageType: ut };
    const o = (byDate[d] ||= { total: 0, k: {} }); o.total += c; o.k[k] = (o.k[k] || 0) + c;
  }
  return { byDate, meta, dates: Object.keys(byDate).sort() };
}

/** ¿Por qué un día costó más (o menos)? Compara cada concepto con su mediana de los 7 días anteriores. */
export function dayReasons(b, date, n = 8) {
  const ix = dailyIndex(b);
  if (!ix?.byDate[date]) return null;
  const prev = ix.dates.filter((d) => d < date && d >= minus(date, 7));
  const keys = new Set([...Object.keys(ix.byDate[date].k), ...prev.flatMap((d) => Object.keys(ix.byDate[d].k))]);
  const items = [...keys].map((k) => {
    const cost = ix.byDate[date].k[k] || 0, normal = median(prev.map((d) => ix.byDate[d].k[k] || 0));
    const ex = explainUsage(ix.meta[k]);
    return { key: k, ...ix.meta[k], label: ex.label, tip: ex.tip, cost, normal, delta: cost - normal };
  }).filter((x) => Math.abs(x.delta) >= 0.01).sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
  const normal = median(prev.map((d) => ix.byDate[d].total));
  return { date, total: ix.byDate[date].total, normal, delta: ix.byDate[date].total - normal, prevDays: prev.length, items: items.slice(0, n), all: items };
}

/**
 * Comparativo de consumo por concepto: día vs día anterior, últimos 7 días vs los 7 anteriores,
 * y mes a la fecha vs los mismos días del mes anterior. Usa solo días cerrados (hace 2+ días).
 * `ref` = día de referencia (por defecto el último día cerrado).
 */
export function periodCompare(b, ref = null) {
  const ix = dailyIndex(b);
  if (!ix) return null;
  const today = b.today || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const cutoff = minus(today, 2);
  const L = ref && ix.byDate[ref] ? ref : ix.dates.filter((d) => d <= cutoff).slice(-1)[0];
  if (!L) return null;
  const range = (a, z) => ix.dates.filter((d) => d >= a && d <= z);
  const mStart = L.slice(0, 8) + '01', dayN = +L.slice(8, 10);
  const pm = new Date(Date.UTC(+L.slice(0, 4), +L.slice(5, 7) - 2, 1)), pmDays = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).getUTCDate();
  const pmStart = pm.toISOString().slice(0, 10), pmEnd = pmStart.slice(0, 8) + String(Math.min(dayN, pmDays)).padStart(2, '0');
  const P = {
    day: { cur: [L], prev: range(minus(L, 1), minus(L, 1)), label: 'Día', curLabel: L, prevLabel: minus(L, 1) },
    week: { cur: range(minus(L, 6), L), prev: range(minus(L, 13), minus(L, 7)), label: 'Semana', curLabel: `${minus(L, 6)} → ${L}`, prevLabel: `${minus(L, 13)} → ${minus(L, 7)}` },
    month: { cur: range(mStart, L), prev: range(pmStart, pmEnd), label: 'Mes', curLabel: `${mStart} → ${L}`, prevLabel: `${pmStart} → ${pmEnd}` },
  };
  const out = { ref: L, firstDate: ix.dates[0] };
  for (const [name, p] of Object.entries(P)) {
    const sumK = (days) => { const m = {}; for (const d of days) for (const [k, v] of Object.entries(ix.byDate[d]?.k || {})) m[k] = (m[k] || 0) + v; return m; };
    const a = sumK(p.cur), z = sumK(p.prev);
    const items = [...new Set([...Object.keys(a), ...Object.keys(z)])].map((k) => {
      const ex = explainUsage(ix.meta[k]);
      return { key: k, ...ix.meta[k], label: ex.label, tip: ex.tip, cur: a[k] || 0, prev: z[k] || 0, delta: (a[k] || 0) - (z[k] || 0) };
    }).filter((x) => x.cur >= 0.01 || x.prev >= 0.01).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const cur = p.cur.reduce((t, d) => t + (ix.byDate[d]?.total || 0), 0), prev = p.prev.reduce((t, d) => t + (ix.byDate[d]?.total || 0), 0);
    out[name] = { ...p, total: cur, prevTotal: prev, delta: cur - prev, pct: prev ? ((cur - prev) / prev) * 100 : null, complete: p.prev.length > 0 && p.prev.length >= (name === 'week' ? 7 : name === 'month' ? Math.min(dayN, pmDays) : 1), items, byKey: Object.fromEntries(items.map((x) => [x.key, x])) };
  }
  return out;
}

/**
 * Ahorro diario frente a la línea base (mediana de los 14 días cerrados antes de las optimizaciones).
 * Se excluyen impuestos, créditos y el día 1 de cada mes (AWS carga ese día cobros mensuales fijos).
 */
export function savingsAnalysis(b) {
  const ix = dailyIndex(b);
  if (!ix || !b?.savingsFrom) return null;
  const today = b.today || new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const from = b.savingsFrom, cutoff = minus(today, 2), m1 = (d) => d.endsWith('-01');
  const base = ix.dates.filter((d) => d < from && !m1(d)).slice(-14);
  if (base.length < 5) return null;
  const baseTotal = median(base.map((d) => ix.byDate[d].total));
  const after = ix.dates.filter((d) => d >= from && d <= cutoff && !m1(d));
  const pending = ix.dates.filter((d) => d >= from && d > cutoff);
  const savingOf = (d) => baseTotal - ix.byDate[d].total;
  const series = ix.dates.filter((d) => d >= minus(from, 14)).map((d) => ({ date: d, total: ix.byDate[d].total, saving: d >= from ? savingOf(d) : null, closed: d <= cutoff, monthStart: m1(d) }));
  const recent = after.slice(-3);
  const keys = new Set([...base, ...recent].flatMap((d) => Object.keys(ix.byDate[d].k)));
  const drivers = [...keys].map((k) => {
    const before = median(base.map((d) => ix.byDate[d].k[k] || 0)), now = mean(recent.map((d) => ix.byDate[d].k[k] || 0));
    const ex = explainUsage(ix.meta[k]);
    return { key: k, ...ix.meta[k], label: ex.label, before, now, saving: before - now };
  }).filter((x) => recent.length && Math.abs(x.saving) >= 0.02).sort((p, q) => q.saving - p.saving);
  const avg = after.length ? mean(after.map(savingOf)) : null;
  return { from, baseTotal, baseDays: base.length, baseFrom: base[0], baseTo: base[base.length - 1], days: after.length, pending, avgDaily: avg, monthly: avg != null ? avg * 30 : null, cumulative: after.reduce((t, d) => t + savingOf(d), 0), last: after.length ? { date: after[after.length - 1], saving: savingOf(after[after.length - 1]), total: ix.byDate[after[after.length - 1]].total } : null, series, savers: drivers.filter((x) => x.saving > 0), risers: drivers.filter((x) => x.saving < 0).reverse() };
}

/** Crecimiento del almacenamiento S3 por bucket (métrica diaria de CloudWatch). */
export function s3Growth(bucket) {
  let h = (bucket.history || []).filter(([, v]) => v > 0);
  // El último punto puede llegar incompleto (CloudWatch publica cada clase por separado): si BAJA más de 30% se descarta
  if (h.length > 3 && h[h.length - 1][1] < h[h.length - 2][1] * 0.7) h = h.slice(0, -1);
  if (h.length < 3) return null;
  const deltas = h.slice(1).map(([d, v], i) => ({ date: d, delta: v - h[i][1] }));
  const last = deltas[deltas.length - 1], prev = deltas.slice(-8, -1).map((x) => x.delta);
  const normal = median(prev), avg7 = mean(deltas.slice(-7).map((x) => x.delta));
  const month = h.length >= 8 ? h[h.length - 1][1] - h[Math.max(0, h.length - 31)][1] : null;
  const GB = 1024 ** 3;
  // "Demasiado": el último día creció más del triple de lo normal y más de 5 GB, o más de 50 GB en un día
  const spike = last.delta > 50 * GB || (last.delta > 5 * GB && last.delta > Math.max(normal, 0) * 3);
  return { last, normal, avg7, month, deltas, spike, perMonth: avg7 * 30 };
}

// ---------------------------------------------------------------- demo
const rnd = (s) => { const x = Math.sin(s * 99.13) * 10000; return x - Math.floor(x); };
function demoBilling() {
  const now = new Date(Date.now() - 5 * 3600e3), y = now.getUTCFullYear(), m = now.getUTCMonth(), today = now.getUTCDate(); // hora de Colombia
  const base = { 'Amazon Elastic Compute Cloud - Compute': 11.8, 'EC2 - Other': 2.4, 'Amazon Relational Database Service': 4.1, 'Amazon Simple Storage Service': 1.35, 'Amazon Virtual Private Cloud': 0.9, AmazonCloudWatch: 0.42, 'AWS Backup': 0.31, 'Amazon Route 53': 0.05 };
  const days = Array.from({ length: today }, (_, i) => {
    const services = Object.fromEntries(Object.entries(base).map(([k, v], j) => [k, +(v * (0.88 + rnd(i * 7 + j) * 0.24) * (i === today - 1 ? 0.55 : 1)).toFixed(2)]));
    return { date: new Date(Date.UTC(y, m, i + 1)).toISOString().slice(0, 10), services, total: +Object.values(services).reduce((a, b) => a + b, 0).toFixed(2) };
  });
  const months = Array.from({ length: 6 }, (_, k) => {
    const d = new Date(Date.UTC(y, m - 5 + k, 1)), cur = k === 5, f = cur ? today : 30 * (0.9 + k * 0.03);
    const services = Object.fromEntries(Object.entries(base).map(([s, v], j) => [s, +(v * f * (0.92 + rnd(k * 3 + j) * 0.14)).toFixed(2)]));
    return { month: d.toISOString().slice(0, 7), services, total: +Object.values(services).reduce((a, b) => a + b, 0).toFixed(2), estimated: cur };
  });
  const daily = days.slice(0, -1).reduce((t, d) => t + d.total, 0) / Math.max(1, today - 1);
  const rest = daily * (new Date(Date.UTC(y, m + 1, 0)).getUTCDate() - today);
  const U = [['Amazon Elastic Compute Cloud - Compute', 'USE1-BoxUsage:t3a.2xlarge', 268, 281], ['Amazon Elastic Compute Cloud - Compute', 'USE1-BoxUsage:t3.large', 64, 66], ['Amazon Relational Database Service', 'USE1-InstanceUsage:db.t3.large', 98, 101],
    ['EC2 - Other', 'USE1-EBS:VolumeUsage.gp2', 41, 40], ['EC2 - Other', 'USE1-EBS:SnapshotUsage', 22, 17], ['Amazon Simple Storage Service', 'USE1-TimedStorage-ByteHrs', 29, 31], ['Amazon Virtual Private Cloud', 'USE1-PublicIPv4:InUseAddress', 21, 22],
    ['Amazon Virtual Private Cloud', 'USE1-PublicIPv4:IdleAddress', 5.4, 5.4], ['AmazonCloudWatch', 'USE1-DataProcessing-Bytes', 9.8, 8.1], ['EC2 - Other', 'USE1-DataTransfer-Out-Bytes', 6.2, 7.0], ['AWS Backup', 'USE1-WarmStorage-ByteHrs-EBS', 8.1, 8.9]];
  const usage = U.map(([service, usageType, cur, prev]) => ({ service, usageType, cur, prev, qty: 0, prevQty: 0, unit: '' }));
  // Detalle diario de demostración: 45 días con optimizaciones desde hace 5 días y un pico explicable
  const dailyUsage = [], from = new Date(Date.now() - 5 * 86400e3).toISOString().slice(0, 10);
  for (let i = 45; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    for (const [svc, ut, v] of [['Amazon Elastic Compute Cloud - Compute', 'USE1-BoxUsage:t3a.2xlarge', 7.2], ['EC2 - Other', 'USE1-EBS:VolumeUsage.gp2', 6.5], ['EC2 - Other', 'USE1-EBS:VolumeUsage.gp3', 2], ['Amazon Simple Storage Service', 'USE1-TimedStorage-ByteHrs', 9.2], ['Amazon Virtual Private Cloud', 'USE1-VPN-Usage-Hours:ipsec.1', 3.6]]) {
      let c = v * (0.97 + rnd(i * 3 + v) * 0.06);
      if (d >= from && /gp2/.test(ut)) c = 0; if (d >= from && /gp3/.test(ut)) c = 7.1; if (d >= from && /Timed/.test(ut)) c *= 0.75;
      dailyUsage.push([d, svc, ut, +c.toFixed(2)]);
    }
    if (i === 3) dailyUsage.push([d, 'Amazon Simple Storage Service', 'USE1-Requests-Tier4', 61.4]);
  }
  return { configured: true, currency: 'USD', dailyUsage, savingsFrom: from, today: new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10), days, months, usage, forecast: { rest: +rest.toFixed(2), low: +(rest * 0.93).toFixed(2), high: +(rest * 1.08).toFixed(2) }, cachedAt: Date.now() - 42 * 60e3, demo: true };
}
function demoS3() {
  const GB = 1024 ** 3, mk = (name, gb, obj, extra = {}) => {
    const history = Array.from({ length: 30 }, (_, i) => [new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10), gb * GB * (0.86 + i * 0.0048 + rnd(i + gb) * 0.004)]);
    return { name, region: 'us-east-1', created: '2023-03-14T00:00:00Z', publicBlock: 'all', isPublic: false, encryption: 'AES256', versioning: 'Disabled', lifecycle: 0, sizeBytes: history[29][1], objects: obj, classes: { StandardStorage: history[29][1] }, history, ...extra };
  };
  return {
    configured: true, demo: true, cachedAt: Date.now() - 18 * 60e3, buckets: [
      mk('empresa-respaldos-bd', 412, 18234, { versioning: 'Enabled', lifecycle: 2, classes: { StandardStorage: 120 * GB, StandardIAStorage: 180 * GB, GlacierInstantRetrievalStorage: 112 * GB } }),
      mk('empresa-documentos-clientes', 186, 942113, { versioning: 'Enabled', encryption: 'aws:kms' }),
      mk('core-archivos', 74, 120554),
      mk('empresa-web-estaticos', 9.3, 8421, { publicBlock: 'none', isPublic: true }),
      mk('logs-alb-empresa', 51, 2210933, { lifecycle: 1 }),
      mk('stg-taquilla-uploads', 3.1, 5102, { publicBlock: 'partial', encryption: 'none' }),
    ],
  };
}
