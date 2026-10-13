// Registro de incidentes: qué pasó, desde cuándo, quién lo atiende, cómo se resolvió.
// Archivo JSON con escritura atómica; cada cambio queda también en la auditoría.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { audit } from './audit.js';

const FILE = path.join(config.dataDir, 'incidents.json');
export const STATUSES = ['abierto', 'investigando', 'mitigado', 'resuelto'];
export const SEVERITIES = ['critica', 'alta', 'media', 'baja'];
let cache = null;
let chain = Promise.resolve();

async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { cache = []; }
  return cache;
}
async function persist() {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
  await fs.rename(tmp, FILE);
}
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const serialize = (fn) => { const run = async () => fn(await load()); chain = chain.then(run, run); return chain; };

export async function listIncidents() {
  return [...(await load())].sort((a, b) => (a.status === 'resuelto') - (b.status === 'resuelto') || (b.startedAt > a.startedAt ? 1 : -1));
}

export function createIncident(body, who) {
  return serialize(async (list) => {
    const title = clean(body.title, 160);
    if (!title) throw Object.assign(new Error('El título es obligatorio'), { status: 400 });
    const severity = SEVERITIES.includes(body.severity) ? body.severity : 'media';
    const now = new Date().toISOString();
    const inc = {
      id: crypto.randomUUID().slice(0, 8), title, severity, service: clean(body.service, 120), source: clean(body.source, 60) || 'manual',
      status: 'abierto', startedAt: body.startedAt && !isNaN(Date.parse(body.startedAt)) ? new Date(body.startedAt).toISOString() : now,
      resolvedAt: null, owner: who.user, createdBy: who.user,
      timeline: [{ at: now, by: who.user, kind: 'creado', text: clean(body.detail, 2000) || 'Incidente abierto' }],
    };
    list.push(inc);
    await persist();
    audit({ category: 'accion', action: `abrió incidente ${inc.id}`, host: inc.service, actor: who.user, ip: who.ip, detail: `${severity} · ${title}` });
    return inc;
  });
}

export function updateIncident(id, body, who) {
  return serialize(async (list) => {
    const inc = list.find((x) => x.id === id);
    if (!inc) throw Object.assign(new Error('Incidente no encontrado'), { status: 404 });
    const now = new Date().toISOString();
    const changes = [];
    if (body.status && body.status !== inc.status) {
      if (!STATUSES.includes(body.status)) throw Object.assign(new Error('Estado inválido'), { status: 400 });
      changes.push(`estado: ${inc.status} → ${body.status}`);
      inc.status = body.status;
      inc.resolvedAt = body.status === 'resuelto' ? now : null;
      inc.timeline.push({ at: now, by: who.user, kind: 'estado', text: `Cambió a «${body.status}»` });
    }
    if (body.owner !== undefined && clean(body.owner, 80) !== inc.owner) {
      inc.owner = clean(body.owner, 80);
      changes.push(`responsable: ${inc.owner}`);
      inc.timeline.push({ at: now, by: who.user, kind: 'responsable', text: `Responsable: ${inc.owner || '—'}` });
    }
    const note = clean(body.note, 2000);
    if (note) { inc.timeline.push({ at: now, by: who.user, kind: 'nota', text: note }); changes.push('nota'); }
    if (body.cause !== undefined) { inc.cause = clean(body.cause, 2000); changes.push('causa raíz'); }
    if (!changes.length) return inc;
    await persist();
    audit({ category: 'accion', action: `actualizó incidente ${inc.id}`, host: inc.service, actor: who.user, ip: who.ip, detail: changes.join(' · ') });
    return inc;
  });
}
