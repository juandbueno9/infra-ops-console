// Bases de datos: MySQL (mysqld_exporter) y PostgreSQL (postgres_exporter).
import { DEMO } from '../config.js';
import { q, qr, safe } from './api.js';

const one = (res) => (res && res[0] ? +res[0].value[1] : null);
const by = (res, l = 'servidor') => Object.fromEntries((res || []).map((x) => [x.metric[l] || x.metric.instance, +x.value[1]]));
const series = (res) => (res && res[0] ? res[0].values.map(([t, v]) => [+t, +v]) : []);

export async function loadDatabases() {
  if (DEMO) return demoDb();
  const M = 'job="infra-mysql"', P = 'job="infra-postgres"';
  const Q = {
    myUp: `mysql_up{${M}}`, myUptime: `mysql_global_status_uptime{${M}}`, myConn: `mysql_global_status_threads_connected{${M}}`,
    myMax: `mysql_global_variables_max_connections{${M}}`, myRun: `mysql_global_status_threads_running{${M}}`,
    myQps: `rate(mysql_global_status_queries{${M}}[5m])`, mySlow: `increase(mysql_global_status_slow_queries{${M}}[1h])`,
    myAborted: `increase(mysql_global_status_aborted_connects{${M}}[1h])`,
    myHit: `1 - rate(mysql_global_status_innodb_buffer_pool_reads{${M}}[5m]) / clamp_min(rate(mysql_global_status_innodb_buffer_pool_read_requests{${M}}[5m]), 1)`,
    myLag: `mysql_slave_status_seconds_behind_master{${M}}`, myVer: `mysql_version_info{${M}}`,
    pgUp: `pg_up{${P}}`, pgStart: `pg_postmaster_start_time_seconds{${P}}`, pgConn: `sum by (servidor) (pg_stat_activity_count{${P}})`,
    pgMax: `max by (servidor) (pg_settings_max_connections{${P}})`, pgTps: `sum by (servidor) (rate(pg_stat_database_xact_commit{${P}}[5m]) + rate(pg_stat_database_xact_rollback{${P}}[5m]))`,
    pgDead: `sum by (servidor) (increase(pg_stat_database_deadlocks{${P}}[1h]))`,
    pgHit: `sum by (servidor) (rate(pg_stat_database_blks_hit{${P}}[5m])) / clamp_min(sum by (servidor) (rate(pg_stat_database_blks_hit{${P}}[5m]) + rate(pg_stat_database_blks_read{${P}}[5m])), 1)`,
    pgSizes: `pg_database_size_bytes{${P},datname!~"template.*"}`, pgVer: `pg_static{${P}}`,
  };
  const keys = Object.keys(Q);
  const res = await Promise.all(keys.map((k) => safe(q(Q[k]))));
  const R = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
  const mysql = R.myUp.map((x) => {
    const s = x.metric.servidor || x.metric.instance, g = (k) => by(R[k])[s] ?? null;
    return { engine: 'MySQL', server: s, up: +x.value[1] === 1, version: (R.myVer.find((v) => (v.metric.servidor || v.metric.instance) === s) || {}).metric?.version,
      uptime: g('myUptime'), conn: g('myConn'), max: g('myMax'), running: g('myRun'), qps: g('myQps'), slow: g('mySlow'), aborted: g('myAborted'), hit: g('myHit'), lag: g('myLag') };
  });
  const now = Date.now() / 1000;
  const postgres = R.pgUp.map((x) => {
    const s = x.metric.servidor || x.metric.instance, g = (k) => by(R[k])[s] ?? null;
    return { engine: 'PostgreSQL', server: s, up: +x.value[1] === 1, version: (R.pgVer.find((v) => (v.metric.servidor || v.metric.instance) === s) || {}).metric?.short_version,
      uptime: g('pgStart') ? now - g('pgStart') : null, conn: g('pgConn'), max: g('pgMax'), qps: g('pgTps'), deadlocks: g('pgDead'), hit: g('pgHit'),
      sizes: R.pgSizes.filter((d) => (d.metric.servidor || d.metric.instance) === s).map((d) => ({ name: d.metric.datname, bytes: +d.value[1] })).sort((a, b) => b.bytes - a.bytes) };
  });
  const [myQpsS, pgTpsS] = await Promise.all([
    safe(qr(`sum(rate(mysql_global_status_queries{${M}}[5m]))`, 360, 120)).then(series),
    safe(qr(`sum(rate(pg_stat_database_xact_commit{${P}}[5m]))`, 360, 120)).then(series),
  ]);
  return { dbs: [...mysql, ...postgres], charts: { mysql: myQpsS, postgres: pgTpsS } };
}

function demoDb() {
  const now = Date.now() / 1000, s = (b, a) => Array.from({ length: 180 }, (_, k) => [now - (180 - k) * 120, b + a * Math.abs(Math.sin(k / 12)) + (k % 37 === 0 ? a : 0)]);
  return {
    dbs: [
      { engine: 'MySQL', server: 'app-server', up: true, version: '8.0.39', uptime: 86400 * 2.7, conn: 38, max: 151, running: 3, qps: 412.6, slow: 14, aborted: 57, hit: 0.9987, lag: null },
      { engine: 'MySQL', server: 'core-database', up: true, version: '8.0.36', uptime: 86400 * 21, conn: 128, max: 151, running: 9, qps: 1880.2, slow: 3, aborted: 0, hit: 0.962, lag: 0 },
      { engine: 'PostgreSQL', server: 'app-server', up: true, version: '16.4', uptime: 86400 * 2.7, conn: 22, max: 100, qps: 96.1, deadlocks: 0, hit: 0.994,
        sizes: [{ name: 'contabilidad', bytes: 6.2e9 }, { name: 'consultas', bytes: 1.4e9 }, { name: 'keycloak', bytes: 3.1e8 }, { name: 'postgres', bytes: 8e6 }] },
    ],
    charts: { mysql: s(900, 1400), postgres: s(60, 90) },
  };
}
