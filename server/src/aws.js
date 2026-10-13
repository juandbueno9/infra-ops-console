// AWS: facturación (Cost Explorer) y almacenamiento S3 — SOLO LECTURA.
//  - Credenciales: usuario IAM "Monitoreo-Facturacion" en server/.env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY),
//    o AWS_PROFILE, o el rol de la instancia (AWS_USE_ROLE=1). Nunca se envían al navegador.
//  - Cost Explorer cobra USD 0,01 por consulta: los resultados se guardan en caché (memoria + disco) 6 horas.
//  - El SDK se carga bajo demanda: si no está instalado, el resto del panel sigue funcionando.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const REGION = process.env.AWS_REGION || 'us-east-1';
const BILL_TTL = (Number(process.env.AWS_BILLING_CACHE_H) || 8) * 3600e3;
const S3_TTL = (Number(process.env.AWS_S3_CACHE_H) || 1) * 3600e3;
const MIN_FORCE = 10 * 60e3; // "actualizar ahora" como máximo cada 10 min (cuesta dinero)
const CACHE_FILE = path.join(config.dataDir, 'aws-cache.json');

export const awsConfigured = () => !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_USE_ROLE === '1');

let disk = null;
async function cache() {
  if (disk) return disk;
  try { disk = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { disk = {}; }
  return disk;
}
async function saveCache() {
  try { await fs.mkdir(config.dataDir, { recursive: true }); await fs.writeFile(CACHE_FILE, JSON.stringify(disk), { mode: 0o640 }); } catch (e) { console.error('[aws] caché:', e.message); }
}
const inflight = {};
async function cached(key, ttl, force, fn) {
  const c = await cache();
  const hit = c[key];
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (age < ttl) && !(force && age > MIN_FORCE)) return { ...hit.data, cachedAt: hit.at, fromCache: true };
  if (inflight[key]) return inflight[key];
  inflight[key] = (async () => {
    try {
      const data = await fn();
      c[key] = { at: Date.now(), data }; await saveCache();
      return { ...data, cachedAt: c[key].at, fromCache: false };
    } catch (e) {
      if (hit) return { ...hit.data, cachedAt: hit.at, fromCache: true, stale: true, error: friendly(e) };
      throw e;
    } finally { delete inflight[key]; }
  })();
  return inflight[key];
}

export function friendly(e) {
  const n = e?.name || e?.Code || '', m = e?.message || String(e);
  if (/Cannot find (package|module)/.test(m)) return 'Falta instalar el SDK de AWS en el servidor: npm --prefix server install';
  if (/AccessDenied|UnauthorizedOperation|not authorized/i.test(n + m)) return `Permiso denegado en AWS: ${m}. Revisa la política del usuario Monitoreo-Facturacion.`;
  if (/DataUnavailable/i.test(n)) return 'Cost Explorer todavía no tiene datos (si se acaba de activar, tarda hasta 24 h).';
  if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient/i.test(n + m)) return 'Las credenciales de AWS no son válidas (revisa AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY en server/.env).';
  if (/CredentialsProviderError|Could not load credentials/i.test(n + m)) return 'No hay credenciales de AWS configuradas en server/.env.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Host not|Deserialization error/i.test(m)) return 'No se pudo conectar con AWS desde este equipo (revisa Internet, proxy o firewall).';
  return m.slice(0, 300);
}

// ---------------------------------------------------------------- Facturación
const ymd = (d) => d.toISOString().slice(0, 10);
const num = (v) => +(+v || 0).toFixed(2);

