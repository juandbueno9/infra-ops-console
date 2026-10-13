// Estado compartido por todo el equipo: hosts ocultos, silencios y auditoría.
// Se guarda en un JSON con escritura atómica (archivo temporal + rename).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { audit } from './audit.js';

const FILE = path.join(config.dataDir, 'state.json');
const EMPTY = { hidden: {}, silenced: {}, aliases: {}, portRules: {}, audit: [] };
let cache = null;
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = { ...EMPTY, ...JSON.parse(await fs.readFile(FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] estado ilegible, se inicia vacío:', err.message);
    cache = structuredClone(EMPTY);
  }
  return cache;
}

async function persist() {
  await fs.mkdir(config.dataDir, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
  await fs.rename(tmp, FILE);
}

/** Aplica un cambio de forma serializada y deja registro en la auditoría. */
export async function mutate(action, host, who, fn) {
  const actor = who.user, ip = who.ip;
  const run = async () => {
    const s = await load();
    fn(s);
    audit({ category: 'accion', action, host, actor, ip });
    s.audit.unshift({ at: new Date().toISOString(), action, host, actor: `${actor} (${ip})` });
    s.audit = s.audit.slice(0, 500);
    await persist();
    return publicState(s);
  };
  writing = writing.then(run, run);
  return writing;
}

export async function getState() {
  return publicState(await load());
}

function publicState(s) {
  const now = Date.now();
  const silenced = Object.fromEntries(
    Object.entries(s.silenced).filter(([, v]) => v.until > now).map(([k, v]) => [k, v]),
  );
  return { hidden: s.hidden, silenced, aliases: s.aliases || {}, portRules: s.portRules || {}, audit: s.audit.slice(0, 50) };
}
