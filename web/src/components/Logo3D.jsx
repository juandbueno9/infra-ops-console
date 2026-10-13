// Logo 3D de Infra Ops (WebGL): monograma C• en cromo azul iridiscente con núcleo de "pulso" cian,
// anillos orbitales con satélites (el monitoreo), plano de escaneo holográfico, partículas y el nombre
// en relieve con un barrido de luz. Descargable como PNG.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontJson from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { webglAvailable } from './Scene3D.jsx';
import { monogram } from '../lib/brand.js';

function envTexture(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 p; void main(){ vec3 n = normalize(p); float h = n.y; vec3 c = mix(vec3(.01,.02,.06), vec3(.25,.55,1.), smoothstep(.0,.95,h)); c += vec3(.1,.85,1.) * pow(max(0., n.x), 6.) * 1.2; c += vec3(.5,.2,1.) * pow(max(0., -n.x), 8.) * .6; gl_FragColor = vec4(c,1.); }',
  }));
  sc.add(sky);
  const tex = pm.fromScene(sc, 0.03).texture;
  sky.geometry.dispose(); sky.material.dispose(); pm.dispose();
  return tex;
}

export function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Geometría del monograma (C extruida) + posición/radio del punto, en unidades de escena y centrada. */
export function monogramMeshes(scale = 0.05, depth = 6) {
  const { outline, dot } = monogram(72);
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x - 24, 24 - y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.0, bevelSegments: 6, curveSegments: 12 });
  geo.translate(0, 0, -depth / 2); geo.scale(scale, scale, scale); geo.computeVertexNormals();
  return { geo, dot: { x: (dot.cx - 24) * scale, y: (24 - dot.cy) * scale, r: dot.r * scale } };
}

