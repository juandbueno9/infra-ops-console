// Registro de auditoría de SOLO AGREGAR (append-only).
//  - Un archivo JSON Lines por mes: data/audit/audit-YYYY-MM.jsonl
//  - Nunca se reescribe ni se recorta: cada evento se agrega al final.
//  - Categorías: accion (cambios en el panel), acceso (ingresos al panel), exportacion.
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './config.js';

const DIR = path.join(config.dataDir, 'audit');
const fileFor = (d) => path.join(DIR, `audit-${d.toISOString().slice(0, 7)}.jsonl`);
let chain = Promise.resolve();

/** Agrega un evento al registro. Serializado para no intercalar líneas. */
export function audit({ category, action, host = '', actor, ip = '', detail = '' }) {
  const ev = { at: new Date().toISOString(), category, action, host, actor, ip, detail };
  chain = chain.then(async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.appendFile(fileFor(new Date()), JSON.stringify(ev) + '\n', { mode: 0o640 });
  }).catch((e) => console.error('[audit] no se pudo escribir:', e.message));
  return ev;
}

/** Lee eventos entre dos fechas (ISO), con filtros; devuelve los más recientes primero. */
export async function readAudit({ from, to, category, q, limit = 1000 }) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400e3);
  const months = [];
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(fileFor(d));
  const needle = (q || '').toLowerCase();
  const out = [];
  for (const f of months) {
    if (!existsSync(f)) continue;
    const rl = readline.createInterface({ input: createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const t = new Date(ev.at);
      if (t < start || t > end) continue;
      if (category && ev.category !== category) continue;
      if (needle && !`${ev.action} ${ev.host} ${ev.actor} ${ev.ip} ${ev.detail}`.toLowerCase().includes(needle)) continue;
      out.push(ev);
    }
  }
  return out.reverse().slice(0, Math.min(Number(limit) || 1000, 10000));
}

export const toCsv = (rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return ['fecha,categoria,accion,host,usuario,ip,detalle', ...rows.map((r) => [r.at, r.category, r.action, r.host, r.actor, r.ip, r.detail].map(esc).join(','))].join('\n');
};
