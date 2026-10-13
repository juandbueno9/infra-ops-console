import { demoEvents } from './sshEvents.js';
// Datos simulados de 9 servidores para desarrollar sin conexión (npm run dev:demo o ?demo)
function rnd(seed){ const x = Math.sin(seed)*10000; return x-Math.floor(x); }
const DEMO_SRV = ['app-server','core-fineract','core-staging','core-gravitee','core-database','core-inhouse','historic-db2','empresa-web','empresa-backup'];
export function demoDetail(inst){
  const i = Math.max(0, DEMO_SRV.indexOf(inst)), now = Date.now()/1000, isApp = i===0, down = inst==='empresa-backup';
  const series = (base,amp,n=180,step=120) => Array.from({length:n},(_,k)=>[now-(n-k)*step, Math.max(0,Math.min(100, base+amp*Math.sin(k/9+i)+amp*.5*rnd(k+i*7)))]);
  const svcN = isApp ? ['nginx','apache2','docker','mysql','postgresql','php8.3-fpm','pm2-ubuntu'] : i===4||i===6 ? ['mysql','docker'] : ['nginx','docker','tomcat9'];
  const ctr = isApp ? [['fcems_docker-fos-1','fortinet/fcems-fos:7.4','running','none'],['fcems_docker-scep-1','fortinet/fcems-scep:7.4','running','none'],['fcems_docker-nginx-1','nginx:1.27','running','healthy'],['infra-vaultwarden','vaultwarden/server:latest','running','healthy'],['prometheus','prom/prometheus:latest','running','none'],['grafana','grafana/grafana-enterprise:latest','running','healthy'],['node-exporter','prom/node-exporter:latest','running','none'],['alertmanager','prom/alertmanager:v0.27.0','running','none'],['nginx-proxy','nginx:latest','exited','none']]
    : i===1 ? [['fineract','apache/fineract:1.9','running','healthy'],['fineract-ui','openmf/web-app:latest','running','none'],['redis','redis:7','running','healthy']]
    : i===3 ? [['gravitee-gateway','graviteeio/apim-gateway:4.4','running','healthy'],['gravitee-mgmt','graviteeio/apim-management-api:4.4','running','unhealthy'],['mongodb','mongo:6','running','healthy']] : [];
  const ports = isApp ? [[22,'public','ssh'],[80,'public','nginx'],[443,'public','nginx'],[1433,'public','mssql-server'],[3000,'public','pm2-ubuntu'],[3306,'public','mysql'],[8013,'public','fcems_docker-fos-1'],[8015,'public','fcems_docker-fos-1'],[8444,'public','apache2'],[8445,'public','infra-vaultwarden'],[3012,'public','infra-vaultwarden'],[8097,'public','core-api'],[14001,'public','fcems_docker-scep-1'],[14002,'public','fcems_docker-scep-1'],[18080,'public','fcems_docker-nginx-1'],[18443,'public','fcems_docker-nginx-1'],[60000,'public','fcems_docker-fos-1'],[5432,'local','postgresql'],[3001,'local','grafana'],[9090,'local','prometheus'],[53,'local','systemd-resolved'],[7080,'private','apache2'],[8010,'private','php8.3-fpm']]
    : i===4 ? [[22,'public','ssh'],[3306,'public','mysql'],[9100,'private','prometheus-node-exporter']]
    : [[22,'public','ssh'],[80,'public','nginx'],[443,'public','nginx'],[8080,'private','tomcat9'],[9100,'private','prometheus-node-exporter'],...(i===2?[[8081,'public','tomcat9']]:[])];
  const memT=[34e9,16e9,8e9,16e9,32e9,8e9,16e9,4e9,8e9][i], fsS=[207e9,100e9,50e9,80e9,500e9,60e9,300e9,30e9,1000e9][i];
  const fsP=[61,48,72,55,87,41,93,35,20][i], cpu=[58.7,32,12,24,44,8,15,6,0][i], memP=[48,71,39,62,82,27,55,44,0][i];
  const sshEvents = demoEvents(inst, inst, i);
  if (sshEvents[0] && !down) sshEvents.find(e=>e.kind==='login'&&!e.end).ts = now-3600*(i+1);
  return {diskDays: [48, null, 19, 230, 6.5, null, 3.2, null, null][i], sshEvents, inst, up: down?0:1, uname:{release:'6.8.0-1017-aws'}, os:'Ubuntu 24.04.5 LTS', itype:['t3a.2xlarge','t3.xlarge','t3.large','t3.xlarge','r6i.xlarge','t3.large','t3.xlarge','t3.medium','t3.large'][i],
    info:{hostname:inst,instance_id:'i-0'+Math.floor(rnd(i+1)*1e15).toString(16).padStart(16,'0'),az:'us-east-1'+'abc'[i%3],private_ip:`172.31.${30+i}.${10+i*7}`,public_ip:i%2?'':`44.205.${100+i}.${20+i}`},
    cpus:[8,4,2,4,4,2,4,2,2][i], cpu, memT, memA:memT*(1-memP/100), memP, swT:i===4?4e9:0, swF:3.2e9, fsS, fsA:fsS*(1-fsP/100), fsP, boot:now-86400*(2+i*5)-3600*i,
    load:[[7.46,8.67,7.94],[1.2,1.4,1.3],[.2,.3,.3],[.9,1.1,1],[2.1,2.4,2.2],[.1,.1,.1],[.4,.5,.5],[.05,.1,.1],[0,0,0]][i],
    svc:svcN.map(n=>({name:n,up: i===2&&n==='tomcat9'?0:1})), svcTotal:svcN.length, svcDown: i===2?['tomcat9']:[],
    ctr:ctr.map(([n,im,st,h],k)=>({name:n,image:im,state:st,health:h,started:now-86400*(1+k)-3600*k,restarts:h==='unhealthy'?14:k%3})),
    ctrBad:ctr.filter(c=>c[3]==='unhealthy').map(c=>c[0]),
    ssh:[0,3,0,12,0,0,64,1,0][i], sshcfg:{port:'22',password_auth:i===6?'yes':'no',root_login:'no',pubkey:'yes'}, users:i%3, upd:[1,0,4,2,0,0,9,1,0][i], sec:[1,0,2,1,0,0,5,0,0][i], reboot:i===6?1:0, tfage:i===5?900:30+i,
    sessions: down?[]:[{user:'ubuntu',tty:'pts/0',from:'203.0.113.10',key:'juan@macbook-pro',since:now-3600*(i+1)},...(i===3?[{user:'deploy',tty:'pts/1',from:'203.0.113.21',key:'llave desconocida',since:now-900}]:[])],
    logins: down?[]:[{user:'ubuntu',from:'203.0.113.10',method:'publickey',key:'juan@macbook-pro',count:3+i,last:now-3600},{user:'ubuntu',from:'203.0.113.10',method:'publickey',key:'carlos.ops@thinkpad',count:2,last:now-5400},...(i===3?[{user:'deploy',from:'203.0.113.21',method:'publickey',key:'llave desconocida',count:1,last:now-900}]:[]),...(i===6?[{user:'admin',from:'172.31.40.2',method:'password',count:2,last:now-7200}]:[])],
    ports:ports.map(([port,scope,app])=>({port,scope,app})), rx:18000*(i+1), tx:1400*(i+2), dr:600*(i+1), dw:250000/(i+1),
    chCpu:series(cpu,cpu*.25,240,15), chMem:series(memP,4,240,15), cpuHour:series(cpu,cpu*.25,62,60).map(x=>x[1]), memHour:series(memP,4,62,60).map(x=>x[1]), spNet:series(30,15,30,60), spDisk:series(40,20,30,60), spLoad:series(50,25,30,60)};
}
export function demoFleet(){
  const servers = DEMO_SRV.map(inst => { const d = demoDetail(inst);
    return {inst, up:d.up, host:inst, iid:d.info.instance_id, ip:d.info.private_ip, itype:d.itype, az:d.info.az, cpus:d.cpus, cpu:d.up?d.cpu:null, memP:d.up?d.memP:null, fsP:d.up?d.fsP:null, load:d.up?d.load:null, boot:d.up?d.boot:null,
      svcTotal:d.svcTotal, svcDown:d.svcDown, ctrTotal:d.ctr.length, ctrRunning:d.ctr.filter(c=>c.state==='running').length, ctrBad:d.ctrBad,
      diskDays:d.diskDays, sec:d.sec, upd:d.upd, pkgs:[['libssl3t64',1],['openssh-server',1],['linux-image-aws',1],['containerd.io',0],['curl',0],['vim',0],['tzdata',0],['python3-urllib3',1],['nginx',0]].slice(0,d.upd||0).map(([name,s])=>({name,version:'1.0',security:!!s})), rebootPkgs:d.reboot?['linux-image-aws']:[], reboot:d.reboot, ssh:d.ssh, sshcfg:d.sshcfg, tfage:d.tfage, sessions:d.sessions, logins:d.logins, ports:d.ports.filter(p=>p.scope==='public'), spark:d.up?d.cpuHour:[]}; });
  const web = [['https://empresa.com/',1,.31,86400*54,200],['https://monitoreo.empresa.com/',1,.12,86400*63,200],['https://vault.empresa.com/',1,.18,86400*12,200],['https://crm.empresa.com/',1,.44,86400*80,200],['https://stg-api.empresa.com/',0,5,86400*5,502]]
    .map(([target,ok,dur,ssl,code])=>({target,ok,dur,ssl,code}));
  const now=Date.now()/1000, ser=(b,a,s)=>Array.from({length:30},(_,k)=>Math.max(0,b+a*Math.sin(k/4+s)+a*.4*rnd(k+s)));
  return {servers, web, kpi:{cpu:ser(28,5,1), mem:ser(52,3,2), lat:ser(260,60,3), err:ser(12,6,4)}};
}
