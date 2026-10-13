// ¿En qué servidor vive cada sitio web? (solo lectura)
//  1) Toma los sitios de las sondas Blackbox (probe_success en Prometheus).
//  2) Resuelve el DNS de cada dominio (IP pública).
//  3) Si hay credenciales AWS, busca qué instancia EC2 tiene esa IP pública (DescribeInstances, solo lectura).
// Caché de 1 hora.
import dns from 'node:dns/promises';
import { config } from './config.js';
import { awsConfigured } from './aws.js';

let memo = null;

async function targets() {
  const r = await fetch(`${config.promUrl}/api/v1/query?query=${encodeURIComponent('probe_success')}`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  return [...new Set((j?.data?.result || []).map((x) => x.metric.instance).filter((t) => /^https?:\/\//.test(t)))];
}

async function ec2ByPublicIp() {
  if (!awsConfigured()) return { map: {}, error: 'Sin credenciales AWS' };
  try {
    const { EC2Client, DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
    const c = new EC2Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const map = {}; let NextToken;
    do {
      const out = await c.send(new DescribeInstancesCommand({ NextToken, MaxResults: 200 }));
      for (const res of out.Reservations || []) for (const i of res.Instances || []) {
        const name = (i.Tags || []).find((t) => t.Key === 'Name')?.Value || i.InstanceId;
        const info = { id: i.InstanceId, name, privateIp: i.PrivateIpAddress || null, publicIp: i.PublicIpAddress || null, state: i.State?.Name };
        for (const ni of i.NetworkInterfaces || []) { const ip = ni.Association?.PublicIp; if (ip) map[ip] = info; }
        if (i.PublicIpAddress) map[i.PublicIpAddress] = info;
      }
      NextToken = out.NextToken;
    } while (NextToken);
    return { map, error: null };
  } catch (e) { return { map: {}, error: e.name === 'UnauthorizedOperation' ? 'La clave AWS no tiene permiso ec2:DescribeInstances' : e.message }; }
}

export async function siteHosts(force = false) {
  if (memo && !force && Date.now() - memo.at < 3600e3) return memo;
  const [list, ec2] = await Promise.all([targets(), ec2ByPublicIp()]);
  const sites = {};
  await Promise.all(list.map(async (t) => {
    let host = ''; try { host = new URL(t).hostname; } catch { /* url inválida */ }
    const ips = host ? await dns.resolve4(host).catch(() => []) : [];
    const server = ips.map((ip) => ec2.map[ip]).find(Boolean) || null;
    sites[t] = { host, ips, server };
  }));
  memo = { at: Date.now(), sites, ec2Error: ec2.error };
  return memo;
}
