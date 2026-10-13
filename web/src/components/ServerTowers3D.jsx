// Servidores en 3D: un gabinete negro por servidor (estilo torre con 6 equipos 1U, rejillas y gavetas inferiores)
// y los NAS Synology como caja de 8 bahías con un LED por disco.
//  - El LED central de cada equipo toma el color del estado del servidor (verde/ámbar/rojo; apagado si no responde)
//    y parpadea más rápido cuanto más CPU usa.
//  - Debajo de cada gabinete: nombre + CPU / memoria / disco.  Clic → detalle del servidor.
// items: [{ id, label, tone, href?, onClick?, kind: 'server'|'nas', values: { cpu, mem, disk }, note, bays?: ['ok'|'warn'|'crit'|'off'] }]
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Frame, TONE_HEX, clearGroup, useStage } from './Charts3D.jsx';

const LED_TONE = { ok: 0x3cc6da, warn: 0xf59e0b, crit: 0xef4444, off: 0x1f2937 };
const BAY_TONE = { ok: 0x22c55e, warn: 0xf59e0b, crit: 0xef4444, off: 0x1f2937 };

function tex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const grille = (g, x, y, w, h, base, slot) => {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.fillStyle = slot;
  for (let yy = y + 8; yy < y + h - 6; yy += 7) g.fillRect(x + 10, yy, w - 20, 3);
  g.fillStyle = '#9aa1ab'; for (const [sx, sy] of [[x + 4, y + 4], [x + w - 8, y + 4], [x + 4, y + h - 8], [x + w - 8, y + h - 8]]) g.fillRect(sx, sy, 4, 4);
};
// Frente de un equipo 1U: panel izquierdo con rejilla · módulo central (LED) · panel derecho
const unitTex = () => tex(512, 96, (g, w, h) => {
  g.fillStyle = '#16181c'; g.fillRect(0, 0, w, h);
  grille(g, 8, 8, 196, h - 16, '#4b5059', '#2a2e34');
  g.fillStyle = '#23272d'; g.fillRect(212, 8, 88, h - 16);
  g.fillStyle = '#0b0d10'; g.fillRect(222, 34, 68, 26);
  grille(g, 308, 8, 196, h - 16, '#4b5059', '#2a2e34');
});
const drawerTex = () => tex(256, 128, (g, w, h) => {
  g.fillStyle = '#6b7079'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5c6169'; for (let y = 10; y < h - 10; y += 6) g.fillRect(10, y, w - 20, 2);
  g.fillStyle = '#80868f'; g.fillRect(0, 0, w, 4);
  g.strokeStyle = '#3d4148'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
});
// Techo: rejillas de ventilación en las esquinas delanteras y al fondo (fondo transparente)
const topTex = () => tex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const vent = (x, y, vw, vh) => { g.fillStyle = '#0c0d10'; g.fillRect(x, y, vw, vh); g.fillStyle = '#2b2f35'; for (let yy = y + 4; yy < y + vh - 2; yy += 6) g.fillRect(x + 3, yy, vw - 6, 2); };
  vent(14, 196, 82, 46); vent(160, 196, 82, 46); vent(40, 14, 176, 40);
});
// Laterales: panel en bajo relieve
const sideTex = () => tex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 5; g.strokeRect(30, 22, w - 60, h - 44);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2; g.strokeRect(35, 27, w - 70, h - 54);
});
// Bandeja de disco del NAS (agujeros de ventilación)
const trayTex = () => tex(64, 256, (g, w, h) => {
  g.fillStyle = '#1d2024'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#0a0b0d'; for (let y = 40; y < h - 30; y += 9) for (let x = 10; x < w - 8; x += 9) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#2c3036'; g.fillRect(6, h - 22, w - 12, 10);
  g.strokeStyle = '#08090b'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
});
const shadowTex = () => tex(128, 128, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.75)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

function nameTag() {
  const d = document.createElement('div');
  d.className = 'lbl3d';
  d.style.textAlign = 'center'; d.style.lineHeight = '1.25';
  return { el: d, obj: new CSS2DObject(d) };
}