export async function billing(force = false) {
  return cached('billing4', BILL_TTL, force, async () => {
    const { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } = await import('@aws-sdk/client-cost-explorer');
    const ce = new CostExplorerClient({ region: 'us-east-1' });
    // "Hoy" en hora de Colombia (UTC-5, sin horario de verano): así a las 9 p. m. no se salta al mes siguiente
    const now = new Date(Date.now() - 5 * 3600e3);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today.getTime() + 86400e3);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const sixAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
    // Diario del mes en curso por servicio (si hoy es día 1, se toma desde el mes anterior para no dejar vacío)
    const dStart = today.getUTCDate() === 1 ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)) : monthStart;
    const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const prev2Start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    // Detalle por servicio + tipo de uso (mes anterior y actual) para saber exactamente qué cobra más
    const usageQuery = async () => {
      const out = []; let token;
      do {
        const r = await ce.send(new GetCostAndUsageCommand({ TimePeriod: { Start: ymd(prev2Start), End: ymd(tomorrow) }, Granularity: 'MONTHLY', Metrics: ['UnblendedCost', 'UsageQuantity'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }], NextPageToken: token }));
        for (const t of r.ResultsByTime || []) for (const g of t.Groups || []) out.push({ month: t.TimePeriod.Start.slice(0, 7), service: g.Keys[0], usageType: g.Keys[1], cost: num(g.Metrics.UnblendedCost.Amount), qty: +(+g.Metrics.UsageQuantity?.Amount || 0).toFixed(3), unit: g.Metrics.UsageQuantity?.Unit || '' });
        token = r.NextPageToken;
      } while (token);
      return out;
    };
    // Detalle DIARIO por tipo de uso de los últimos 70 días: comparativos día/semana/mes, picos y ahorro
    const d45 = new Date(today.getTime() - 70 * 86400e3);
    const dailyUsageQuery = async () => {
      const out = []; let token;
      do {
        const r = await ce.send(new GetCostAndUsageCommand({ TimePeriod: { Start: ymd(d45), End: ymd(tomorrow) }, Granularity: 'DAILY', Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }], NextPageToken: token }));
        for (const t of r.ResultsByTime || []) for (const g of t.Groups || []) { const c = num(g.Metrics.UnblendedCost.Amount); if (Math.abs(c) >= 0.005) out.push([t.TimePeriod.Start, g.Keys[0], g.Keys[1], c]); }
        token = r.NextPageToken;
      } while (token);
      return out;
    };
    const [daily, monthly, usageRows, dailyUsage] = await Promise.all([
      ce.send(new GetCostAndUsageCommand({ TimePeriod: { Start: ymd(dStart), End: ymd(tomorrow) }, Granularity: 'DAILY', Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }] })),
      ce.send(new GetCostAndUsageCommand({ TimePeriod: { Start: ymd(sixAgo), End: ymd(tomorrow) }, Granularity: 'MONTHLY', Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }] })),
      usageQuery().catch((e) => { console.error('[aws] tipos de uso:', e?.message); return null; }),
      dailyUsageQuery().catch((e) => { console.error('[aws] detalle diario:', e?.message); return null; }),
    ]);
    const curKey = ymd(today).slice(0, 7), prevKey = ymd(prevStart).slice(0, 7), prev2Key = ymd(prev2Start).slice(0, 7);
    const usage = usageRows && Object.values(usageRows.reduce((acc, r) => {
      const k = `${r.service}|${r.usageType}`;
      const o = (acc[k] ||= { service: r.service, usageType: r.usageType, cur: 0, prev: 0, prev2: 0, qty: 0, prevQty: 0, prev2Qty: 0, unit: r.unit });
      if (r.month === curKey) { o.cur = num(o.cur + r.cost); o.qty = +(o.qty + r.qty).toFixed(3); } else if (r.month === prevKey) { o.prev = num(o.prev + r.cost); o.prevQty = +(o.prevQty + r.qty).toFixed(3); } else if (r.month === prev2Key) { o.prev2 = num(o.prev2 + r.cost); o.prev2Qty = +(o.prev2Qty + r.qty).toFixed(3); }
      return acc;
    }, {})).filter((u) => u.cur >= 0.01 || u.prev >= 0.01 || u.prev2 >= 0.01).sort((a, b) => b.cur - a.cur);
    let forecast = null, forecastError = null;
    if (today.getUTCDate() < new Date(nextMonth.getTime() - 86400e3).getUTCDate()) {
      try {
        // Diario y sumado: solo los días que faltan del mes (MONTHLY devuelve el mes completo)
        const f = await ce.send(new GetCostForecastCommand({ TimePeriod: { Start: ymd(tomorrow), End: ymd(nextMonth) }, Granularity: 'DAILY', Metric: 'UNBLENDED_COST', PredictionIntervalLevel: 80 }));
        const R = f.ForecastResultsByTime || [], sum = (k) => num(R.reduce((t, x) => t + (+x[k] || 0), 0));
        forecast = { rest: R.length ? sum('MeanValue') : num(f.Total?.Amount), low: sum('PredictionIntervalLowerBound'), high: sum('PredictionIntervalUpperBound'), days: R.length, from: ymd(tomorrow) };
      } catch (e) { forecastError = friendly(e); }
    }
    const currency = daily.ResultsByTime?.[0]?.Groups?.[0]?.Metrics?.UnblendedCost?.Unit || 'USD';
    const days = (daily.ResultsByTime || []).map((r) => ({
      date: r.TimePeriod.Start,
      services: Object.fromEntries((r.Groups || []).map((g) => [g.Keys[0], num(g.Metrics.UnblendedCost.Amount)]).filter(([, v]) => v >= 0.005)),
    })).map((d) => ({ ...d, total: num(Object.values(d.services).reduce((a, b) => a + b, 0)) }));
    const months = (monthly.ResultsByTime || []).map((r) => {
      const services = Object.fromEntries((r.Groups || []).map((g) => [g.Keys[0], num(g.Metrics.UnblendedCost.Amount)]).filter(([, v]) => v >= 0.005));
      return { month: r.TimePeriod.Start.slice(0, 7), services, total: num(Object.values(services).reduce((a, b) => a + b, 0)), estimated: !!r.Estimated };
    });
    return { currency, days, months, usage, dailyUsage, savingsFrom: process.env.AWS_SAVINGS_FROM || '2026-09-29', forecast, forecastError, today: ymd(today), queriedAt: Date.now() };
  });
}

