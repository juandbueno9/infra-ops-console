// Rack de servidores en 3D: un gabinete de 42U donde cada equipo conectado al monitoreo ocupa 2U
// con su nombre en el frente, LED de estado y mini barras de CPU · Memoria · Disco.
//  - Los espacios libres se ven como paneles ciegos: al conectar un servidor nuevo, aparece en el siguiente hueco.
//  - Los equipos detectados en las últimas 24 h llevan la etiqueta NUEVO.
//  - Más de 19 equipos → se agrega otro gabinete.
// items: [{ id, label, tone, href?, onClick?, kind: 'aws'|'azure'|'server'|'nas', sub, values: { cpu, mem, disk }, note, isNew }]
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Frame, TONE_HEX, clearGroup, useStage } from './Charts3D.jsx';

const U = 0.11, NU = 42, PER = 19, W = 2.2, D = 1.4, BASE = 0.16, IH = U * NU, H = IH + BASE + 0.16, RW = 1.86, SX = 3.0;
const LED = { ok: 0x22c55e, warn: 0xf59e0b, crit: 0xef4444, off: 0x334155 };
const KIND = { aws: 'AWS', azure: 'Azure', nas: 'NAS Synology', server: 'Servidor', windows: 'Windows' };

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}
const barCol = (v) => (v == null ? '#475569' : v >= 90 ? '#ef4444' : v >= 75 ? '#f59e0b' : null);

const ACCENT = { aws: '#FF9900', azure: '#2F8FE8', nas: '#A3E635', server: '#5AB8FF', windows: '#2F8FE8' };
const BAY_COL = { ok: '#22c55e', warn: '#f59e0b', crit: '#ef4444', off: '#1f2937' };
/** Alto en U de cada tipo de equipo dentro del rack. */
export const unitsOf = (it) => (it.kind === 'nas' ? 3 : 2);

// Frente del NAS (3U): 8 bahías de disco con su LED, nombre y uso
function drawNas(f, it) {
  const { g, c } = f, w = c.width, h = c.height;
  g.fillStyle = '#121418'; g.fillRect(0, 0, w, h);
  for (const x of [0, w - 26]) { g.fillStyle = '#3f4650'; g.fillRect(x, 0, 26, h); g.fillStyle = '#9ca3af'; g.beginPath(); g.arc(x + 13, 26, 5, 0, 7); g.arc(x + 13, h - 26, 5, 0, 7); g.fill(); }
  g.fillStyle = ACCENT.nas; g.fillRect(30, 8, 6, h - 16);
  g.fillStyle = '#e5edf5'; g.font = '700 34px "JetBrains Mono", ui-monospace, monospace';
  let name = it.label || it.id; while (g.measureText(name).width > 230 && name.length > 4) name = name.slice(0, -2);
  g.fillText(name, 50, 50);
  g.fillStyle = ACCENT.nas; g.font = '800 20px "JetBrains Mono", monospace'; g.fillText('NAS · ' + (it.model || 'SYNOLOGY').toUpperCase().slice(0, 14), 50, 82);
  g.fillStyle = '#8fa3b8'; g.font = '500 19px "JetBrains Mono", monospace';
  const v = it.values || {}; const p = (x) => (x == null ? '—' : `${Math.round(x)}%`);
  g.fillText(`CPU ${p(v.cpu)} · RAM ${p(v.mem)}`, 50, 114); g.fillText(`Volumen ${p(v.disk)}`, 50, 140);
  const bays = it.bays?.length ? it.bays : Array(8).fill('off');
  const x0 = 300, bw = (w - 40 - x0) / bays.length;
  bays.forEach((t, i) => {
    const x = x0 + i * bw + 4, ww = bw - 8;
    g.fillStyle = '#1d2024'; g.fillRect(x, 12, ww, h - 24);
    g.strokeStyle = '#08090b'; g.lineWidth = 3; g.strokeRect(x + 1.5, 13.5, ww - 3, h - 27);
    g.fillStyle = '#0a0b0d'; for (let yy = 44; yy < h - 34; yy += 10) for (let xx = x + 10; xx < x + ww - 8; xx += 10) { g.beginPath(); g.arc(xx, yy, 2.6, 0, 7); g.fill(); }
    g.fillStyle = BAY_COL[t] || BAY_COL.off; g.fillRect(x + ww / 2 - 10, 20, 20, 8);
    g.fillStyle = '#2c3036'; g.fillRect(x + 8, h - 30, ww - 16, 8);
    g.fillStyle = '#6b7280'; g.font = '600 14px "JetBrains Mono", monospace'; g.fillText(String(i + 1), x + 6, h - 36);
  });
  f.t.needsUpdate = true;
}