export function ServerTowers3D({ items = [], height = 440 }) {
  const { wrap, stage, tip, failed, ready } = useStage({ cam: [4, 3.5, 8], target: [0, 0.9, 0], min: 3, max: 30, rotate: 0, bloom: [0.55, 0.35, 0.6] });
  const world = useRef(null);
  const layoutKey = items.map((i) => `${i.id}:${i.kind}:${i.bays?.length || 0}`).join('|');

  useEffect(() => {
    const s = stage.current;
    if (!s) return undefined;
    if (!world.current || world.current.parent !== s.scene) { world.current = new THREE.Group(); s.scene.add(world.current); }
    const g = world.current;
    clearGroup(g); s.pickables = [];
    const T = { unit: unitTex(), drawer: drawerTex(), top: topTex(), side: sideTex(), tray: trayTex(), shadow: shadowTex() };

    const body = new THREE.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.35, roughness: 0.72 });
    const bodyDark = new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.3, roughness: 0.8 });
    const recess = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9 });
    const unitFace = new THREE.MeshStandardMaterial({ map: T.unit, roughness: 0.55, metalness: 0.45 });
    const drawerFace = new THREE.MeshStandardMaterial({ map: T.drawer, roughness: 0.5, metalness: 0.4 });
    const topMat = new THREE.MeshStandardMaterial({ map: T.top, transparent: true, roughness: 0.9, depthWrite: false });
    const sideMat = new THREE.MeshStandardMaterial({ map: T.side, transparent: true, roughness: 0.9, depthWrite: false });
    const trayFace = new THREE.MeshStandardMaterial({ map: T.tray, roughness: 0.6, metalness: 0.3 });
    const shadowMat = new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false });

    // Piso oscuro con cuadrícula tenue de la marca
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x07161a, metalness: 0.15, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2; g.add(floor);
    const grid = new THREE.GridHelper(60, 60, 0x0f95ab, 0x0f3a42); grid.material.transparent = true; grid.material.opacity = 0.12; grid.position.y = 0.002; g.add(grid);
    const fill = new THREE.DirectionalLight(0xe6f6ff, 1.6); fill.position.set(1, 4, 10); g.add(fill);

    const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    const units = [];
    const n = Math.max(1, items.length), cols = n <= 12 ? n : Math.ceil(n / 2), SX = 2.3, SZ = 3.6, rows = Math.ceil(n / cols);
    const RW = cols * SX, RD = rows * SZ;

    items.forEach((it, i) => {
      const cx = (i % cols) * SX - (RW - SX) / 2, cz = Math.floor(i / cols) * SZ - (RD - SZ) / 2;
      const r = new THREE.Group(); r.position.set(cx, 0, cz); g.add(r);
      const leds = [];
      let W, H, D;
      if (it.kind === 'nas') {
        // ---- NAS Synology: caja ancha y baja con bahías verticales ----
        W = 1.6; H = 0.72; D = 1.05;
        add(new RoundedBoxGeometry(W, H, D, 4, 0.05), bodyDark, 0, H / 2, 0, r);
        add(new THREE.PlaneGeometry(W - 0.12, H - 0.1), recess, 0, H / 2, D / 2 + 0.002, r);
        const bays = it.bays?.length ? it.bays : Array(8).fill('off');
        const bw = (W - 0.42) / bays.length;
        bays.forEach((tone, b) => {
          const x = -W / 2 + 0.1 + bw * b + bw / 2;
          add(new THREE.BoxGeometry(bw - 0.012, H - 0.16, 0.03), [bodyDark, bodyDark, bodyDark, bodyDark, trayFace, bodyDark], x, H / 2 - 0.01, D / 2 + 0.012, r);
          const led = add(new THREE.BoxGeometry(0.03, 0.018, 0.01), new THREE.MeshBasicMaterial({ color: BAY_TONE[tone] ?? BAY_TONE.off }), x, H - 0.05, D / 2 + 0.03, r);
          led.userData = { phase: Math.random() * 10, bay: tone };
          leds.push(led);
        });
        // columna derecha: botón de encendido + LEDs de estado y red
        const px = W / 2 - 0.15;
        const btn = add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }), px, H - 0.14, D / 2 + 0.012, r); btn.rotation.x = Math.PI / 2;
        for (let k = 0; k < 3; k++) {
          const led = add(new THREE.BoxGeometry(0.035, 0.016, 0.01), new THREE.MeshBasicMaterial({ color: LED_TONE.ok }), px, H - 0.26 - k * 0.07, D / 2 + 0.012, r);
          led.userData = { phase: Math.random() * 10, status: k === 0, k };
          leds.push(led);
        }
      } else {
        // ---- Gabinete torre (como la referencia) ----
        W = 1.25; H = 1.8; D = 1.3;
        add(new RoundedBoxGeometry(W, H, D, 4, 0.035), body, 0, H / 2, 0, r);
        const tp = add(new THREE.PlaneGeometry(W - 0.04, D - 0.04), topMat, 0, H + 0.002, 0, r); tp.rotation.x = -Math.PI / 2;
        for (const sx of [-1, 1]) { const sp = add(new THREE.PlaneGeometry(D - 0.08, H - 0.1), sideMat, sx * (W / 2 + 0.002), H / 2, 0, r); sp.rotation.y = sx * Math.PI / 2; }
        // marco frontal hundido
        add(new THREE.PlaneGeometry(W - 0.12, H - 0.2), recess, 0, H / 2 + 0.02, D / 2 + 0.002, r);
        const uw = W - 0.2, uh = 0.17, y0 = 0.42;
        for (let u = 0; u < 6; u++) {
          const y = y0 + u * (uh + 0.025) + uh / 2;
          add(new THREE.BoxGeometry(uw, uh, 0.05), [body, body, body, body, unitFace, body], 0, y, D / 2 + 0.02, r);
          const led = add(new THREE.BoxGeometry(0.12, 0.032, 0.012), new THREE.MeshBasicMaterial({ color: LED_TONE.ok }), 0, y + 0.01, D / 2 + 0.05, r);
          led.userData = { phase: Math.random() * 10, u };
          leds.push(led);
        }
        // gavetas inferiores
        for (const dx of [-1, 1]) add(new THREE.BoxGeometry(uw / 2 - 0.02, 0.27, 0.05), [body, body, body, body, drawerFace, body], dx * (uw / 4 + 0.005), 0.12 + 0.135, D / 2 + 0.02, r);
      }
      const sh = add(new THREE.PlaneGeometry(W * 1.9, D * 1.9), shadowMat, 0, 0.004, 0, r); sh.rotation.x = -Math.PI / 2;
      // franja de luz del color del estado en el piso, frente al gabinete
      const halo = add(new THREE.PlaneGeometry(W * 0.9, 0.22), new THREE.MeshBasicMaterial({ color: TONE_HEX[it.tone] ?? TONE_HEX.off, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.006, D / 2 + 0.2, r);
      halo.rotation.x = -Math.PI / 2;
      const hit = add(new THREE.BoxGeometry(W, H, D), new THREE.MeshBasicMaterial({ visible: false }), 0, H / 2, 0, r);
      s.pickables.push(hit);
      const tag = nameTag(); tag.obj.position.set(0, H + (i % 2 ? 0.75 : 0.28), 0); r.add(tag.obj); // alternados para que no se monten
      units.push({ id: it.id, it, leds, halo, hit, tag, cpu: 0, tone: it.tone });
    });
    g.userData.units = units;

    const R = Math.max(RW, RD * 1.6, 4);
    s.controls.maxDistance = R * 3.2;
    s.controls.target.set(0, 1.0, 0);
    s.camera.position.set(0, R * 0.26 + 1.8, R * 0.36 + 2.2);
    s.controls.update();

    const frame = (t) => {
      const k = s.reduce ? 0 : t;
      for (const un of units) {
        const speed = 1.2 + (un.cpu || 0) / 15;
        for (const led of un.leds) {
          const d = led.userData;
          if (d.bay != null) { // LED de disco: parpadea por actividad, rojo/ámbar fijo
            const base = BAY_TONE[d.bay] ?? BAY_TONE.off;
            const on = d.bay !== 'ok' || Math.sin(k * 7 + d.phase * 3) > -0.7;
            led.material.color.setHex(un.tone === 'off' ? BAY_TONE.off : on ? base : 0x0d3b1e);
          } else if (d.status) {
            led.material.color.setHex(LED_TONE[un.tone] ?? LED_TONE.off);
          } else {
            const col = LED_TONE[un.tone] ?? LED_TONE.off;
            let on = un.tone !== 'off' && Math.sin(k * speed * (1.5 + (d.u ?? d.k ?? 0) * 0.37) + d.phase) > -0.55;
            if (un.tone === 'crit') on = Math.sin(k * 6) > 0;
            led.material.color.setHex(on ? col : 0x0b1a1e);
          }
        }
        const hot = s.hovered === un.hit;
        un.halo.material.opacity = (un.tone === 'crit' ? 0.45 + Math.sin(k * 5) * 0.25 : 0.28) + (hot ? 0.3 : 0);
      }
    };
    s.frames.add(frame);
    return () => { s.frames.delete(frame); Object.values(T).forEach((x) => x.dispose()); };
  }, [layoutKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valores y estado en cada actualización (sin reconstruir la escena)
  useEffect(() => {
    const units = world.current?.userData.units || [];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    for (const un of units) {
      const it = byId[un.id] || un.it;
      un.it = it; un.tone = it.tone; un.cpu = it.values?.cpu ?? 0;
      un.halo.material.color.setHex(TONE_HEX[it.tone] ?? TONE_HEX.off);
      if (it.bays) un.leds.forEach((led, b) => { if (led.userData.bay != null) led.userData.bay = it.bays[b] || 'off'; });
      const v = it.values || {};
      const lines = it.kind === 'nas'
        ? [`CPU ${pct(v.cpu)} · RAM ${pct(v.mem)}`, ...(v.disk != null ? [`Volumen ${pct(v.disk)}`] : []), ...(it.note ? [it.note] : [])]
        : [`CPU ${pct(v.cpu)} · Memoria ${pct(v.mem)} · Disco ${pct(v.disk)}`, ...(it.note ? [it.note] : [])];
      un.hit.userData = { href: it.href, onClick: it.onClick, tip: { title: it.label, lines, hint: it.onClick || it.href ? 'Clic para ver el detalle' : '' } };
      un.tag.el.className = `lbl3d ${it.tone === 'crit' ? 'lbl3d-crit' : it.tone === 'warn' ? 'lbl3d-warn' : it.tone === 'off' ? 'lbl3d-off' : ''}`;
      un.tag.el.innerHTML = `<div>${esc(it.label)}</div><div style="font-size:10px;opacity:.75;font-weight:400">${esc(it.kind === 'nas' ? `NAS · ${pct(v.disk)} usado` : `CPU ${pct(v.cpu)} · RAM ${pct(v.mem)}`)}</div>`;
    }
  }, [items, layoutKey, ready]);

  return (
    <Frame wrap={wrap} tip={tip} failed={failed} height={height}>
      <div className="absolute left-3 bottom-3 z-10 flex gap-3 text-[10.5px] text-muted pointer-events-none flex-wrap">
        <span><i className="dot3d" style={{ background: '#5AB8FF' }} />Operando</span>
        <span><i className="dot3d" style={{ background: '#F59E0B' }} />Atención</span>
        <span><i className="dot3d" style={{ background: '#EF4444' }} />Falla</span>
        <span className="text-faint">· LEDs parpadean según la CPU · en el NAS, un LED por disco</span>
      </div>
    </Frame>
  );
}
