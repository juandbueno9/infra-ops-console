// Mapa 3D de la infraestructura (three.js).
// Núcleo = monitoreo en AWS. Órbitas: servidores (interior), sitios web (media), agencias/red (exterior).
// Cada nodo usa el color de su estado real; los caídos laten en rojo. Pulsos de datos viajan por los enlaces.
// Rendimiento: se pausa si la pestaña no está visible o el lienzo sale de pantalla; respeta "reducir movimiento".
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OrbitButtons } from './OrbitButtons.jsx';

const COLOR = { ok: 0x10b981, warn: 0xf59e0b, crit: 0xef4444, off: 0x64748b };
const HEX = { ok: '#10B981', warn: '#F59E0B', crit: '#EF4444', off: '#64748B' };
const RING = {
  server: { r: 4.1, tilt: 0.06, speed: 0.05, size: 0.24, label: true },
  site: { r: 6.0, tilt: 0.38, speed: -0.03, size: 0.15, label: false },
  agency: { r: 7.8, tilt: -0.26, speed: 0.02, size: 0.14, label: false },
};
const KIND_NAME = { server: 'Servidor', site: 'Sitio web', agency: 'Red' };

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); // la textura de brillo es compartida: se libera al desmontar
    if (o.isCSS2DObject) o.element?.remove();
  });
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

/**
 * nodes: [{ id, kind: 'server'|'site'|'agency', label, tone: 'ok'|'warn'|'crit'|'off', detail, href }]
 * health: 'ok'|'warn'|'crit' (color del núcleo)
 */