// Frente del servidor (2U): nombre, tipo, barras y rejilla — con el color de su nube (AWS naranja, Azure azul)
function drawFace(f, it) {
  if (it.kind === 'nas') return drawNas(f, it);
  const { g, c } = f, w = c.width, h = c.height;
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#2a3038'); grd.addColorStop(1, '#171b21');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3b434e'; g.fillRect(0, 0, w, 3); g.fillStyle = '#0d1014'; g.fillRect(0, h - 3, w, 3);
  // orejas de montaje con tornillos
  for (const x of [0, w - 26]) { g.fillStyle = '#4b5563'; g.fillRect(x, 0, 26, h); g.fillStyle = '#9ca3af'; g.beginPath(); g.arc(x + 13, 22, 5, 0, 7); g.arc(x + 13, h - 22, 5, 0, 7); g.fill(); }
  const acc = ACCENT[it.kind] || ACCENT.server;
  g.fillStyle = acc; g.fillRect(30, 8, 6, h - 16);
  // bahías de disco del servidor (decorativas)
  for (let k = 0; k < 4; k++) { const x = 44 + k * 7; g.fillStyle = '#0d1014'; g.fillRect(x, 18, 5, h - 36); }
  const off = it.tone === 'off' || !it.values || it.values.cpu == null;
  g.fillStyle = '#e5edf5'; g.font = '700 38px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'alphabetic';
  let name = it.label || it.id; while (g.measureText(name).width > 430 && name.length > 4) name = name.slice(0, -2);
  if (name !== (it.label || it.id)) name += '…';
  g.fillText(name, 74, 52);
  g.font = '800 20px "JetBrains Mono", ui-monospace, monospace'; g.fillStyle = acc;
  const tag = { aws: 'AWS · EC2', azure: 'AZURE · VM', windows: 'WINDOWS', server: 'SERVIDOR' }[it.kind] || 'SERVIDOR';
  g.fillText(tag, 74, 90);
  g.font = '500 20px "JetBrains Mono", ui-monospace, monospace'; g.fillStyle = '#8fa3b8';
  g.fillText(`${it.sub || ''}${it.os ? ` · ${it.os}` : ''}`.slice(0, 28), 74 + g.measureText(tag).width * 1.08 + 16, 90);
  if (it.isNew) { g.fillStyle = '#A3E635'; g.fillRect(74 + Math.min(430, g.measureText(name).width * 1.75) + 18, 22, 92, 32); g.fillStyle = '#10200a'; g.font = '800 20px "JetBrains Mono", monospace'; g.fillText('NUEVO', 74 + Math.min(430, g.measureText(name).width * 1.75) + 30, 46); }
  // barras CPU · MEM · DISCO
  const bars = [['CPU', it.values?.cpu, '#1fa9c0'], ['MEM', it.values?.mem, '#A3E635'], ['DSK', it.values?.disk, '#22d3ee']];
  bars.forEach(([lb, v, col], k) => {
    const x = 560 + k * 150, y = 34;
    g.fillStyle = '#8fa3b8'; g.font = '600 18px "JetBrains Mono", monospace'; g.fillText(lb, x, y - 6);
    g.fillStyle = '#e5edf5'; g.textAlign = 'right'; g.fillText(v == null ? '—' : `${Math.round(v)}%`, x + 128, y - 6); g.textAlign = 'left';
    g.fillStyle = '#0b0e12'; g.fillRect(x, y + 4, 128, 14);
    if (v != null && !off) { g.fillStyle = barCol(v) || col; g.fillRect(x, y + 4, Math.max(3, (128 * Math.min(100, v)) / 100), 14); }
    // segmentos
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let s = 1; s < 10; s++) g.fillRect(x + s * 12.8, y + 4, 2, 14);
  });
  if (off) { g.fillStyle = '#fca5a5'; g.font = '700 22px "JetBrains Mono", monospace'; g.fillText('SIN RESPUESTA', 560, 92); }
  else if (it.note && it.tone !== 'ok') { g.fillStyle = it.tone === 'crit' ? '#fca5a5' : '#fcd34d'; g.font = '600 20px "JetBrains Mono", monospace'; g.fillText(String(it.note).slice(0, 34), 560, 92); }
  else { g.fillStyle = '#2f3741'; for (let x = 560; x < 990; x += 12) for (let y = 74; y < 100; y += 10) g.fillRect(x, y, 6, 4); }
  f.t.needsUpdate = true;
}
function blankTex() {
  const f = canvasTex(512, 64), { g, c } = f;
  g.fillStyle = '#1b1f25'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#0c0f13'; for (let x = 40; x < c.width - 40; x += 10) for (let y = 14; y < c.height - 14; y += 9) g.fillRect(x, y, 5, 4);
  g.fillStyle = '#2b313a'; g.fillRect(0, 0, c.width, 2); g.fillStyle = '#4b5563'; g.fillRect(0, 0, 14, c.height); g.fillRect(c.width - 14, 0, 14, c.height);
  f.t.wrapS = f.t.wrapT = THREE.RepeatWrapping; return f.t;
}
function patchTex(nRack) {
  const f = canvasTex(1024, 64), { g, c } = f;
  g.fillStyle = '#111418'; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 24; k++) { const x = 150 + k * 34; g.fillStyle = '#05070a'; g.fillRect(x, 18, 24, 22); g.fillStyle = k % 3 ? '#22c55e' : '#f59e0b'; g.fillRect(x + 2, 44, 6, 4); }
  g.fillStyle = '#5AB8FF'; g.font = '800 26px Jost, "JetBrains Mono", sans-serif'; g.fillText(`INFRA OPS · RACK ${nRack}`, 980 - g.measureText(`INFRA OPS · RACK ${nRack}`).width, 42);
  f.t.needsUpdate = true; return f.t;
}
function floorTex() {
  const f = canvasTex(256, 256), { g, c } = f;
  g.fillStyle = '#0a1418'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#13434d'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 252);
  for (let y = 30; y < 236; y += 14) for (let x = 30; x < 236; x += 14) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fillStyle = '#122a30'; g.fill(); }
  f.t.wrapS = f.t.wrapT = THREE.RepeatWrapping; return f.t;
}

