// Carga de datos desde Prometheus (vía /api/prom). Consultas agregadas por instancia: ~30 consultas por refresco, sin importar cuántos hosts haya.
import { NODE_JOBS, DEMO, RANGES, DEFAULT_RANGE } from '../config.js';
import { q, qr, safe } from './api.js';
import { demoFleet, demoDetail } from './demo.js';
import { parseEvents } from './sshEvents.js';

const NET = 'device!~"lo|veth.*|docker.*|br-.*"';
const J = `job=~"${NODE_JOBS}"`;
const byInst = (res) => { const m = {}; res.forEach((x) => (m[x.metric.instance] = +x.value[1])); return m; };
const labInst = (res) => { const m = {}; res.forEach((x) => (m[x.metric.instance] = x.metric)); return m; };
const listInst = (res, key) => { const m = {}; res.forEach((x) => (m[x.metric.instance] ||= []).push(key ? x.metric[key] : x.metric)); return m; };
const num = (res) => (res.length ? +res[0].value[1] : null);
const lab = (res) => (res.length ? res[0].metric : {});

export async function loadFleet(){
  if(DEMO) return demoFleet();
  const Q = {
    up:`up{${J}}`, uname:'node_uname_info', os:'node_os_info', dmi:'node_dmi_info', info:'infra_instance_info',
    cpus:'count by (instance) (node_cpu_seconds_total{mode="idle"})',
    cpu:'100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m]))*100',
    mem:'(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)*100',
    disk:'(1 - node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"})*100',
    diskDays:'(node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} / (-deriv(node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"}[24h])) / 86400) > 0 < 3650',
    l1:'node_load1', l5:'node_load5', boot:'node_boot_time_seconds',
    svcT:'count by (instance) (infra_service_up)', svcD:'infra_service_up == 0',
    ctrT:'count by (instance) (infra_container_running)', ctrR:'sum by (instance) (infra_container_running)',
    ctrU:'infra_container_unhealthy == 1', ctrRs:'infra_container_info{state="restarting"}',
    sec:'infra_apt_security_pending', upd:'infra_apt_upgrades_pending', pkgs:'infra_apt_package_pending', rbPkgs:'infra_reboot_required_pkg', reboot:'infra_reboot_required', ssh:'infra_ssh_failed_logins_24h', sshcfg:'infra_ssh_config',
    pub:'infra_listening_port{scope="public"}', sess:'infra_user_session', logins:'infra_ssh_logins_24h', tfage:'time() - max by (instance) (node_textfile_mtime_seconds)',
    web:'max_over_time(probe_success{job=~"blackbox_http.*"}[1m])', webDur:'probe_duration_seconds{job=~"blackbox_http.*"}', webSsl:'probe_ssl_earliest_cert_expiry{job=~"blackbox_http.*"} - time()', webCode:'probe_http_status_code{job=~"blackbox_http.*"}'
  };
  const keys = Object.keys(Q);
  const res = await Promise.all(keys.map(k => k==='up' ? q(Q[k]) : safe(q(Q[k]))));
  const R = Object.fromEntries(keys.map((k,i)=>[k,res[i]]));
  const spark = await safe(qr('100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m]))*100', 60, 60));
  const up=byInst(R.up), uname=labInst(R.uname), os=labInst(R.os), dmi=labInst(R.dmi), info=labInst(R.info), sshcfg=labInst(R.sshcfg);
  const M = k => byInst(R[k]);
  const cpus=M('cpus'), cpu=M('cpu'), mem=M('mem'), disk=M('disk'), diskDays=M('diskDays'), l1=M('l1'), l5=M('l5'), boot=M('boot'),
        svcT=M('svcT'), ctrT=M('ctrT'), ctrR=M('ctrR'), sec=M('sec'), upd=M('upd'), reboot=M('reboot'), ssh=M('ssh'), tfage=M('tfage');
  const pkgL=listInst(R.pkgs), rbL=listInst(R.rbPkgs), svcD=listInst(R.svcD,'service'), ctrU=listInst(R.ctrU,'name'), ctrRs=listInst(R.ctrRs,'name'), pub=listInst(R.pub), sessL=listInst(R.sess), logL=listInst(R.logins);
  R.logins.forEach(x=>x.metric.count=+x.value[1]);
  const sp={}; spark.forEach(x => sp[x.metric.instance] = x.values.map(v=>+v[1]));
  const rng1 = e => safe(qr(e,120,240)).then(r => r[0] ? r[0].values.map(v=>+v[1]) : []);
  const [kCpu,kMem,kLat,kErr] = await Promise.all([
    rng1('avg(100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))*100)'),
    rng1('avg((1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)*100)'),
    rng1('avg(probe_duration_seconds{job=~"blackbox_http.*"})*1000'),
    rng1('(1 - avg(avg_over_time(probe_success{job=~"blackbox_http.*"}[10m])))*100')]);
  const servers = Object.keys(up).sort().map(inst => ({
    inst, up:up[inst], host:(info[inst]||{}).hostname || inst, iid:(info[inst]||{}).instance_id, ip:(info[inst]||{}).private_ip, itype:(dmi[inst]||{}).product_name, az:(info[inst]||{}).az,
    cpus:cpus[inst], cpu:cpu[inst], memP:mem[inst], fsP:disk[inst], diskDays:diskDays[inst] ?? null, load:[l1[inst],l5[inst]], boot:boot[inst],
    svcTotal:svcT[inst], svcDown:svcD[inst]||[], ctrTotal:ctrT[inst], ctrRunning:ctrR[inst], ctrBad:[...new Set([...(ctrU[inst]||[]),...(ctrRs[inst]||[])])],
    sec:sec[inst], upd:upd[inst], pkgs:(pkgL[inst]||[]).map(m=>({name:m.name, version:m.version, security:m.security==='1'})), rebootPkgs:(rbL[inst]||[]).map(m=>m.name), reboot:reboot[inst], ssh:ssh[inst], sshcfg:sshcfg[inst], tfage:tfage[inst],
    ports:(pub[inst]||[]).map(m => ({port:+m.port, scope:m.scope, app:m.app})), spark:sp[inst]||[],
    sessions:(sessL[inst]||[]).map(m=>({user:m.user,tty:m.tty,from:m.from,key:m.key})), logins:(logL[inst]||[]).map(m=>({user:m.user,from:m.from,method:m.method,key:m.key,count:m.count}))
  }));
  const f = (arr,t) => { const m = arr.find(y=>y.metric.instance===t); return m ? +m.value[1] : null; };
  const web = R.web.map(x => ({target:x.metric.instance, ok:+x.value[1], dur:f(R.webDur,x.metric.instance), ssl:f(R.webSsl,x.metric.instance), code:f(R.webCode,x.metric.instance)}));
  return {servers, web, kpi:{cpu:kCpu, mem:kMem, lat:kLat, err:kErr}};
}