export function Scene3D({ nodes = [], health = 'ok', height = 420, className = '', interactive = true, bloom = true }) {
  const wrap = useRef(null);
  const api = useRef(null);
  const ctl = useRef(null);
  const [hover, setHover] = useState(null);
  const [failed, setFailed] = useState(false);
  const [ver, setVer] = useState(0);

  // ---------- montaje: escena, cámara, renderizadores y bucle ----------
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    if (!webglAvailable()) { setFailed(true); return undefined; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { setFailed(true); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, bloom ? 1.5 : 2));
    renderer.setClearColor(0x041014, 1);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const labels = new CSS2DRenderer();
    labels.domElement.className = 'scene3d-labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x041014, 0.028);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    camera.position.set(0, 9, 13.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, enablePan: false, minDistance: 7, maxDistance: 24, maxPolarAngle: Math.PI * 0.49, autoRotate: !reduce, autoRotateSpeed: 0.35, enabled: interactive });
    controls.enableZoom = interactive;
    // Giro manual (arrastre o botones): pausa el giro automático; se reanuda tras 25 s sin tocar
    const C = { auto: !reduce, held: false, spin: null, idle: 0 };
    const sync = () => { controls.autoRotate = C.auto && !C.held && !hovered; };
    const release = () => { clearTimeout(C.idle); C.idle = setTimeout(() => { C.held = false; sync(); }, 25000); };
    controls.addEventListener('start', () => { C.held = true; clearTimeout(C.idle); sync(); });
    controls.addEventListener('end', release);
    const cam0 = camera.position.clone();
    ctl.current = {
      get auto() { return C.auto; },
      rotateBy: (a) => { C.held = true; sync(); C.spin = { left: a, rate: a / 0.35 }; release(); },
      setAuto: (v) => { C.auto = !!v && !reduce; C.held = false; sync(); },
      reset: () => { camera.position.copy(cam0); controls.target.set(0, 0, 0); controls.update(); },
    };

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.55, 0.12);
    if (bloom) composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const glow = glowTexture();

    // Núcleo: esfera luminosa + icosaedro de alambre + anillos
    const core = new THREE.Group();
    const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.75, 48, 48), new THREE.MeshBasicMaterial({ color: 0x1fa9c0 }));
    const coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.35 }));
    const coreHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x1fa9c0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    coreHalo.scale.set(5, 5, 1);
    const coreRing1 = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: 0x6fd3e2, transparent: true, opacity: 0.8 }));
    const coreRing2 = coreRing1.clone(); coreRing2.material = coreRing1.material.clone(); coreRing2.scale.setScalar(1.18); coreRing2.material.opacity = 0.35;
    coreRing1.rotation.x = Math.PI / 2.4; coreRing2.rotation.y = Math.PI / 2.6;
    core.add(coreSphere, coreWire, coreHalo, coreRing1, coreRing2);
    const coreLabel = document.createElement('div');
    coreLabel.className = 'lbl3d lbl3d-core'; coreLabel.textContent = 'Monitoreo · AWS';
    const coreLbl = new CSS2DObject(coreLabel); coreLbl.position.set(0, -1.75, 0); core.add(coreLbl);
    scene.add(core);

    // Órbitas (grupos que rotan)
    const rings = {};
    for (const [kind, cfg] of Object.entries(RING)) {
      const g = new THREE.Group();
      g.rotation.z = cfg.tilt; g.rotation.x = cfg.tilt * 0.5;
      const pts = Array.from({ length: 181 }, (_, i) => { const a = (i / 180) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * cfg.r, 0, Math.sin(a) * cfg.r); });
      const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x3b5b8a, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.55 }));
      orbit.computeLineDistances();
      g.add(orbit);
      const content = new THREE.Group(); g.add(content);
      scene.add(g);
      rings[kind] = { group: g, content, cfg };
    }

    // Estrellas y rejilla holográfica
    const starsGeo = new THREE.BufferGeometry();
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 26 + Math.random() * 40, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xa5e4ee, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false }));
    scene.add(stars);
    const grid = new THREE.GridHelper(60, 60, 0x007b8d, 0x0f2a4a);
    grid.position.y = -3.2; grid.material.transparent = true; grid.material.opacity = 0.28;
    scene.add(grid);

    // Disco de partículas de energía alrededor del núcleo
    const DN = 2600, dpos = new Float32Array(DN * 3), dcol = new Float32Array(DN * 3);
    const c1 = new THREE.Color(0x1fa9c0), c2 = new THREE.Color(0x22d3ee), c3 = new THREE.Color(0xb0cb1f), tc = new THREE.Color();
    for (let i = 0; i < DN; i++) {
      const r = 1.9 + Math.pow(Math.random(), 1.6) * 1.3, a = Math.random() * Math.PI * 2;
      dpos.set([Math.cos(a) * r, (Math.random() - 0.5) * 0.12 * (3.2 - r), Math.sin(a) * r], i * 3);
      tc.copy(c1).lerp(Math.random() > 0.5 ? c2 : c3, Math.random()); dcol.set([tc.r, tc.g, tc.b], i * 3);
    }
    const diskGeo = new THREE.BufferGeometry();
    diskGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    diskGeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
    const disk = new THREE.Points(diskGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    disk.rotation.x = 0.35; core.add(disk);

    // Dial HUD: anillos de marcas alrededor del núcleo y en el piso
    const ticks = (r, n, len, y = 0) => {
      const v = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, l = i % 5 === 0 ? len * 2 : len;
        v.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a) * (r + l), y, Math.sin(a) * (r + l));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); return g;
    };
    const dialCore = new THREE.LineSegments(ticks(2.95, 90, 0.08), new THREE.LineBasicMaterial({ color: 0x6fd3e2, transparent: true, opacity: 0.55 }));
    dialCore.rotation.x = 0.35; core.add(dialCore);
    const dialFloor = new THREE.LineSegments(ticks(9.4, 180, 0.18, -3.18), new THREE.LineBasicMaterial({ color: 0x007b8d, transparent: true, opacity: 0.5 }));
    scene.add(dialFloor);

    // Radar: barrido y onda expansiva sobre la rejilla
    const sweep = new THREE.Mesh(new THREE.RingGeometry(0.2, 11, 64, 1, 0, Math.PI / 6), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.09, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    sweep.rotation.x = -Math.PI / 2; sweep.position.y = -3.17; scene.add(sweep);
    const wave = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128), new THREE.MeshBasicMaterial({ color: 0x1fa9c0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    wave.rotation.x = -Math.PI / 2; wave.position.y = -3.16; scene.add(wave);

    // Columnas de luz bajo cada nodo (se actualizan con la posición real del nodo)
    const beams = new THREE.Group(); scene.add(beams);
    const beamsFor = new Map();
    const syncBeams = (meshes) => {
      disposeTree(beams); beams.clear(); beamsFor.clear();
      meshes.forEach((m) => {
        const col = new THREE.Color(COLOR[m.userData.node.tone] ?? COLOR.off);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -3.18, 0], 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute([col.r, col.g, col.b, 0.55, col.r, col.g, col.b, 0.0], 4));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
        const foot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
        foot.scale.setScalar(0.7);
        beams.add(line, foot); beamsFor.set(m, { line, foot });
      });
    };

    // Interacción
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let pickables = [], hovered = null;
    const onMove = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      const n = hit?.object.userData.node || null;
      if (n !== hovered) { hovered = n; renderer.domElement.style.cursor = n?.href ? 'pointer' : 'grab'; }
      setHover(n ? { node: n, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      sync();
    };
    const onLeave = () => { hovered = null; setHover(null); sync(); };
    let downAt = null;
    const onDown = (e) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      if (hovered?.href) location.hash = hovered.href;
    };
    if (interactive) {
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerleave', onLeave);
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointerup', onUp);
    }

    // Tamaño
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); renderer.domElement.style.width = `${w}px`; renderer.domElement.style.height = `${h}px`;
      labels.setSize(w, h); composer.setSize(w, h); bloomPass.setSize(w, h);
      camera.aspect = w / h; if (w < 640) camera.position.setLength(22); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // Visible en pantalla / pestaña
    let onScreen = true;
    const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }, { threshold: 0.01 });
    io.observe(el);

    // Bucle
    const camTo = camera.position.clone(), camFrom = new THREE.Vector3(0, 22, 34);
    let intro = reduce ? 1 : 0;
    if (!reduce) camera.position.copy(camFrom);
    const clock = new THREE.Clock();
    let raf = 0, t = 0;
    const tmp = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || !onScreen) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 0.05); t += dt;
      const m = reduce ? 0.15 : 1;
      coreWire.rotation.y += dt * 0.25 * m; coreWire.rotation.x += dt * 0.1 * m;
      coreRing1.rotation.z += dt * 0.4 * m; coreRing2.rotation.z -= dt * 0.3 * m;
      coreSphere.scale.setScalar(1 + Math.sin(t * 2) * 0.04);
      stars.rotation.y += dt * 0.004 * m;
      disk.rotation.y += dt * 0.35 * m;
      dialCore.rotation.y -= dt * 0.12 * m; dialFloor.rotation.y += dt * 0.02 * m;
      sweep.rotation.z -= dt * 0.9 * m;
      const wp = (t * 0.25) % 1; wave.scale.setScalar(1 + wp * 10); wave.material.opacity = 0.45 * (1 - wp);
      if (intro < 1) { intro = Math.min(1, intro + dt / 2.6); const e = 1 - Math.pow(1 - intro, 3); camera.position.lerpVectors(camFrom, camTo, e); }
      beamsFor.forEach(({ line, foot }, mesh) => {
        mesh.getWorldPosition(tmp);
        const pa = line.geometry.attributes.position;
        pa.setXYZ(0, tmp.x, tmp.y, tmp.z); pa.setXYZ(1, tmp.x, -3.18, tmp.z); pa.needsUpdate = true;
        foot.position.set(tmp.x, -3.15, tmp.z);
      });
      for (const { group, content, cfg } of Object.values(rings)) {
        group.rotation.y += dt * cfg.speed * m;
        content.children.forEach((o) => {
          const u = o.userData;
          if (u.pulse) {                                  // pulso de datos viajando núcleo → nodo
            u.p = (u.p + dt * u.speed * m) % 1;
            o.position.copy(u.to).multiplyScalar(u.p);
            o.material.opacity = Math.sin(u.p * Math.PI) * 0.95;
          } else if (u.node && u.node.tone === 'crit') {  // nodo caído: late
            const s = 1 + Math.abs(Math.sin(t * 4)) * 0.45; o.scale.setScalar(s);
          } else if (u.spin) {
            o.rotation.z += dt * u.spin * m; o.rotation.x = Math.PI / 2 + Math.sin(t + u.spin) * 0.4;
          } else if (u.halo && u.tone === 'crit') {
            u.halo.material.opacity = 0.35 + Math.abs(Math.sin(t * 4)) * 0.55;
          }
        });
      }
      if (C.spin) { const st = Math.sign(C.spin.left) * Math.min(Math.abs(C.spin.left), Math.abs(C.spin.rate) * 0.016); const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), st); camera.position.copy(controls.target).add(off); C.spin.left -= st; if (Math.abs(C.spin.left) < 1e-4) C.spin = null; }
      controls.update();
      composer.render();
      labels.render(scene, camera);
    };
    loop();

    api.current = { scene, rings, glow, core: { coreSphere, coreHalo, coreWire }, setPickables: (p) => { pickables = p; syncBeams(p); } };
    setVer((v) => v + 1);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose();
      if (interactive) {
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointerup', onUp);
      }
      disposeTree(scene); glow.dispose(); composer.dispose?.(); renderer.dispose();
      renderer.domElement.remove(); labels.domElement.remove();
      api.current = null;
    };
  }, [interactive, bloom]);

  // ---------- nodos: se reconstruyen cuando cambia el estado ----------
  const key = JSON.stringify(nodes.map((n) => [n.id, n.tone, n.label]));
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const coreColor = health === 'crit' ? 0xef4444 : health === 'warn' ? 0xf59e0b : 0x1fa9c0;
    a.core.coreSphere.material.color.setHex(coreColor);
    a.core.coreHalo.material.color.setHex(coreColor);
    const pick = [];
    for (const [kind, ring] of Object.entries(a.rings)) {
      disposeTree(ring.content);
      ring.content.clear();
      const list = nodes.filter((n) => n.kind === kind);
      const cfg = ring.cfg;
      list.forEach((n, i) => {
        const ang = (i / Math.max(list.length, 1)) * Math.PI * 2 + (kind === 'site' ? 0.3 : kind === 'agency' ? 0.6 : 0);
        const p = new THREE.Vector3(Math.cos(ang) * cfg.r, (kind === 'server' ? Math.sin(i * 1.7) * 0.25 : 0), Math.sin(ang) * cfg.r);
        const col = COLOR[n.tone] ?? COLOR.off;
        const bright = n.tone === 'off' ? 0.6 : 1;
        const mesh = new THREE.Mesh(
          kind === 'server' ? new THREE.OctahedronGeometry(cfg.size, 0) : new THREE.SphereGeometry(cfg.size, 20, 20),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(bright) }),
        );
        mesh.position.copy(p); mesh.userData.node = n;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: a.glow, color: col, transparent: true, opacity: n.tone === 'ok' ? 0.35 : 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.scale.setScalar(cfg.size * (n.tone === 'crit' ? 9 : 6)); halo.position.copy(p);
        halo.userData = { halo, tone: n.tone };
        // Enlace al núcleo
        const lineMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: kind === 'server' ? 0.35 : n.tone === 'ok' ? 0.08 : 0.4 });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), p]), lineMat);
        ring.content.add(line, halo, mesh);
        if (kind === 'server') {
          const orb = new THREE.Mesh(new THREE.TorusGeometry(cfg.size * 1.9, 0.008, 6, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
          orb.position.copy(p); orb.rotation.x = Math.PI / 2; orb.userData.spin = 1 + (i % 3) * 0.4;
          ring.content.add(orb);
        }
        // Pulsos de datos (servidores siempre; sitios/agencias solo si hay problema)
        const pulses = kind === 'server' ? 2 : n.tone === 'ok' ? 0 : 1;
        for (let k = 0; k < pulses; k++) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(kind === 'server' ? 0.055 : 0.045, 10, 10), new THREE.MeshBasicMaterial({ color: n.tone === 'ok' ? 0x67e8f9 : col, transparent: true, opacity: 0 }));
          dot.userData = { pulse: true, to: p.clone(), p: k / pulses + Math.random() * 0.3, speed: n.tone === 'crit' ? 0.15 : 0.35 + Math.random() * 0.25 };
          ring.content.add(dot);
        }
        if (cfg.label || n.tone === 'crit') {
          const d = document.createElement('div');
          d.className = `lbl3d lbl3d-${n.tone}`; d.textContent = n.label;
          const o = new CSS2DObject(d); o.position.copy(p).multiplyScalar(1.1).add(new THREE.Vector3(0, cfg.size + 0.3, 0));
          ring.content.add(o);
        }
        pick.push(mesh);
      });
    }
    a.setPickables(pick);
  }, [key, health, ver]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return <div className={`grid place-items-center text-muted text-sm rounded-xl border border-line bg-bg1 ${className}`} style={{ height }}>Tu navegador no tiene WebGL activo: la vista 3D no está disponible.</div>;
  }
  return (
    <div className={`scene3d relative overflow-hidden rounded-xl ${className}`} style={{ height }} ref={wrap} aria-label="Mapa 3D de la infraestructura" role="img">
      {interactive && !failed && <OrbitButtons stage={ctl} pos="right-4 bottom-12" />}
      {hover && (
        <div className="absolute z-20 pointer-events-none glass-tip" style={{ left: Math.min(hover.x + 14, (wrap.current?.clientWidth || 600) - 240), top: Math.max(8, hover.y - 12) }}>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted"><span className="w-2 h-2 rounded-full" style={{ background: HEX[hover.node.tone], boxShadow: `0 0 8px ${HEX[hover.node.tone]}` }} />{KIND_NAME[hover.node.kind]}</div>
          <div className="text-ink font-semibold text-[13px] mt-0.5 break-all">{hover.node.label}</div>
          {hover.node.detail && <div className="text-[11.5px] text-ink2 mt-0.5">{hover.node.detail}</div>}
          {hover.node.href && <div className="text-[10.5px] text-info mt-1">Clic para abrir el detalle</div>}
        </div>
      )}
    </div>
  );
}
