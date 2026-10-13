// Revisión de instancias para decidir mejoras y Savings Plan (SOLO LECTURA: no cambia nada en AWS).
// Uso (desde la carpeta server):  node scripts/revisar-instancias.mjs
// Toma las claves de server/.env, igual que el panel.
import 'dotenv/config';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient, GetSavingsPlansPurchaseRecommendationCommand } from '@aws-sdk/client-cost-explorer';

const REGIONS = ['us-east-1', 'sa-east-1'];
const now = new Date(), ago = (d) => new Date(now.getTime() - d * 86400e3);
const pad = (s, n) => String(s ?? '—').padEnd(n);

async function metric(cw, id, name, days, period, stats) {
  const r = await cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/EC2', MetricName: name, Dimensions: [{ Name: 'InstanceId', Value: id }], StartTime: ago(days), EndTime: now, Period: period, Statistics: stats }));
  return r.Datapoints || [];
}

console.log('\n=== Instancias (horas encendido 7 días · CPU 14 días · créditos de CPU cobrados 14 días) ===\n');
console.log(pad('Nombre', 26) + pad('Tipo', 14) + pad('Región', 11) + pad('Estado', 10) + pad('Horas 7d', 10) + pad('CPU prom', 10) + pad('CPU máx', 10) + 'Créditos cobrados');
for (const region of REGIONS) {
  const ec2 = new EC2Client({ region }), cw = new CloudWatchClient({ region });
  const out = await ec2.send(new DescribeInstancesCommand({}));
  for (const res of out.Reservations || []) for (const i of res.Instances || []) {
    if (i.State?.Name === 'terminated') continue;
    const name = (i.Tags || []).find((t) => t.Key === 'Name')?.Value || i.InstanceId;
    const [h, c, cr] = await Promise.all([
      metric(cw, i.InstanceId, 'CPUUtilization', 7, 3600, ['Average']),
      metric(cw, i.InstanceId, 'CPUUtilization', 14, 86400, ['Average', 'Maximum']),
      /^t\d/.test(i.InstanceType) ? metric(cw, i.InstanceId, 'CPUSurplusCreditsCharged', 14, 86400, ['Sum']) : Promise.resolve(null),
    ]);
    const avg = c.length ? c.reduce((t, x) => t + x.Average, 0) / c.length : null;
    const max = c.length ? Math.max(...c.map((x) => x.Maximum)) : null;
    const credits = cr == null ? 'no aplica' : cr.reduce((t, x) => t + x.Sum, 0).toFixed(1);
    console.log(pad(name.slice(0, 25), 26) + pad(i.InstanceType, 14) + pad(region, 11) + pad(i.State?.Name, 10) + pad(`${h.length}/168`, 10) + pad(avg == null ? '—' : `${avg.toFixed(1)}%`, 10) + pad(max == null ? '—' : `${max.toFixed(0)}%`, 10) + credits);
  }
}

console.log('\n=== Recomendación de Savings Plan (Compute, 1 año, sin pago inicial) ===\n');
const ce = new CostExplorerClient({ region: 'us-east-1' });
for (const [lb, lp] of [['últimos 7 días', 'SEVEN_DAYS'], ['últimos 30 días', 'THIRTY_DAYS']]) {
  try {
    const r = await ce.send(new GetSavingsPlansPurchaseRecommendationCommand({ SavingsPlansType: 'COMPUTE_SP', TermInYears: 'ONE_YEAR', PaymentOption: 'NO_UPFRONT', LookbackPeriodInDays: lp }));
    const s = r.SavingsPlansPurchaseRecommendation?.SavingsPlansPurchaseRecommendationSummary;
    if (!s) { console.log(`${lb}: AWS no tiene recomendación todavía.`); continue; }
    console.log(`${lb}: compromiso ${(+s.HourlyCommitmentToPurchase).toFixed(3)} US$/hora · ahorro ≈ ${(+s.EstimatedMonthlySavingsAmount).toFixed(0)} US$/mes (${(+s.EstimatedSavingsPercentage).toFixed(0)}%) · gasto bajo demanda en ese periodo ≈ ${(+s.CurrentOnDemandSpend).toFixed(0)} US$`);
  } catch (e) { console.log(`${lb}: no se pudo consultar (${e.name}: ${e.message})`); }
}
console.log('\nCómo leer: Horas 7d = 168/168 → corre 24/7 · CPU prom < 10% → servidor sobrado · Créditos cobrados > 0 → esa t3/t3a paga CPU extra (mejor m6a).\n');