/** variant: 'full' (monograma + nombre + pedestal) | 'mark' (solo monograma) */
export function Logo3D({ height = 220, variant = 'full', transparent = false, download = false, className = '' }) {
  const wrap = useRef(null), api = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    if (!webglAvailable()) { setFailed(true); return undefined; }
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const full = variant === 'full';
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: download }); } catch { setFailed(true); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x040814, transparent ? 0 : 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const env = envTexture(renderer);
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 60);
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x050a18, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0x22d3ee, 2.6); rim.position.set(-6, 2, -5); scene.add(rim);
    const sweep = new THREE.PointLight(0x9ee6f0, 9, 0, 0); sweep.position.set(-3, 0, 1.6); scene.add(sweep);

    const root = new THREE.Group(); scene.add(root);
    const texs = [];

    // ---------- Monograma ----------
    const emblem = new THREE.Group();
    const { geo, dot } = monogramMeshes(full ? 0.05 : 0.052);
    const cMat = new THREE.MeshPhysicalMaterial({ color: 0x4a86ff, metalness: 0.88, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7, iridescenceIOR: 1.6, emissive: 0x007b8d, emissiveIntensity: 0.35 });
    const C = new THREE.Mesh(geo, cMat);
    C.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 55), new THREE.LineBasicMaterial({ color: 0x9ee6f0, transparent: true, opacity: 0.35 })));
    const core = new THREE.Mesh(new THREE.SphereGeometry(dot.r * 1.05, 40, 40), new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.6, roughness: 0.2 }));
    core.position.set(dot.x, dot.y, 0);
    const glowTex = canvasTex(128, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.4)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    texs.push(glowTex);
    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x22d3ee, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    coreGlow.scale.set(1.1, 1.1, 1); coreGlow.position.copy(core.position);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x0f95ab, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(3.6, 3.6, 1); halo.position.z = -0.8; halo.material.opacity = 0.3;
    emblem.add(C, core, coreGlow, halo);

    // Anillos orbitales con satélites
    const orbits = [];
    const ringDefs = full ? [[1.45, 1.25, 0.2, 0x3cc6da], [1.62, -0.9, 0.9, 0x6fd3e2], [1.3, 0.35, -1.1, 0x22d3ee]] : [[1.35, 1.2, 0.25, 0x3cc6da]];
    ringDefs.forEach(([r, rx, rz, col], i) => {
      const g = new THREE.Group(); g.rotation.set(rx, 0, rz);
      g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 160), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 })));
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), new THREE.MeshBasicMaterial({ color: col }));
      const sg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      sg.scale.set(0.35, 0.35, 1); sat.add(sg);
      g.add(sat); emblem.add(g);
      orbits.push({ g, sat, r, speed: 0.9 + i * 0.35, phase: i * 2.1 });
    });

    // Plano de escaneo holográfico
    const scanTex = canvasTex(256, (g, s) => { const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, 'rgba(34,211,238,0)'); gr.addColorStop(0.5, 'rgba(34,211,238,.9)'); gr.addColorStop(1, 'rgba(34,211,238,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
    texs.push(scanTex);
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.12), new THREE.MeshBasicMaterial({ map: scanTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    scan.rotation.x = -Math.PI / 2;
    emblem.add(scan);
    root.add(emblem);

    // ---------- Nombre, pedestal y partículas ----------
    let dust = null, pad = null;
    if (full) {
      emblem.position.set(0, 1.05, 0);
      const font = new FontLoader().parse(fontJson);
      const tg = new TextGeometry('INFRA OPS', { font, size: 0.5, depth: 0.18, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.028, bevelSize: 0.018, bevelSegments: 3 });
      tg.center();
      const text = new THREE.Mesh(tg, [
        new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, metalness: 0.35, roughness: 0.2, clearcoat: 1, emissive: 0x0f172a, emissiveIntensity: 0.2 }),
        new THREE.MeshPhysicalMaterial({ color: 0x0f95ab, metalness: 0.9, roughness: 0.2, emissive: 0x035f6b, emissiveIntensity: 0.8, iridescence: 0.5 }),
      ]);
      text.position.set(0, -0.5, 0.25);
      const sub = new THREE.Mesh(new TextGeometry('OBSERVABILIDAD  ·  AWS', { font, size: 0.13, depth: 0.01, curveSegments: 4 }).center(), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
      sub.position.set(0, -0.98, 0.25);
      root.add(text, sub);

      const padTex = canvasTex(512, (g, s) => {
        const c = s / 2;
        for (let i = 1; i <= 7; i++) { g.beginPath(); g.arc(c, c, (c * i) / 7.4, 0, Math.PI * 2); g.strokeStyle = `rgba(60,198,218,${0.55 - i * 0.06})`; g.lineWidth = i === 7 ? 3 : 1.4; g.stroke(); }
        for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2, r1 = c * 0.9, r2 = r1 - (i % 6 ? 8 : 18); g.beginPath(); g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.strokeStyle = 'rgba(125,211,252,.7)'; g.lineWidth = 2; g.stroke(); }
        const r = g.createRadialGradient(c, c, 0, c, c, c); r.addColorStop(0, 'rgba(15,149,171,.35)'); r.addColorStop(1, 'rgba(15,149,171,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s);
      });
      texs.push(padTex);
      pad = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = -0.08;
      root.add(pad);
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-3, -1.15, 0.25), new THREE.Vector3(3, -1.15, 0.25)]), new THREE.LineBasicMaterial({ color: 0x3cc6da, transparent: true, opacity: 0.45 })));

      const N = 260, pos = new Float32Array(N * 3), spd = new Float32Array(N);
      for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, rr = 0.3 + Math.random() * 2.6; pos.set([Math.cos(a) * rr, -0.1 + Math.random() * 2.8, Math.sin(a) * rr - 0.4], i * 3); spd[i] = 0.1 + Math.random() * 0.35; }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9ee6f0, size: 0.025, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      dust.userData.spd = spd;
      root.add(dust);
      camera.position.set(0, 0.5, 9.2); camera.lookAt(0, 0.45, 0);
    } else {
      camera.position.set(0, 0, 5.6); camera.lookAt(0, 0, 0);
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.35, 0.82);
    if (!transparent) composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h); composer.setSize(w, h); bloom.resolution.set(w, h);
      camera.aspect = w / h;
      if (full) camera.position.z = Math.max(9.2, 8 * (1.9 / Math.min(camera.aspect, 1.9)));
      camera.updateProjectionMatrix();
      composer.render();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let onScreen = true;
    const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }, { threshold: 0.01 });
    io.observe(el);

    let tx = 0, ty = 0;
    const move = (e) => { const r = el.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 0.7; ty = ((e.clientY - r.top) / r.height - 0.5) * 0.35; };
    const leave = () => { tx = 0; ty = 0; };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      if (!onScreen || document.hidden) return;
      if (!reduce) {
        C.rotation.y = Math.sin(t * 0.6) * 0.55;
        core.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
        coreGlow.material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
        emblem.position.y = (full ? 1.05 : 0) + Math.sin(t * 1.4) * 0.05;
        halo.material.opacity = 0.25 + Math.sin(t * 1.7) * 0.07;
        for (const o of orbits) { const a = t * o.speed + o.phase; o.sat.position.set(Math.cos(a) * o.r, Math.sin(a) * o.r, 0); o.g.rotation.y += dt * 0.15; }
        scan.position.y = Math.sin(t * 0.9) * 1.05; scan.material.opacity = 0.35 + (1 - Math.abs(Math.sin(t * 0.9))) * 0.35;
        sweep.position.x = ((t * 1.2) % 8) - 4;
        if (pad) pad.rotation.z = t * 0.25;
        if (dust) {
          const p = dust.geometry.attributes.position, sp = dust.userData.spd;
          for (let i = 0; i < sp.length; i++) { let y = p.getY(i) + sp[i] * dt; if (y > 2.8) y = -0.1; p.setY(i, y); }
          p.needsUpdate = true;
        }
      }
      root.rotation.y += (tx - root.rotation.y) * 0.06;
      root.rotation.x += (ty - root.rotation.x) * 0.06;
      composer.render();
    };
    loop();

    api.current = {
      png: () => {
        composer.render();
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = 'empresa-logo-3d.png';
        a.click();
      },
    };

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave);
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
      texs.forEach((x) => x.dispose()); env.dispose(); composer.dispose?.(); renderer.dispose(); renderer.domElement.remove();
      api.current = null;
    };
  }, [variant, transparent, download]);

  if (failed) return null;
  return (
    <div className={`logo3d relative ${className}`} style={{ height }}>
      <div ref={wrap} className="absolute inset-0" />
      {download && (
        <button type="button" onClick={() => api.current?.png()} className="hud-btn absolute right-3 bottom-3 z-10" title="Descargar el logo como imagen PNG">⬇ PNG</button>
      )}
    </div>
  );
}
