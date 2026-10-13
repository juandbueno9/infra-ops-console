// Revisión de las VPN Site-to-Site de AWS (SOLO LECTURA: no cambia nada).
// Uso (desde la carpeta server):  node scripts/revisar-vpn.mjs
import 'dotenv/config';
import { EC2Client, DescribeVpnConnectionsCommand, DescribeCustomerGatewaysCommand } from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({ region: process.env.AWS_REGION || 'us-east-1' });
const list = (a) => (a && a.length ? a.map((x) => x.Value).join(', ') : 'por defecto (acepta todos, incluidos los débiles)');
const fmt = (d) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—');

const noPerm = (e) => e?.name === 'UnauthorizedOperation' || e?.Code === 'UnauthorizedOperation';
let vpns = [], cgws = [];
try { vpns = (await ec2.send(new DescribeVpnConnectionsCommand({}))).VpnConnections || []; } catch (e) {
  if (!noPerm(e)) throw e;
  console.log('\nLa clave de AWS del panel (usuario de facturación) no tiene permiso para ver las VPN (ec2:DescribeVpnConnections).');
  console.log('Opciones: correr el comando de una línea en app-server, o darle a ese usuario el permiso de solo lectura AmazonEC2ReadOnlyAccess.\n');
  process.exit(0);
}
try { cgws = (await ec2.send(new DescribeCustomerGatewaysCommand({}))).CustomerGateways || []; } catch (e) { if (!noPerm(e)) throw e; }
if (!vpns.length) console.log('No hay conexiones VPN en esta región.');
for (const v of vpns.filter((x) => x.State !== 'deleted')) {
  const name = (v.Tags || []).find((t) => t.Key === 'Name')?.Value || v.VpnConnectionId;
  const cg = cgws.find((c) => c.CustomerGatewayId === v.CustomerGatewayId);
  console.log(`\n================ ${name} (${v.VpnConnectionId}) ================`);
  console.log(`Estado: ${v.State} · Rutas: ${v.Options?.StaticRoutesOnly ? 'estáticas' : 'BGP'} · Equipo del cliente: ${cg?.IpAddress || '—'}${cg?.Tags?.find((t) => t.Key === 'Name') ? ` (${cg.Tags.find((t) => t.Key === 'Name').Value})` : ''}`);
  console.log(`Red local (lado cliente): ${v.Options?.LocalIpv4NetworkCidr || '—'} · Red remota (lado AWS): ${v.Options?.RemoteIpv4NetworkCidr || '—'}`);
  if (v.Routes?.length) console.log(`Rutas estáticas: ${v.Routes.map((r) => `${r.DestinationCidrBlock} (${r.State})`).join(', ')}`);
  console.log('\nTúneles:');
  for (const t of v.VgwTelemetry || []) console.log(`  ${t.OutsideIpAddress.padEnd(16)} ${t.Status === 'UP' ? '✅ ARRIBA' : '❌ ABAJO '}  desde ${fmt(t.LastStatusChange)}  ${t.StatusMessage || ''}`);
  console.log('\nCifrado configurado en AWS:');
  for (const o of v.Options?.TunnelOptions || []) {
    console.log(`  Túnel ${o.OutsideIpAddress}:`);
    console.log(`    IKE: ${list(o.IkeVersions)}`);
    console.log(`    Fase 1: cifrado ${list(o.Phase1EncryptionAlgorithms)} · hash ${list(o.Phase1IntegrityAlgorithms)} · DH ${list(o.Phase1DHGroupNumbers)}`);
    console.log(`    Fase 2: cifrado ${list(o.Phase2EncryptionAlgorithms)} · hash ${list(o.Phase2IntegrityAlgorithms)} · DH ${list(o.Phase2DHGroupNumbers)}`);
    console.log(`    Inicio: ${o.StartupAction || 'add (espera al cliente)'} · Si cae (DPD): ${o.DpdTimeoutAction || 'clear'}`);
  }
}
console.log('\nNota: AWS mantiene un solo par de selectores (una fase 2) por túnel. Si el FortiGate tiene varios selectores, solo uno queda arriba a la vez.\n');
