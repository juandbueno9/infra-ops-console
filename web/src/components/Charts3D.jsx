// Gráficos 3D en WebGL para los dashboards (three.js, se cargan bajo demanda).
//  - Bars3D:  "skyline" de servidores: una columna por métrica (CPU / Memoria / Disco) sobre una base del color del estado.
//  - Donut3D: anillo extruido de disponibilidad (en línea / por revisar / caídos).
// Igual que el mapa 3D: se pausan fuera de pantalla o con la pestaña oculta y respetan "reducir movimiento".
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { webglAvailable } from './Scene3D.jsx';
import { OrbitButtons } from './OrbitButtons.jsx';

export const TONE_HEX = { ok: 0x10b981, warn: 0xf59e0b, crit: 0xef4444, off: 0x64748b };
const BG = 0x041014;

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
    if (o.isCSS2DObject) o.element?.remove();
  });
}
export function clearGroup(g) { disposeTree(g); g.clear(); }
export function label(text, cls = '') { const d = document.createElement('div'); d.className = `lbl3d ${cls}`; d.textContent = text; return new CSS2DObject(d); }

/** Escenario común: renderizador, cámara orbital, luces, brillo, selección con el ratón y ciclo de vida. */
export function createStage(el, { cam = [0, 6, 10], target = [0, 0, 0], min = 5, max = 22, rotate = 0.5, bloom = [0.55, 0.45, 0.28], onHover }) {
  const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(BG, 1);
  renderer.domElement.style.display = 'block';
  el.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'scene3d-labels';
  el.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 22, 48);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.set(...cam);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.07, enablePan: false, minDistance: min, maxDistance: max, maxPolarAngle: Math.PI * 0.47, autoRotate: !reduce && rotate > 0, autoRotateSpeed: rotate });
  controls.target.set(...target); controls.update();

  scene.add(new THREE.HemisphereLight(0xa5c8ff, 0x0a171c, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(6, 12, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x22d3ee, 1.2); rim.position.set(-8, 5, -6); scene.add(rim);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = bloom ? new UnrealBloomPass(new THREE.Vector2(1, 1), ...bloom) : null;
  if (bloomPass) composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const s = { scene, camera, controls, reduce, renderer, pickables: [], frames: new Set(), hovered: null, auto: !reduce && rotate > 0, held: false };
  // Giro manual: al arrastrar se detiene el giro automático; se reanuda tras 25 s sin tocar (si estaba activo)
  let idle = 0;
  const wantAuto = () => s.auto && !s.held && !s.hovered;
  const syncAuto = () => { controls.autoRotate = wantAuto(); };
  controls.addEventListener('start', () => { s.held = true; clearTimeout(idle); syncAuto(); });
  controls.addEventListener('end', () => { clearTimeout(idle); idle = setTimeout(() => { s.held = false; syncAuto(); }, 25000); });
  let spin = null; // animación de los botones de giro
  s.rotateBy = (ang) => { s.held = true; clearTimeout(idle); syncAuto(); spin = { left: ang, rate: ang / 0.35 }; idle = setTimeout(() => { s.held = false; syncAuto(); }, 25000); };
  s.setAuto = (v) => { s.auto = !!v && !reduce; s.held = false; syncAuto(); };
  s.reset = () => { camera.position.set(...cam); controls.target.set(...target); controls.update(); };

  const resize = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h); composer.setSize(w, h); labels.setSize(w, h);
    bloomPass?.resolution.set(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (s.frames) { s.frames.forEach((f) => f(0, 0)); composer.render(); labels.render(scene, camera); } // evita lienzo vacío tras redimensionar
  };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  let onScreen = true;
  const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }, { threshold: 0.01 });
  io.observe(el);

  // Selección: raycast al mover; clic sin arrastre navega
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const move = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(s.pickables, false)[0]?.object || null;
    if (hit !== s.hovered) { s.hovered = hit; renderer.domElement.style.cursor = hit?.userData.href || hit?.userData.onClick ? 'pointer' : ''; syncAuto(); }
    onHover?.(hit ? { ...hit.userData.tip, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width } : null);
  };
  const leave = () => { s.hovered = null; syncAuto(); onHover?.(null); };
  const pdown = (e) => { down = [e.clientX, e.clientY]; };
  const pup = (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { if (s.hovered?.userData.onClick) s.hovered.userData.onClick(); else if (s.hovered?.userData.href) location.hash = s.hovered.userData.href; } down = null; };
  const cv = renderer.domElement;
  cv.addEventListener('pointermove', move); cv.addEventListener('pointerleave', leave); cv.addEventListener('pointerdown', pdown); cv.addEventListener('pointerup', pup);

  const clock = new THREE.Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (!onScreen || document.hidden) return;
    if (spin) { const st = Math.sign(spin.left) * Math.min(Math.abs(spin.left), Math.abs(spin.rate) * dt); const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), st); camera.position.copy(controls.target).add(off); spin.left -= st; if (Math.abs(spin.left) < 1e-4) spin = null; }
    controls.update();
    s.frames.forEach((f) => f(t, dt));
    composer.render();
    labels.render(scene, camera);
  };
  loop();

  s.dispose = () => {
    cancelAnimationFrame(raf); clearTimeout(idle); ro.disconnect(); io.disconnect(); controls.dispose();
    cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerleave', leave); cv.removeEventListener('pointerdown', pdown); cv.removeEventListener('pointerup', pup);
    disposeTree(scene); composer.dispose?.(); renderer.dispose();
    cv.remove(); labels.domElement.remove();
  };
  return s;
}