// ---------------------------------------------------------------- S3
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const soft = async (p, dflt = null) => { try { return await p; } catch (e) { return { __err: e?.name || 'Error', ...(dflt || {}) }; } };

export async function s3(force = false) {
  return cached('s3', S3_TTL, force, async () => {
    const S3 = await import('@aws-sdk/client-s3');
    const CW = await import('@aws-sdk/client-cloudwatch');
    const g = new S3.S3Client({ region: REGION });
    const list = await g.send(new S3.ListBucketsCommand({}));
    const buckets = await pool(list.Buckets || [], 6, async (b) => {
      const loc = await soft(g.send(new S3.GetBucketLocationCommand({ Bucket: b.Name })));
      const region = loc?.__err ? REGION : (loc.LocationConstraint || 'us-east-1') === 'EU' ? 'eu-west-1' : (loc.LocationConstraint || 'us-east-1');
      const c = new S3.S3Client({ region });
      const [pab, pol, enc, ver, life] = await Promise.all([
        soft(c.send(new S3.GetPublicAccessBlockCommand({ Bucket: b.Name }))),
        soft(c.send(new S3.GetBucketPolicyStatusCommand({ Bucket: b.Name }))),
        soft(c.send(new S3.GetBucketEncryptionCommand({ Bucket: b.Name }))),
        soft(c.send(new S3.GetBucketVersioningCommand({ Bucket: b.Name }))),
        soft(c.send(new S3.GetBucketLifecycleConfigurationCommand({ Bucket: b.Name }))),
      ]);
      const blk = pab?.PublicAccessBlockConfiguration;
      const blockAll = !!(blk && blk.BlockPublicAcls && blk.IgnorePublicAcls && blk.BlockPublicPolicy && blk.RestrictPublicBuckets);
      return {
        name: b.Name, region, created: b.CreationDate ? new Date(b.CreationDate).toISOString() : null,
        publicBlock: pab?.__err === 'NoSuchPublicAccessBlockConfiguration' ? 'none' : pab?.__err ? 'unknown' : blockAll ? 'all' : 'partial',
        isPublic: pol?.__err ? (pol.__err === 'NoSuchBucketPolicy' ? false : null) : !!pol.PolicyStatus?.IsPublic,
        encryption: enc?.__err ? (enc.__err === 'ServerSideEncryptionConfigurationNotFoundError' ? 'none' : 'unknown') : enc.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm || 'AES256',
        versioning: ver?.__err ? 'unknown' : ver.Status || 'Disabled',
        lifecycle: life?.__err ? (life.__err === 'NoSuchLifecycleConfiguration' ? 0 : null) : (life.Rules || []).length,
        sizeBytes: null, objects: null, classes: {}, history: [],
      };
    });

    // Métricas diarias de CloudWatch (AWS/S3, gratuitas): tamaño por clase de almacenamiento y número de objetos
    const byRegion = {};
    for (const b of buckets) (byRegion[b.region] ||= []).push(b);
    const end = new Date(), start = new Date(end.getTime() - 32 * 86400e3);
    for (const [region, bs] of Object.entries(byRegion)) {
      const cw = new CW.CloudWatchClient({ region });
      const names = new Set(bs.map((b) => b.name));
      const metrics = [];
      let token;
      do {
        const r = await cw.send(new CW.ListMetricsCommand({ Namespace: 'AWS/S3', NextToken: token }));
        for (const m of r.Metrics || []) {
          const bn = m.Dimensions?.find((d) => d.Name === 'BucketName')?.Value;
          if (bn && names.has(bn) && (m.MetricName === 'BucketSizeBytes' || m.MetricName === 'NumberOfObjects')) metrics.push(m);
        }
        token = r.NextToken;
      } while (token);
      const queries = metrics.map((m, i) => ({ Id: `m${i}`, MetricStat: { Metric: m, Period: 86400, Stat: 'Average' }, ReturnData: true }));
      const results = {};
      for (let i = 0; i < queries.length; i += 450) {
        let nt;
        do {
          const r = await cw.send(new CW.GetMetricDataCommand({ StartTime: start, EndTime: end, MetricDataQueries: queries.slice(i, i + 450), NextToken: nt }));
          for (const x of r.MetricDataResults || []) (results[x.Id] ||= []).push(...(x.Timestamps || []).map((t, k) => [new Date(t).getTime(), x.Values[k]]));
          nt = r.NextToken;
        } while (nt);
      }
      metrics.forEach((m, i) => {
        const bn = m.Dimensions.find((d) => d.Name === 'BucketName').Value, st = m.Dimensions.find((d) => d.Name === 'StorageType')?.Value || '';
        const b = bs.find((x) => x.name === bn), pts = (results[`m${i}`] || []).sort((a, c) => a[0] - c[0]);
        if (!b || !pts.length) return;
        const lastV = pts[pts.length - 1][1];
        if (m.MetricName === 'NumberOfObjects') b.objects = Math.round(lastV);
        else {
          b.classes[st] = lastV;
          b.sizeBytes = (b.sizeBytes || 0) + lastV;
          for (const [t, v] of pts) { const d = new Date(t).toISOString().slice(0, 10); const h = b.history.find((x) => x[0] === d); if (h) h[1] += v; else b.history.push([d, v]); }
        }
      });
      bs.forEach((b) => b.history.sort((a, c) => (a[0] < c[0] ? -1 : 1)));
    }
    buckets.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
    return { buckets, queriedAt: Date.now() };
  });
}

