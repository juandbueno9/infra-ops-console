// Detección de clones y suplantación de la página web (solo lectura, sin tocar nada externo):
//  1) Dominios parecidos a "empresa" (errores de tipeo, letras cambiadas, palabras como "pagos" o "sucursal")
//     que estén REGISTRADOS y respondan en DNS.
//  2) Certificados SSL emitidos para cualquier dominio que contenga "empresa" (registro público
//     Certificate Transparency, crt.sh): quien monta un clon con candado verde deja rastro ahí.
//  3) Para cada dominio vivo: se abre su página principal y se revisa si menciona a la empresa y si tiene
//     un formulario de contraseña (señal fuerte de phishing).
// Resultados en caché 12 h (es un chequeo liviano y no conviene repetirlo seguido).
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const BRAND = (process.env.CLONES_BRAND || 'empresa').toLowerCase();
// Dominios propios (no se marcan). Se pueden agregar más en server/.env: CLONES_LEGIT=empresa.com,otro.com
const LEGIT = (process.env.CLONES_LEGIT || 'empresa.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const TTL = 12 * 3600e3;
const CACHE = path.join(config.dataDir, 'clones-cache.json');
const isLegit = (d) => LEGIT.some((l) => d === l || d.endsWith('.' + l));

const KEYS = { a: 'qsz', c: 'xvd', e: 'wrd', f: 'dgrv', i: 'uok', n: 'bmh', o: 'ipl' };
const HOMO = { o: ['0'], i: ['1', 'l'], a: ['4'], e: ['3'], c: ['k'], f: ['ph'] };
const WORDS = ['pagos', 'pago', 'virtual', 'sucursal', 'sucursalvirtual', 'online', 'en-linea', 'seguro', 'app', 'web', 'login', 'portal', 'credito', 'creditos', 'colombia', 'co', 'clientes', 'asociados', 'mi'];
const TLD_TYPO = ['com', 'co', 'com.co', 'net'];
const TLD_COMBO = ['com', 'co', 'com.co', 'online', 'site', 'app'];

export function permutations(b = BRAND) {
  const v = new Set();
  for (let i = 0; i < b.length; i++) {
    v.add(b.slice(0, i) + b.slice(i + 1));                         // omisión: empesa
    v.add(b.slice(0, i) + b[i] + b.slice(i));                       // repetición: emmpresa
    if (i < b.length - 1) v.add(b.slice(0, i) + b[i + 1] + b[i] + b.slice(i + 2)); // transposición
    for (const k of KEYS[b[i]] || '') v.add(b.slice(0, i) + k + b.slice(i + 1));   // tecla vecina
    for (const h of HOMO[b[i]] || []) v.add(b.slice(0, i) + h + b.slice(i + 1));   // parecido visual: 3mpresa
  }
  if (b.length > 4) v.add(b.slice(0, Math.ceil(b.length / 2)) + '-' + b.slice(Math.ceil(b.length / 2)));
  v.delete(b);
  const out = [];
  for (const x of v) for (const t of TLD_TYPO) out.push({ domain: `${x}.${t}`, source: 'typo' });
  for (const w of WORDS) for (const t of TLD_COMBO) { out.push({ domain: `${b}${w}.${t}`, source: 'combo' }, { domain: `${b}-${w}.${t}`, source: 'combo' }, { domain: `${w}${b}.${t}`, source: 'combo' }, { domain: `${w}-${b}.${t}`, source: 'combo' }); }
  for (const t of ['co', 'com.co', 'net', 'org', 'online', 'site', 'app', 'info', 'xyz', 'top', 'lat', 'store']) out.push({ domain: `${b}.${t}`, source: 'tld' });
  return out.filter((x) => !isLegit(x.domain));
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function resolve(domain) {
  const [a, mx, ns] = await Promise.all([
    dns.resolve4(domain).catch(() => []),
    dns.resolveMx(domain).then((r) => r.map((x) => x.exchange)).catch(() => []),
    dns.resolveNs(domain).catch(() => []),
  ]);
  return { ips: a, mx, ns, live: a.length > 0 || mx.length > 0 || ns.length > 0 };
}

async function inspect(domain) {
  for (const proto of ['https', 'http']) {
    try {
      const r = await fetch(`${proto}://${domain}/`, { redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'Mozilla/5.0 (la empresa brand monitor)' } });
      const html = (await r.text()).slice(0, 200000);
      const title = (html.match(/<title[^>]*>([^<]{0,160})/i) || [])[1]?.trim() || '';
      // Evidencia: dónde aparece la marca (texto visible) y enlaces que apuntan a algo con "empresa"
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
      const re = new RegExp(BRAND, 'i'), mi = text.search(re);
      const excerpt = mi >= 0 ? text.slice(Math.max(0, mi - 120), mi + 140).trim() : '';
      const brandLinks = [...new Set([...html.matchAll(/(?:href|src)=["']([^"']*infrancaf[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 6);
      const inCode = mi < 0 && re.test(html); // la marca solo aparece en el código (enlaces, imágenes, scripts)
      const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,200})/i) || [])[1] || '';
      return {
        status: r.status, finalUrl: r.url, title, excerpt, brandLinks, inCode, desc,
        mentionsBrand: new RegExp(BRAND, 'i').test(html),
        hasPassword: /type=["']?password/i.test(html),
        copiesAssets: /empresa\.com\/wp-content/i.test(html), // el clon carga imágenes/estilos del sitio real
        parked: /domain (is )?for sale|parked|sedo|dan\.com|afternic|godaddy.*(parking|auction)|este dominio est[aá] a la venta/i.test(html),
      };
    } catch { /* probar http */ }
  }
  return null;
}

async function certs() {
  try {
    const r = await fetch(`https://crt.sh/?q=${encodeURIComponent('%' + BRAND + '%')}&output=json`, { signal: AbortSignal.timeout(25000) });
    const list = await r.json();
    const m = new Map();
    for (const c of list) for (const n of String(c.name_value || '').split('\n')) {
      const d = n.trim().toLowerCase().replace(/^\*\./, '');
      if (!d || isLegit(d) || !d.includes(BRAND.slice(0, 6))) continue;
      const prev = m.get(d);
      if (!prev || c.not_before < prev.first) m.set(d, { first: c.not_before, issuer: c.issuer_name });
    }
    return { ok: true, list: [...m.entries()].map(([domain, x]) => ({ domain, source: 'cert', certFirst: x.first, issuer: x.issuer })) };
  } catch (e) { return { ok: false, error: e.message, list: [] }; }
}

function risk(x) {
  const h = x.http;
  if (h?.mentionsBrand && h?.hasPassword) return ['crit', 'Usa el nombre la empresa y pide contraseña: posible página de phishing'];
  if (h?.copiesAssets) return ['crit', 'Copia imágenes o estilos de empresa.com: posible clon del sitio'];
  if (h?.mentionsBrand) return ['warn', 'Menciona a la empresa en su página'];
  if (x.source === 'cert' && x.certFirst && Date.now() - Date.parse(x.certFirst) < 30 * 86400e3) return ['warn', 'Certificado SSL emitido hace menos de 30 días para un dominio con "empresa"'];
  if (h?.parked) return ['info', 'Dominio parqueado o a la venta (vigilar)'];
  if (x.mx?.length && !h) return ['warn', 'Tiene correo configurado (MX): podrían enviar correos haciéndose pasar por la empresa'];
  return ['info', h ? `Responde (${h.status})${h.title ? ` · ${h.title.slice(0, 60)}` : ''}` : 'Registrado, sin página'];
}

let memo = null, running = null;
export async function clones(force = false) {
  if (!memo) { try { memo = JSON.parse(await fs.readFile(CACHE, 'utf8')); } catch { memo = null; } }
  if (memo && !force && Date.now() - memo.at < TTL) return { ...memo, fromCache: true };
  if (running) return running;
  running = (async () => {
    try {
      const ct = await certs();
      const cand = new Map();
      for (const x of [...permutations(), ...ct.list]) if (!cand.has(x.domain)) cand.set(x.domain, x); else Object.assign(cand.get(x.domain), x.certFirst ? { certFirst: x.certFirst, issuer: x.issuer, source: cand.get(x.domain).source + '+cert' } : {});
      const all = [...cand.values()];
      const res = await pool(all, 24, async (x) => ({ ...x, ...(await resolve(x.domain)) }));
      const live = res.filter((x) => x.live || x.source.includes('cert'));
      const checked = await pool(live, 8, async (x) => ({ ...x, http: x.ips.length ? await inspect(x.domain) : null }));
      const domains = checked.map((x) => { const [sev, reason] = risk(x); return { ...x, sev, reason }; })
        .sort((a, b) => ({ crit: 0, warn: 1, info: 2 }[a.sev] - { crit: 0, warn: 1, info: 2 }[b.sev]) || a.domain.localeCompare(b.domain));
      memo = { at: Date.now(), brand: BRAND, legit: LEGIT, checked: all.length, certsOk: ct.ok, certsError: ct.error || null, domains };
      await fs.mkdir(config.dataDir, { recursive: true }); await fs.writeFile(CACHE, JSON.stringify(memo));
      return { ...memo, fromCache: false };
    } finally { running = null; }
  })();
  return running;
}