export function Rack3D({ items = [], height = 520 }) {
  const { wrap, stage, tip, failed, ready } = useStage({ cam: [2.6, 3.4, 7.6], target: [0, 2.5, 0], min: 3, max: 30, rotate: 0, bloom: [0.45, 0.35, 0.6] });
  const world = useRef(null);
  const layoutKey = items.map((i) => i.id).join('|');

  useEffect(() => {
    const s = stage.current;
    if (!s) return undefined;
    if (!world.current || world.current.parent !== s.scene) { world.current = new THREE.Group(); s.scene.add(world.current); }
    const g = world.current;
    clearGroup(g); s.pickables = [];
    const texs = [];
    const nRacks = Math.max(1, Math.ceil(items.length / PER));
    const totalW = nRacks * SX;

    const ft = floorTex(); ft.repeat.set(30, 30); texs.push(ft);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: ft, metalness: 0.4, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; g.add(floor);
    const fill = new THREE.DirectionalLight(0xeaf6ff, 2.2); fill.position.set(1.5, 4, 9); g.add(fill);

    const metal = new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.55, roughness: 0.55 });
    const metalHi = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.8, roughness: 0.35 });
    const inner = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.95 });
    const bt = blankTex(); texs.push(bt);
    const box = (w, h, d, mat, x, y, z, p) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); p.add(m); return m; };

    const units = [];
    for (let r = 0; r < nRacks; r++) {
      const rack = new THREE.Group(); rack.position.x = r * SX - (totalW - SX) / 2; g.add(rack);
      // gabinete abierto al frente
      box(W, BASE, D, metal, 0, BASE / 2, 0, rack);
      box(W, 0.16, D, metal, 0, H - 0.08, 0, rack);
      box(0.06, H, D, metal, -W / 2 + 0.03, H / 2, 0, rack);
      box(0.06, H, D, metal, W / 2 - 0.03, H / 2, 0, rack);
      box(W - 0.12, IH, 0.04, inner, 0, BASE + IH / 2, -D / 2 + 0.05, rack);
      for (const sx of [-1, 1]) box(0.07, IH, 0.08, metalHi, sx * (RW / 2 + 0.05), BASE + IH / 2, D / 2 - 0.06, rack); // rieles
      const top = box(0.09, 0.05, 0.09, new THREE.MeshBasicMaterial({ color: 0x3cc6da }), W / 2 - 0.15, H + 0.03, D / 2 - 0.15, rack); top.userData.beacon = true;
      // patch panel en el 1U superior
      const pt = patchTex(r + 1); texs.push(pt);
      box(RW, U - 0.006, 0.12, [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: pt, roughness: 0.6 }), metal], 0, BASE + IH - U / 2, D / 2 - 0.12, rack);

      const list = items.slice(r * PER, r * PER + PER);
      let u = NU - 1; // próximo U libre (desde arriba, debajo del patch panel)
      list.forEach((it) => {
        const n = unitsOf(it);
        const yTop = BASE + u * U, h2 = n * U - 0.008, y = yTop - (n * U) / 2 + 0.004;
        const face = canvasTex(1024, n === 3 ? 171 : 114); drawFace(face, it); texs.push(face.t);
        const fm = new THREE.MeshStandardMaterial({ map: face.t, roughness: 0.5, metalness: 0.25, emissive: 0xffffff, emissiveMap: face.t, emissiveIntensity: 0.18 });
        const body = box(RW, h2, D - 0.3, [metal, metal, metalHi, metal, fm, metal], 0, y, 0.0, rack);
        const led = box(0.05, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: LED[it.tone] ?? LED.off }), -RW / 2 + 0.09, y, (D - 0.3) / 2 + 0.012, rack);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(RW + 0.06, h2 + 0.05), new THREE.MeshBasicMaterial({ color: TONE_HEX[it.tone] ?? TONE_HEX.off, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.set(0, y, (D - 0.3) / 2 + 0.004); rack.add(glow);
        s.pickables.push(body);
        units.push({ it, body, led, glow, face, key: '' });
        u -= n;
      });
      // espacio libre: paneles ciegos
      const freeU = u - 0; // U disponibles desde abajo hasta u
      if (freeU > 0) {
        const t = bt.clone(); t.needsUpdate = true; t.repeat.set(1, freeU); texs.push(t);
        box(RW, freeU * U - 0.004, 0.03, [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), metal], 0, BASE + (freeU * U) / 2, D / 2 - 0.1, rack);
      }
    }
    g.userData.units = units;

    const R = Math.max(totalW, 4.5);
    s.controls.maxDistance = R * 4;
    s.controls.target.set(0, H * 0.5, 0);
    const dist = Math.max(8.2, totalW * 1.05 + 3); s.camera.position.set(dist * 0.25, H * 0.6, dist);
    s.controls.update();

    const frame = (t) => {
      const k = s.reduce ? 0 : t;
      for (const un of units) {
        const tone = un.it.tone;
        const on = tone === 'crit' ? Math.sin(k * 6) > 0 : tone === 'off' ? false : true;
        un.led.material.color.setHex(on ? LED[tone] ?? LED.off : 0x111418);
        const hot = s.hovered === un.body;
        un.glow.material.opacity = hot ? 0.22 : tone === 'crit' ? 0.08 + Math.sin(k * 5) * 0.06 : un.it.isNew ? 0.06 + Math.sin(k * 2) * 0.04 : 0;
      }
    };
    s.frames.add(frame);
    return () => { s.frames.delete(frame); texs.forEach((x) => x.dispose()); };
  }, [layoutKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valores: redibuja el frente solo si cambió algo
  useEffect(() => {
    const units = world.current?.userData.units || [];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    for (const un of units) {
      const it = byId[un.it.id] || un.it;
      const v = it.values || {};
      const key = [it.label, it.tone, it.sub, it.isNew, it.note, v.cpu, v.mem, v.disk, (it.bays || []).join(',')].map((x) => (typeof x === 'number' ? Math.round(x) : x)).join('|');
      un.it = it;
      if (key !== un.key) { drawFace(un.face, it); un.key = key; }
      const p = (x) => (x == null ? '—' : `${x.toFixed(1)}%`);
      un.body.userData = { href: it.href, onClick: it.onClick, tip: { title: it.label, lines: [`${KIND[it.kind] || 'Servidor'}${it.sub ? ` · ${it.sub}` : ''}`, `CPU ${p(v.cpu)} · Memoria ${p(v.mem)} · Disco ${p(v.disk)}`, ...(it.note ? [it.note] : [])], hint: it.href || it.onClick ? 'Clic para ver el detalle' : '' } };
    }
  }, [items, layoutKey, ready]);

  return (
    <Frame wrap={wrap} stage={stage} tip={tip} failed={failed} height={height}>
      <div className="absolute left-3 bottom-3 z-10 flex gap-3 text-[10.5px] text-muted pointer-events-none flex-wrap">
        <span><i className="dot3d" style={{ background: '#22C55E' }} />Operando</span>
        <span><i className="dot3d" style={{ background: '#F59E0B' }} />Atención</span>
        <span><i className="dot3d" style={{ background: '#EF4444' }} />Falla</span>
        <span className="text-faint">· {items.length} equipo(s) conectados · espacios libres = paneles ciegos</span>
      </div>
    </Frame>
  );
}