// ---------------------------------------------------------------- Tipo de cambio USD → COP (TRM)
// 1) TRM oficial (Superintendencia Financiera, datos.gov.co) · 2) open.er-api.com · 3) COP_TRM en server/.env
const FX_TTL = 1 * 3600e3; // la TRM cambia a diario; se revisa cada hora
export async function fxCop(force = false) {
  const manual = Number(process.env.COP_TRM) || null;
  return cached('fx-cop', FX_TTL, force, async () => {
    const tries = [
      async () => {
        const r = await fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=2', { signal: AbortSignal.timeout(8000) });
        const [x, y] = await r.json();
        const val = (o) => (o?.valor != null ? Number(String(o.valor).replace(/[^0-9.]/g, '')) : null);
        if (!val(x)) throw new Error('sin TRM');
        return { rate: val(x), prev: val(y), date: String(x.vigenciadesde || '').slice(0, 10), until: String(x.vigenciahasta || '').slice(0, 10), source: 'TRM oficial · Superfinanciera' };
      },
      async () => {
        const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
        const x = await r.json();
        if (!x?.rates?.COP) throw new Error('sin tasa');
        return { rate: +x.rates.COP, date: new Date((x.time_last_update_unix || Date.now() / 1000) * 1000).toISOString().slice(0, 10), source: 'Tasa de mercado (open.er-api.com)' };
      },
    ];
    for (const t of tries) { try { return await t(); } catch { /* siguiente fuente */ } }
    if (manual) return { rate: manual, date: null, source: 'Valor fijo (COP_TRM en server/.env)' };
    throw new Error('No se pudo obtener la TRM (sin Internet). Puedes fijarla con COP_TRM=4000 en server/.env');
  });
}

// ---------------------------------------------------------------- Presupuesto mensual (compartido por el equipo)
const BUDGET_FILE = path.join(config.dataDir, 'aws-budget.json');
export async function getBudget() { try { return JSON.parse(await fs.readFile(BUDGET_FILE, 'utf8')); } catch { return { usd: Number(process.env.AWS_BUDGET_USD) || null }; } }
export async function setBudget(usd, who) {
  const v = usd == null || usd === '' ? null : Number(usd);
  if (v != null && (!isFinite(v) || v < 0 || v > 1e7)) throw Object.assign(new Error('Presupuesto no válido'), { status: 400 });
  const data = { usd: v, by: who?.user || '', at: new Date().toISOString() };
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(BUDGET_FILE, JSON.stringify(data), { mode: 0o640 });
  return data;
}