export async function loadDetail(inst, range = DEFAULT_RANGE){
  if(DEMO) return demoDetail(inst);
  const RG = RANGES[range] || RANGES[DEFAULT_RANGE], W = RG.win;
  const L = `instance="${inst.replace(/"/g,'')}"`;
  const Q = {
    up:`up{${L}}`, uname:`node_uname_info{${L}}`, os:`node_os_info{${L}}`, dmi:`node_dmi_info{${L}}`, info:`infra_instance_info{${L}}`,
    cpus:`count(node_cpu_seconds_total{mode="idle",${L}})`, cpu:`100 - avg(rate(node_cpu_seconds_total{mode="idle",${L}}[1m]))*100`,
    memT:`node_memory_MemTotal_bytes{${L}}`, memA:`node_memory_MemAvailable_bytes{${L}}`, swT:`node_memory_SwapTotal_bytes{${L}}`, swF:`node_memory_SwapFree_bytes{${L}}`,
    fsS:`node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs",${L}}`, fsA:`node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs",${L}}`,
    boot:`node_boot_time_seconds{${L}}`, l1:`node_load1{${L}}`, l5:`node_load5{${L}}`, l15:`node_load15{${L}}`,
    svc:`infra_service_up{${L}}`, ssh:`infra_ssh_failed_logins_24h{${L}}`, sshcfg:`infra_ssh_config{${L}}`, users:`infra_users_logged_in{${L}}`,
    upd:`infra_apt_upgrades_pending{${L}}`, sec:`infra_apt_security_pending{${L}}`, reboot:`infra_reboot_required{${L}}`,
    ports:`infra_listening_port{${L}}`, tfage:`time() - max(node_textfile_mtime_seconds{${L}})`,
    diskGrow:`-deriv(node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs",${L}}[24h])`,
    sess:`infra_user_session{${L}}`, logins:`infra_ssh_logins_24h{${L}}`, loginLast:`infra_ssh_login_last_seconds{${L}}`, events:`infra_ssh_event{${L}}`,
    ctrI:`infra_container_info{${L}}`, ctrS:`infra_container_started_seconds{${L}}`, ctrRc:`infra_container_restarts_total{${L}}`,
    rx:`sum(rate(infra_net_receive_bytes_total{${NET},${L}}[3m]))`, tx:`sum(rate(infra_net_transmit_bytes_total{${NET},${L}}[3m]))`,
    dr:`sum(rate(node_disk_read_bytes_total{${L}}[1m]))`, dw:`sum(rate(node_disk_written_bytes_total{${L}}[1m]))`
  };
  const keys = Object.keys(Q);
  const res = await Promise.all(keys.map(k => safe(q(Q[k]))));
  const R = Object.fromEntries(keys.map((k,i)=>[k,res[i]]));
  const rng = (e,m,s) => safe(qr(e,m,s)).then(r => r[0] ? r[0].values.map(v=>[+v[0],+v[1]]) : []);
  const [chCpu, chMem, spNet, spDisk, spLoad] = await Promise.all([
    rng(`100 - avg(rate(node_cpu_seconds_total{mode="idle",${L}}[${W}]))*100`, RG.mins, RG.step),
    rng(`(1 - node_memory_MemAvailable_bytes{${L}} / node_memory_MemTotal_bytes{${L}})*100`, RG.mins, RG.step),
    rng(`sum(rate(infra_net_receive_bytes_total{${NET},${L}}[3m]) + rate(infra_net_transmit_bytes_total{${NET},${L}}[3m]))`, 30, 60),
    rng(`sum(rate(node_disk_read_bytes_total{${L}}[1m]) + rate(node_disk_written_bytes_total{${L}}[1m]))`, 30, 30),
    rng(`node_load1{${L}}`, 30, 15)]);
  const cpuHour = await safe(qr(`100 - avg(rate(node_cpu_seconds_total{mode="idle",${L}}[1m]))*100`, 62, 60)).then(r => r[0] ? r[0].values.map(v=>+v[1]) : []);
  const memHour = await safe(qr(`(1 - node_memory_MemAvailable_bytes{${L}} / node_memory_MemTotal_bytes{${L}})*100`, 62, 60)).then(r => r[0] ? r[0].values.map(v=>+v[1]) : []);
  const kv = arr => Object.fromEntries(arr.map(x => [x.metric.name, +x.value[1]]));
  const started = kv(R.ctrS), restarts = kv(R.ctrRc);
  const ctr = R.ctrI.map(x => ({name:x.metric.name, image:x.metric.image, state:x.metric.state, health:x.metric.health,
    started:started[x.metric.name], restarts:restarts[x.metric.name]})).sort((a,b)=>a.name.localeCompare(b.name));
  const lkey = m => m.user+'|'+m.from+'|'+m.method+'|'+(m.key||''), lastMap = Object.fromEntries(R.loginLast.map(x=>[lkey(x.metric), +x.value[1]]));
  const sessions = R.sess.map(x=>({user:x.metric.user, tty:x.metric.tty, from:x.metric.from, key:x.metric.key, since:+x.value[1]})).sort((a,b)=>b.since-a.since);
  const logins = R.logins.map(x=>({user:x.metric.user, from:x.metric.from, method:x.metric.method, key:x.metric.key, count:+x.value[1], last:lastMap[lkey(x.metric)]})).sort((a,b)=>(b.last||0)-(a.last||0));
  const memT=num(R.memT), memA=num(R.memA), fsS=num(R.fsS), fsA=num(R.fsA), svc=R.svc.map(x=>({name:x.metric.service, up:+x.value[1]}));
  return {
    inst, up:num(R.up), uname:lab(R.uname), os:lab(R.os).pretty_name, itype:lab(R.dmi).product_name, info:lab(R.info),
    cpus:num(R.cpus), cpu:num(R.cpu), memT, memA, memP: memT ? (1-memA/memT)*100 : null, swT:num(R.swT), swF:num(R.swF),
    fsS, fsA, fsP: fsS ? (1-fsA/fsS)*100 : null, boot:num(R.boot), load:[num(R.l1),num(R.l5),num(R.l15)],
    svc, svcTotal:svc.length, svcDown:svc.filter(s=>!s.up).map(s=>s.name),
    ctr, ctrBad:ctr.filter(c=>c.health==='unhealthy'||c.state==='restarting').map(c=>c.name),
    ssh:num(R.ssh), sshcfg:R.sshcfg.length?lab(R.sshcfg):null, users:num(R.users), upd:num(R.upd), sec:num(R.sec), reboot:num(R.reboot), tfage:num(R.tfage),
    ports:R.ports.map(x=>({port:+x.metric.port, scope:x.metric.scope, app:x.metric.app})),
    diskDays: (()=>{ const g=num(R.diskGrow); return g && g>0 && fsA ? fsA/g/86400 : null; })(),
    sessions, logins, sshEvents:parseEvents(R.events, ()=>lab(R.info).hostname||inst), range, cpuHour, memHour, rx:num(R.rx), tx:num(R.tx), dr:num(R.dr), dw:num(R.dw), chCpu, chMem, spNet, spDisk, spLoad
  };
}