export function useStage(opts) {
  const wrap = useRef(null), stage = useRef(null);
  const [tip, setTip] = useState(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!wrap.current) return undefined;
    if (!webglAvailable()) { setFailed(true); return undefined; }
    try { stage.current = createStage(wrap.current, { ...opts, onHover: setTip }); } catch { setFailed(true); return undefined; }
    setReady((v) => v + 1);
    return () => { stage.current?.dispose(); stage.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { wrap, stage, tip, failed, ready };
}

export function Frame({ wrap, tip, failed, height, children, stage }) {
  return (
    <div className="scene3d relative w-full overflow-hidden" style={{ height }}>
      <div ref={wrap} className="absolute inset-0" />
      {stage && !failed && <OrbitButtons stage={stage} />}
      {failed && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Este navegador no soporta WebGL.</div>}
      {tip && (
        <div className="glass-tip absolute pointer-events-none z-20" style={{ left: Math.min(tip.w - 250, tip.x + 14), top: Math.max(8, tip.y - 12) }}>
          <div className="text-ink font-semibold text-[12.5px] truncate">{tip.title}</div>
          {(tip.lines || []).map((l) => <div key={l} className="text-[11.5px] text-ink2 font-mono">{l}</div>)}
          {tip.hint && <div className="text-[10.5px] text-info mt-1">{tip.hint}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
/**
 * items: [{ id, label, tone, href, values: { cpu, mem, disk } (0–100 o null), note }]
 * metrics: [{ key, label, color }]
 */
export function Bars3D({ items = [], metrics, height = 380 }) {
  const M = metrics || [{ key: 'cpu', label: 'CPU', color: 0x1fa9c0 }, { key: 'mem', label: 'Memoria', color: 0xb0cb1f }, { key: 'disk', label: 'Disco', color: 0x22d3ee }];
  const { wrap, stage, tip, failed, ready } = useStage({ cam: [7, 8, 13], target: [0, 1.4, 0], min: 6, max: 34, rotate: 0.35 });
  const world = useRef(null);
  const layoutKey = items.map((i) => i.id).join('|');

  // Estructura (cuando cambian los servidores)
  useEffect(() => {
    const s = stage.current;
    if (!s) return undefined;
    if (!world.current || world.current.parent !== s.scene) { world.current = new THREE.Group(); s.scene.add(world.current); } // en desarrollo (StrictMode) la escena se crea dos veces
    const g = world.current;
    clearGroup(g); s.pickables = [];
    const n = Math.max(1, items.length), cols = Math.min(n, Math.max(2, Math.ceil(Math.sqrt(n * 1.7)))), rows = Math.ceil(n / cols), SX = 2.9, SZ = 3.1;
    const W = cols * SX, D = rows * SZ;

    const floorSize = Math.max(W, D) + 8;
    const grid = new THREE.GridHelper(floorSize, Math.round(floorSize / 0.8), 0x13434d, 0x0b2a31);
    grid.material.transparent = true; grid.material.opacity = 0.55; g.add(grid);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(floorSize * 0.45, 64), new THREE.MeshBasicMaterial({ color: 0x007b8d, transparent: true, opacity: 0.07, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.002; g.add(disc);

    const bars = [];
    items.forEach((it, i) => {
      const cx = (i % cols) * SX - (W - SX) / 2, cz = Math.floor(i / cols) * SZ - (D - SZ) / 2;
      const tone = TONE_HEX[it.tone] ?? TONE_HEX.off;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.1), new THREE.MeshStandardMaterial({ color: 0x0f1a2e, emissive: tone, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.4 }));
      plate.position.set(cx, 0.05, cz);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.9 }));
      plate.add(edge);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.7), new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: it.tone === 'crit' ? 0.22 : 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(cx, 0.01, cz); glow.userData.pulse = it.tone === 'crit';
      g.add(plate, glow);
      const lb = label(it.label, it.tone === 'crit' ? 'lbl3d-crit' : it.tone === 'warn' ? 'lbl3d-warn' : it.tone === 'off' ? 'lbl3d-off' : '');
      lb.position.set(cx, -0.05, cz + 0.95); g.add(lb);

      M.forEach((m, k) => {
        const geo = new THREE.BoxGeometry(0.5, 1, 0.5); geo.translate(0, 0.5, 0);
        const mat = new THREE.MeshStandardMaterial({ color: m.color, emissive: m.color, emissiveIntensity: 0.3, metalness: 0.35, roughness: 0.3, transparent: true, opacity: 0.93 });
        const bar = new THREE.Mesh(geo, mat);
        bar.position.set(cx + (k - (M.length - 1) / 2) * 0.66, 0.1, cz);
        bar.scale.y = 0.001;
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
        const cap = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
        cap.rotation.x = -Math.PI / 2; cap.position.y = 1.002;
        bar.add(e, cap);
        bar.userData = { metric: m, item: it, target: 0.001, href: it.href, cap, base: m.color };
        g.add(bar); bars.push(bar); s.pickables.push(bar);
      });
    });
    g.userData.bars = bars;

    // Cámara acorde al tamaño
    const R = Math.max(W, D * 1.15, 6);
    s.controls.maxDistance = R * 2.4;
    s.camera.position.set(R * 0.42, R * 0.46 + 2.6, R * 0.74 + 2.4);
    s.controls.update();

    const frame = (t, dt) => {
      for (const b of bars) {
        b.scale.y += (b.userData.target - b.scale.y) * Math.min(1, dt * 3.2);
        const hot = stage.current?.hovered === b;
        b.material.emissiveIntensity += ((hot ? 0.95 : 0.3) - b.material.emissiveIntensity) * Math.min(1, dt * 8);
      }
      g.children.forEach((c) => { if (c.userData.pulse) c.material.opacity = 0.14 + Math.sin(t * 4) * 0.1; });
    };
    s.frames.add(frame);
    return () => { s.frames.delete(frame); };
  }, [layoutKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valores (cada actualización)
  useEffect(() => {
    const bars = world.current?.userData.bars || [];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    for (const b of bars) {
      const it = byId[b.userData.item.id] || b.userData.item, m = b.userData.metric, v = it.values?.[m.key];
      const val = v == null ? 0 : Math.max(0, Math.min(100, v));
      b.userData.target = Math.max(0.02, (val / 100) * 4.2);
      const c = val >= 90 ? TONE_HEX.crit : val >= 75 ? TONE_HEX.warn : b.userData.base;
      b.material.color.setHex(c); b.material.emissive.setHex(c);
      b.userData.cap.material.color.setHex(val >= 75 ? c : 0xffffff);
      b.userData.tip = { title: it.label, lines: [`${m.label}: ${v == null ? '—' : `${v.toFixed(1)}%`}`, ...(it.note ? [it.note] : [])], hint: 'Clic para abrir el servidor' };
      b.userData.item = it;
    }
  }, [items, layoutKey, ready]);

  return (
    <Frame wrap={wrap} stage={stage} tip={tip} failed={failed} height={height}>
      <div className="absolute left-3 bottom-3 z-10 flex gap-3 text-[10.5px] text-muted pointer-events-none">
        {M.map((m) => <span key={m.key}><i className="dot3d" style={{ background: `#${m.color.toString(16).padStart(6, '0')}` }} />{m.label}</span>)}
        <span className="text-faint">· ámbar ≥75% · rojo ≥90%</span>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
/**
 * segments: [{ key, label, value, tone }]   center: { value, caption }
 */
export function Donut3D({ segments = [], center = {}, height = 300, href, fmt }) {
  const { wrap, stage, tip, failed, ready } = useStage({ cam: [0, 5.4, 6.4], target: [0, 0.1, 0], min: 5, max: 13, rotate: 0, bloom: [0.7, 0.5, 0.22] });
  const world = useRef(null);
  const key = segments.map((s) => `${s.key}:${s.value}`).join('|') + `|${center.value}|${center.caption}`;

  useEffect(() => {
    const s = stage.current;
    if (!s) return undefined;
    if (!world.current || world.current.parent !== s.scene) { world.current = new THREE.Group(); s.scene.add(world.current); } // en desarrollo (StrictMode) la escena se crea dos veces
    const g = world.current;
    clearGroup(g); s.pickables = [];
    const total = segments.reduce((t, x) => t + (x.value || 0), 0);
    const R = 2.5, r = 1.6, pad = total && segments.filter((x) => x.value).length > 1 ? 0.035 : 0;
    const segs = [];
    let a = Math.PI / 2;
    const list = total ? segments.filter((x) => x.value) : [{ key: 'none', label: 'Sin datos', value: 1, tone: 'off' }];
    const sum = total || 1;
    for (const sg of list) {
      const span = (sg.value / sum) * Math.PI * 2, a0 = a + pad, a1 = a + span - pad;
      a += span;
      if (a1 <= a0) continue;
      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
      shape.absarc(0, 0, R, a0, a1, false);
      shape.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      shape.absarc(0, 0, r, a1, a0, true);
      const depth = sg.tone === 'crit' ? 0.85 : sg.tone === 'warn' ? 0.65 : 0.5;
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 48 });
      geo.rotateX(-Math.PI / 2);
      const col = sg.color != null ? new THREE.Color(sg.color).getHex() : TONE_HEX[sg.tone] ?? TONE_HEX.off;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.28, transparent: true, opacity: 0.95 }));
      const mid = (a0 + a1) / 2;
      mesh.userData = { tip: { title: sg.label, lines: total ? [`${fmt ? fmt(sg.value) : sg.value} de ${fmt ? fmt(total) : total} · ${Math.round((sg.value / total) * 100)}%`] : ['Aún no hay datos'], hint: href ? 'Clic para ver el detalle' : undefined }, href, dir: new THREE.Vector3(Math.cos(mid), 0, -Math.sin(mid)) };
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
      mesh.add(edge);
      g.add(mesh); segs.push(mesh); s.pickables.push(mesh);
    }
    // Núcleo, anillos y partículas
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.06, 64), new THREE.MeshBasicMaterial({ color: 0x007b8d, transparent: true, opacity: 0.25 }));
    core.position.y = 0.02; g.add(core);
    const ringM = new THREE.MeshBasicMaterial({ color: 0x6fd3e2, transparent: true, opacity: 0.55 });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.012, 6, 160), ringM); ring1.rotation.x = Math.PI / 2; g.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.008, 6, 160), ringM.clone()); ring2.material.opacity = 0.25; ring2.rotation.x = Math.PI / 2; g.add(ring2);
    const ticks = new THREE.Group();
    for (let i = 0; i < 72; i++) {
      const tk = new THREE.Mesh(new THREE.BoxGeometry(i % 6 ? 0.02 : 0.035, 0.01, i % 6 ? 0.12 : 0.22), new THREE.MeshBasicMaterial({ color: 0x1fa9c0, transparent: true, opacity: i % 6 ? 0.35 : 0.8 }));
      const ang = (i / 72) * Math.PI * 2; tk.position.set(Math.cos(ang) * 3.2, 0, Math.sin(ang) * 3.2); tk.rotation.y = -ang + Math.PI / 2; ticks.add(tk);
    }
    g.add(ticks);
    const pts = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) { const ang = Math.random() * Math.PI * 2, rad = 3.5 + Math.random() * 1.2; pts.set([Math.cos(ang) * rad, (Math.random() - 0.5) * 0.35, Math.sin(ang) * rad], i * 3); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x6fd3e2, size: 0.035, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(dust);
    const cl = document.createElement('div');
    cl.className = 'donut3d-center';
    cl.innerHTML = `<b></b><span></span>`;
    cl.querySelector('b').textContent = center.value ?? '—';
    cl.querySelector('span').textContent = center.caption ?? '';
    const cobj = new CSS2DObject(cl); cobj.position.set(0, 0.35, 0); g.add(cobj);

    const frame = (t, dt) => {
      if (!s.reduce) { g.rotation.y += dt * 0.12; ticks.rotation.y -= dt * 0.05; dust.rotation.y += dt * 0.04; }
      for (const m of segs) {
        const hot = stage.current?.hovered === m, k = Math.min(1, dt * 7);
        m.position.lerp(hot ? m.userData.dir.clone().multiplyScalar(0.28).setY(0.18) : new THREE.Vector3(), k);
        m.material.emissiveIntensity += ((hot ? 0.9 : 0.35) - m.material.emissiveIntensity) * k;
      }
    };
    s.frames.add(frame);
    return () => { s.frames.delete(frame); };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Frame wrap={wrap} stage={stage} tip={tip} failed={failed} height={height} />;
}
