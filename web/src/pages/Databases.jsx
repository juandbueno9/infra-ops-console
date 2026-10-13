// Bases de datos: estado, conexiones, carga, consultas lentas, caché y tamaño.
import { usePolling } from '../hooks/usePolling.js';
import { loadDatabases } from '../lib/db.js';
import { GB, dur } from '../lib/format.js';
import { KpiCard, LineChart } from '../components/charts.jsx';
import { PageHead } from '../components/tables.jsx';
import { Badge, Empty, Meter, Panel, Pulse } from '../components/ui.jsx';

const n = (v, d = 0) => (v == null || isNaN(v) ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: d }));
const pctTxt = (v) => (v == null ? '—' : `${(v * 100).toFixed(v > 0.999 ? 2 : 1)}%`);

function DbCard({ d }) {
  const connPct = d.max ? (d.conn / d.max) * 100 : null;
  const hitTone = d.hit == null ? 'off' : d.hit >= 0.99 ? 'ok' : d.hit >= 0.95 ? 'warn' : 'crit';
  return (
    <section className={`panel p-4 ${!d.up ? 'border-crit/60' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 text-ink font-semibold"><Pulse tone={d.up ? 'ok' : 'crit'} />{d.engine}{d.version && <span className="font-mono text-[11px] text-faint font-normal">{d.version}</span>}</div>
          <div className="font-mono text-[11.5px] text-muted mt-0.5">{d.server}</div>
        </div>
        <Badge tone={d.up ? 'ok' : 'crit'}>{d.up ? `Arriba · ${dur(d.uptime)}` : 'Caída'}</Badge>
      </div>
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1"><span className="text-muted">Conexiones</span><span className="font-mono text-ink">{n(d.conn)} / {n(d.max)}</span></div>
        <Meter value={connPct} base="#1FA9C0" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        <div><dt className="text-faint text-[11px]">{d.engine === 'MySQL' ? 'Consultas / s' : 'Transacciones / s'}</dt><dd className="font-mono text-ink">{n(d.qps, 1)}</dd></div>
        <div><dt className="text-faint text-[11px]">Aciertos de caché</dt><dd className={`font-mono ${hitTone === 'ok' ? 'text-ok' : hitTone === 'warn' ? 'text-warn' : hitTone === 'crit' ? 'text-crit' : 'text-faint'}`}>{pctTxt(d.hit)}</dd></div>
        {d.engine === 'MySQL' ? (
          <>
            <div><dt className="text-faint text-[11px]">Consultas lentas · 1 h</dt><dd className={`font-mono ${d.slow > 10 ? 'text-warn' : 'text-ink'}`}>{n(d.slow)}</dd></div>
            <div><dt className="text-faint text-[11px]">Conexiones rechazadas · 1 h</dt><dd className={`font-mono ${d.aborted > 20 ? 'text-warn' : 'text-ink'}`} title="Intentos de conexión fallidos (clave errada, host no permitido)">{n(d.aborted)}</dd></div>
            <div><dt className="text-faint text-[11px]">Hilos ejecutando</dt><dd className="font-mono text-ink">{n(d.running)}</dd></div>
            <div><dt className="text-faint text-[11px]">Retraso de réplica</dt><dd className="font-mono text-ink">{d.lag == null ? 'Sin réplica' : `${n(d.lag)} s`}</dd></div>
          </>
        ) : (
          <>
            <div><dt className="text-faint text-[11px]">Deadlocks · 1 h</dt><dd className={`font-mono ${d.deadlocks ? 'text-crit' : 'text-ink'}`}>{n(d.deadlocks)}</dd></div>
            <div><dt className="text-faint text-[11px]">Tamaño total</dt><dd className="font-mono text-ink">{GB((d.sizes || []).reduce((t, x) => t + x.bytes, 0))}</dd></div>
          </>
        )}
      </dl>
      {d.sizes?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="text-[11px] text-faint mb-1.5">Bases más grandes</div>
          {d.sizes.slice(0, 5).map((s) => (
            <div key={s.name} className="flex justify-between text-[12px] py-0.5"><span className="font-mono text-ink2">{s.name}</span><span className="font-mono text-muted">{s.bytes >= 1e9 ? GB(s.bytes) : `${(s.bytes / 1048576).toFixed(0)} MB`}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Databases() {
  const { data, loading, error } = usePolling(loadDatabases, 15, []);
  const dbs = data?.dbs || [];
  const down = dbs.filter((d) => !d.up).length;
  const busy = dbs.filter((d) => d.max && d.conn / d.max > 0.8).length;
  return (
    <>
      <PageHead title="Bases de datos" sub="MySQL y PostgreSQL: disponibilidad, conexiones, carga, consultas lentas y caché" />
      {!dbs.length ? (
        <Panel bodyClass="p-5 text-[12.5px] text-ink2 space-y-2">
          <p className="m-0 text-ink font-medium">{loading ? 'Cargando…' : error ? `No se pudo consultar Prometheus: ${error.message}` : 'Todavía no hay bases de datos monitoreadas.'}</p>
          {!loading && !error && <>
            <p className="m-0">En el servidor, crea los usuarios de solo lectura y activa los exportadores:</p>
            <pre className="m-0 bg-bg1 border border-line rounded-lg p-3 font-mono text-[12px] text-ink overflow-x-auto">sudo bash /tmp/infra-stack/crear-usuarios-bd.sh{'\n'}sudo bash /tmp/infra-stack/instalar-stack.sh --bd-mysql --bd-postgres</pre>
            <p className="m-0 text-muted">Los usuarios solo tienen permisos de estadísticas: no pueden leer ni cambiar datos.</p>
          </>}
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
            <KpiCard label="Bases de datos" lead={<Pulse tone={down ? 'crit' : 'ok'} />} value={dbs.length - down} unit={` / ${dbs.length}`} foot={down ? `${down} caída(s)` : 'Todas responden'} />
            <KpiCard label="Cerca del límite de conexiones" lead={<Pulse tone={busy ? 'warn' : 'ok'} />} value={busy} foot="Más del 80 % de max_connections" />
            <KpiCard label="Consultas lentas · 1 h" value={n(dbs.reduce((t, d) => t + (d.slow || 0), 0))} foot="MySQL (slow_query_log)" />
            <KpiCard label="Deadlocks · 1 h" lead={<Pulse tone={dbs.some((d) => d.deadlocks) ? 'crit' : 'ok'} />} value={n(dbs.reduce((t, d) => t + (d.deadlocks || 0), 0))} foot="PostgreSQL" />
          </div>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 mb-4">{dbs.map((d) => <DbCard key={d.engine + d.server} d={d} />)}</div>
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            <Panel title="MySQL · consultas por segundo" meta="6 h" bodyClass="p-3"><LineChart series={data.charts.mysql} label="Consultas/s" max="auto" fmt={(v) => Math.round(v)} tipFmt={(v) => `${v.toFixed(1)} /s`} /></Panel>
            <Panel title="PostgreSQL · transacciones por segundo" meta="6 h" bodyClass="p-3"><LineChart series={data.charts.postgres} label="TPS" max="auto" fmt={(v) => Math.round(v)} tipFmt={(v) => `${v.toFixed(1)} /s`} color="#22D3EE" /></Panel>
          </div>
        </>
      )}
    </>
  );
}
