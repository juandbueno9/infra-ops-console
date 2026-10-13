// Gemelo digital de la sede principal (Bogotá) en 3D.
// Modelo estilizado del edificio: volúmenes blancos perforados escalonados, fachada de lamas verticales,
// marco superior con el nombre y planta baja acristalada. Las perforaciones se iluminan con el estado real
// de la sede (VPN), sale un haz de datos hacia AWS y un anillo de agencias conectadas por SD-WAN.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import fontJson from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { Frame, clearGroup, label, useStage } from './Charts3D.jsx';
import { monogramMeshes, canvasTex } from './Logo3D.jsx';
import { AGENCY_GEO } from '../lib/agencyGeo.js';
import { linkState } from '../lib/network.js';

const TONE = { ok: 0x3cc6da, warn: 0xf59e0b, crit: 0xef4444, off: 0x64748b };
const AG_TONE = { ok: 0x10b981, warn: 0xf59e0b, crit: 0xef4444, off: 0x475569 };
const fms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

function perforation(size = 512, lit = false) {
  return canvasTex(size, (g, s) => {
    g.fillStyle = lit ? '#000' : '#eef2f6'; g.fillRect(0, 0, s, s);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * s, y = rnd() * s, r = 1.5 + rnd() * rnd() * 7;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = lit ? `rgba(255,255,255,${0.55 + rnd() * 0.45})` : '#2a3441'; g.fill();
    }
  });
}

export function Building3D({ route = {}, agencies = [], height = 300 }) {
  const { wrap, stage, tip, failed, ready } = useStage({ cam: [14.5, 8.2, 16.5], target: [0, 5.0, 0], min: 10, max: 40, rotate: 0.45, bloom: [0.6, 0.45, 0.62] });
  const world = useRef(null);
  const vpn = route?.vpn;
  const tone = vpn ? (vpn.ok ? 'ok' : 'crit') : 'off';
  const live = Object.fromEntries((agencies || []).map((a) => [a.ip, a]));
  const agKey = AGENCY_GEO.filter((g) => !g.hub).map((g) => (live[g.ip] ? linkState(live[g.ip])[1] : 'off')).join(',');
  const key = `${tone}|${agKey}|${vpn?.ms ? Math.round(vpn.ms / 5) : ''}`;

  useEffect(() => {
    const s = stage.current;
    if (!s) return undefined;
    if (!world.current || world.current.parent !== s.scene) { world.current = new THREE.Group(); s.scene.add(world.current); }
    const g = world.current;
    clearGroup(g); s.pickables = [];
    const texs = [];
    const statusCol = TONE[tone];
    // ---------- realismo: reflejos del entorno (vidrio y metal) y sombras suaves ----------
    if (s.renderer && !s.envTex) { const pm = new THREE.PMREMGenerator(s.renderer); s.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    if (s.envTex) { s.scene.environment = s.envTex; s.scene.environmentIntensity = 0.22; }
    if (s.renderer) { s.renderer.shadowMap.enabled = true; s.renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.75); sun.position.set(9, 18, 11); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 14, bottom: -6, near: 1, far: 50 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    g.add(sun); g.add(sun.target); sun.target.position.set(0, 3, 0);

    // ---------- suelo ----------
    const grid = new THREE.GridHelper(40, 50, 0x13434d, 0x0b2a31); grid.material.transparent = true; grid.material.opacity = 0.5; g.add(grid);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x0a1c22, metalness: 0.6, roughness: 0.35 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; g.add(plaza);
    const baseRing = new THREE.Mesh(new THREE.RingGeometry(6.6, 6.75, 96), new THREE.MeshBasicMaterial({ color: statusCol, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    baseRing.rotation.x = -Math.PI / 2; baseRing.position.y = 0.02; g.add(baseRing);

    // ---------- materiales ----------
    const perf = perforation(512, false), perfLit = perforation(512, true);
    [perf, perfLit].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); });
    texs.push(perf, perfLit);
    const whitePerf = new THREE.MeshStandardMaterial({ envMapIntensity: 0.25, color: 0xd5dce4, map: perf, emissive: statusCol, emissiveMap: perfLit, emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.05 });
    const white = new THREE.MeshStandardMaterial({ envMapIntensity: 0.25, color: 0xd9dfe6, roughness: 0.5, metalness: 0.05, emissive: 0x0b1220, emissiveIntensity: 0.2 });
    const winTex = canvasTex(256, (c, n) => {
      c.fillStyle = '#050b16'; c.fillRect(0, 0, n, n);
      for (let f = 0; f < 8; f++) for (let w = 0; w < 16; w++) { const on = Math.sin(f * 7.1 + w * 3.3) > -0.2; c.fillStyle = on ? `rgba(125,211,252,${0.35 + ((f * w) % 5) * 0.1})` : 'rgba(30,41,59,.6)'; c.fillRect(w * 16 + 2, f * 32 + 6, 12, 22); }
    });
    texs.push(winTex);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1830, metalness: 0.9, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.8, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.5 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0xa8865a, metalness: 0.65, roughness: 0.4, emissive: 0x2a1c0c, emissiveIntensity: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141a24, metalness: 0.7, roughness: 0.3 });
    const lobby = new THREE.MeshStandardMaterial({ color: 0x0e2238, metalness: 0.4, roughness: 0.1, emissive: 0xfcd9a0, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

    const bld = new THREE.Group(); g.add(bld);
    // Proporciones tomadas de la foto de la sede (Bogotá): planta baja acristalada + 7 pisos,
    // fachada de lamas de concreto, muro lateral blanco perforado con 6 volúmenes en voladizo y
    // ranuras oscuras, cornisa perforada con el letrero, bloque oscuro en la azotea.
    // Ejes locales: +z = fachada de lamas, −x = muro perforado (luego se gira para que ambas miren a la cámara).
    const G0 = 1.3, FH = 0.95, FLOORS = 7, TOP = G0 + FH * FLOORS;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b19f, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.3 });
    const concreteCol = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9, metalness: 0.02 });
    const slotMat = new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.4, metalness: 0.6 });
    const perfWall = perf.clone(); perfWall.wrapS = perfWall.wrapT = THREE.RepeatWrapping; perfWall.repeat.set(4, 3); perfWall.needsUpdate = true;
    const perfWallLit = perfLit.clone(); perfWallLit.wrapS = perfWallLit.wrapT = THREE.RepeatWrapping; perfWallLit.repeat.set(4, 3); perfWallLit.needsUpdate = true;
    texs.push(perfWall, perfWallLit);
    const wallMat = whitePerf.clone(); wallMat.map = perfWall; wallMat.emissiveMap = perfWallLit;
    // ventanas verticales angostas detrás de las lamas (marcos claros, vidrio oscuro)
    const slitTex = canvasTex(512, (c, n) => {
      c.fillStyle = '#8f8a80'; c.fillRect(0, 0, n, n);
      for (let f = 0; f < 7; f++) for (let w = 0; w < 24; w++) {
        const x = w * (n / 24) + 4, y = f * (n / 7) + 8, ww = n / 24 - 8, hh = n / 7 - 16;
        c.fillStyle = '#e5e7eb'; c.fillRect(x - 2, y - 2, ww + 4, hh + 4);
        const lit = Math.sin(f * 5.3 + w * 2.1) > 0.35;
        c.fillStyle = lit ? 'rgba(186,230,253,.85)' : '#0f1d2e'; c.fillRect(x, y, ww, hh);
      }
    });
    texs.push(slitTex);
    const slitMat = new THREE.MeshStandardMaterial({ map: slitTex, emissive: 0xffffff, emissiveMap: slitTex, emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.4 });

    // núcleo acristalado (laterales y fondo)
    const core = box(5.8, TOP - G0, 4.8, glass, 0.55, (G0 + TOP) / 2, -0.1); bld.add(core);
    const mull = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.9, roughness: 0.3 });
    for (let k = 0; k <= 8; k++) bld.add(box(0.05, TOP - G0, 0.05, mull, 3.47, (G0 + TOP) / 2, -2.5 + k * 0.6));
    for (let k = 0; k <= 9; k++) bld.add(box(0.05, TOP - G0, 0.05, mull, -2.35 + k * 0.644, (G0 + TOP) / 2, -2.53));
    for (let f = 0; f <= FLOORS; f++) { bld.add(box(0.07, 0.09, 4.85, mull, 3.48, G0 + f * FH, -0.1)); bld.add(box(5.85, 0.09, 0.07, mull, 0.55, G0 + f * FH, -2.54)); }
    // fachada frontal: ventanas angostas + lamas verticales de concreto
    const front = new THREE.Mesh(new THREE.PlaneGeometry(5.8, TOP - G0), slitMat); front.position.set(0.55, (G0 + TOP) / 2, 2.31); bld.add(front);
    const nF = 24, fx0 = -2.3, fx1 = 3.4;
    for (let i = 0; i < nF; i++) bld.add(box(0.09, TOP - G0 + 0.1, 0.5, concrete, fx0 + (i + 0.5) * ((fx1 - fx0) / nF), (G0 + TOP) / 2, 2.62));
    // cornisa blanca perforada con el letrero (sobresale sobre las lamas)
    const cornMat = whitePerf.clone();
    bld.add(box(6.0, 0.62, 1.25, cornMat, 0.55, TOP + 0.3, 2.45));
    bld.add(box(0.3, TOP - G0 + 0.62, 0.9, white, 3.55, (G0 + TOP + 0.62) / 2, 2.55));
    // muro lateral perforado (lado −x) de piso 1 a la cornisa
    bld.add(box(0.16, TOP - G0 * 0.4 + 0.62, 5.2, wallMat, -2.47, (G0 * 0.6 + TOP + 0.62) / 2, 0.1));
    // seis volúmenes en voladizo en la esquina, con ranuras oscuras entre ellos
    const prot = [0.55, 0.62, 0.58, 0.66, 0.6, 0.7];
    prot.forEach((p, i) => {
      const y = G0 + FH * (i + 0.95) + FH / 2 - 0.15, d = 1.0 + p;
      const m = box(d, FH - 0.2, 2.5, whitePerf, -2.47 - d / 2 + 0.55, y, 1.55 + p * 0.25);
      bld.add(m);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.25 })));
      // ranura oscura (ventana corrida) bajo cada volumen, a lo largo del muro
      bld.add(box(0.06, 0.16, 2.9, slotMat, -2.57, y - FH / 2 + 0.02, -0.3));
    });
    // planta baja: vidrio, columna de concreto bajo los voladizos y franja de lamas oscuras en el costado
    bld.add(box(6.2, G0, 4.6, lobby, 0.5, G0 / 2, -0.1));
    bld.add(box(0.42, G0 + FH * 0.95, 0.42, concreteCol, -3.0, (G0 + FH * 0.95) / 2, 2.2));
    for (let k = 0; k < 18; k++) bld.add(box(0.05, G0 + 0.4, 0.07, dark, -2.58, (G0 + 0.4) / 2, -2.4 + k * 0.2));
    const pillar = box(0.5, G0 - 0.05, 0.3, white, -0.7, G0 / 2, 2.42); bld.add(pillar);
    const stripe = box(1.6, 0.12, 0.02, new THREE.MeshStandardMaterial({ color: 0x84cc16, emissive: 0x4d7c0f, emissiveIntensity: 0.6 }), 2.4, 0.8, 2.34); stripe.rotation.z = 0.5; bld.add(stripe);
    // bloque oscuro de la azotea (fondo izquierdo)
    bld.add(box(2.4, 1.1, 3.4, dark, -1.2, TOP + 0.55, -0.9));
    // letreros: cornisa (frente) y gran logo vertical en el muro perforado
    const font = new FontLoader().parse(fontJson);
    const signMat = new THREE.MeshStandardMaterial({ color: 0x3cc6da, emissive: 0x0284c7, emissiveIntensity: 0.7 });
    const tg = new TextGeometry('INFRA OPS', { font, size: 0.26, depth: 0.05, curveSegments: 5 }); tg.center();
    const sign = new THREE.Mesh(tg, signMat); sign.position.set(2.0, TOP + 0.3, 3.1); bld.add(sign);
    const { geo: mg, dot } = monogramMeshes(0.016, 3);
    const mono = new THREE.Mesh(mg, signMat); mono.position.set(0.45, TOP + 0.3, 3.09); bld.add(mono);
    const mdot = new THREE.Mesh(new THREE.SphereGeometry(dot.r, 16, 16), new THREE.MeshBasicMaterial({ color: 0x67e8f9 })); mdot.position.set(0.45 + dot.x, TOP + 0.3 + dot.y, 3.12); bld.add(mdot);
    const { geo: mg2, dot: d2 } = monogramMeshes(0.028, 3);
    const mono2 = new THREE.Mesh(mg2, signMat); mono2.rotation.y = -Math.PI / 2; mono2.position.set(-2.58, G0 + FH * 6.0, -1.3); bld.add(mono2);
    const md2 = new THREE.Mesh(new THREE.SphereGeometry(d2.r, 16, 16), new THREE.MeshBasicMaterial({ color: 0x67e8f9 })); md2.position.set(-2.64, G0 + FH * 6.0 + d2.y, -1.3 - d2.x); bld.add(md2);
    const tg2 = new TextGeometry('INFRA OPS', { font, size: 0.22, depth: 0.04, curveSegments: 5 }); tg2.center();
    const sign2 = new THREE.Mesh(tg2, signMat); sign2.rotation.set(0, -Math.PI / 2, 0); sign2.position.set(-2.6, G0 + FH * 5.15, -1.3); bld.add(sign2); // derecho, debajo del monograma

    // selección del edificio
    core.userData = { tip: { title: 'Sede principal · Bogotá', lines: [`VPN AWS: ${vpn ? (vpn.ok ? fms(vpn.ms) : 'CAÍDA') : 'sin monitorear'}`, `Internet WAN: ${route?.internet ? (route.internet.ok ? fms(route.internet.ms) : 'no responde ping') : '—'}`, 'FortiGate · 192.168.10.254'], hint: 'Clic para ver la red' }, href: '#/red' };
    s.pickables.push(core);

    // ---------- haz hacia AWS ----------
    const beamH = 7.5;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, beamH, 12, 1, true), new THREE.MeshBasicMaterial({ color: statusCol, transparent: true, opacity: tone === 'crit' ? 0.25 : 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(0.6, TOP + 0.55 + beamH / 2, 1.2); g.add(beam);
    const beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, beamH, 16, 1, true), new THREE.MeshBasicMaterial({ color: statusCol, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    beamGlow.position.copy(beam.position); g.add(beamGlow);
    const pulses = [];
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); p.userData.o = i / 4; g.add(p); pulses.push(p); }
    const aws = new THREE.Group(); aws.position.set(0.6, TOP + 0.55 + beamH + 0.6, 1.2);
    const awsCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color: 0x3cc6da, wireframe: true, transparent: true, opacity: 0.8 }));
    const awsIn = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), new THREE.MeshBasicMaterial({ color: 0x9ee6f0 }));
    const awsRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.015, 6, 96), new THREE.MeshBasicMaterial({ color: 0x6fd3e2, transparent: true, opacity: 0.7 })); awsRing.rotation.x = Math.PI / 2.3;
    aws.add(awsCore, awsIn, awsRing);
    const awsL = label('AWS us-east-1 · monitoreo', 'lbl3d-core'); awsL.position.set(0, 1.05, 0); aws.add(awsL);
    awsCore.userData = { tip: { title: 'AWS us-east-1', lines: ['Prometheus + Blackbox', `Túnel VPN a la sede: ${vpn ? (vpn.ok ? fms(vpn.ms) : 'CAÍDO') : 'sin monitorear'}`] } };
    s.pickables.push(awsCore);
    g.add(aws);
    const sedeL = label(`SEDE PRINCIPAL · ${vpn ? (vpn.ok ? `VPN ${fms(vpn.ms)}` : 'VPN CAÍDA') : 'BOGOTÁ'}`, tone === 'crit' ? 'lbl3d-crit' : 'lbl3d-core');
    sedeL.position.set(-3.2, TOP + 1.1, 0); g.add(sedeL);

    // ---------- anillo de agencias (SD-WAN) ----------
    const ags = AGENCY_GEO.filter((a) => !a.hub);
    const agNodes = [];
    ags.forEach((a, i) => {
      const t = live[a.ip] ? linkState(live[a.ip])[1] : 'off', col = AG_TONE[t];
      const ang = (i / ags.length) * Math.PI * 2, R = 9.5;
      const pos = new THREE.Vector3(Math.cos(ang) * R, 0.25, Math.sin(ang) * R);
      const n = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: t === 'off' ? 0.2 : 1.1 }));
      n.position.copy(pos);
      n.userData = { tip: { title: a.name, lines: [live[a.ip] ? `${linkState(live[a.ip])[0]} · ${fms(live[a.ip].rtt)}` : 'Sin monitorear (pendiente FortiGate)', a.ip], hint: 'Clic para ver la red' }, href: '#/red', t };
      g.add(n); s.pickables.push(n); agNodes.push(n);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.5, 0.3, 0), new THREE.Vector3(pos.x * 0.5, 1.6, pos.z * 0.5), pos);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)), new THREE.LineDashedMaterial({ color: col, dashSize: 0.25, gapSize: t === 'off' ? 0.35 : 0.12, transparent: true, opacity: t === 'off' ? 0.35 : 0.8 }));
      line.computeLineDistances(); g.add(line);
      n.userData.curve = curve; n.userData.phase = i * 0.37;
      if (t !== 'off' && t !== 'crit') { const pk = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: col })); g.add(pk); n.userData.packet = pk; }
    });

    // ---------- detalles: losas por piso, entrada iluminada y techo (la torre va sola, sin entorno) ----------
    // losas visibles a través del vidrio
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.3, roughness: 0.6, emissive: 0x1e293b, emissiveIntensity: 0.4 });
    for (let f = 1; f < FLOORS; f++) bld.add(box(5.7, 0.07, 4.7, slabMat, 0.55, G0 + f * FH, -0.1));
    // marquesina y puerta iluminada
    bld.add(box(2.6, 0.08, 1.3, white, 1.3, G0 - 0.05, 2.95));
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, emissive: 0xfde68a, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.2 });
    bld.add(box(1.2, 0.95, 0.05, doorMat, 1.3, 0.48, 2.36));
    for (const dx of [0.35, 2.25]) bld.add(box(0.08, G0 - 0.1, 0.08, white, dx, (G0 - 0.1) / 2, 3.5));
    // techo: equipos de aire, paneles solares y antena con luz roja
    const hvac = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.7, roughness: 0.4 });
    [[-0.9, -1.2], [0.4, -1.4], [1.7, -1.2]].forEach(([x, z]) => { bld.add(box(0.8, 0.45, 0.8, hvac, x, TOP + 0.23, z)); const fanTop = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20), dark); fanTop.position.set(x, TOP + 0.47, z); bld.add(fanTop); });
    const solar = new THREE.MeshStandardMaterial({ color: 0x035f6b, metalness: 0.9, roughness: 0.15, emissive: 0x007b8d, emissiveIntensity: 0.15 });
    for (let k = 0; k < 4; k++) { const p = box(0.9, 0.04, 0.55, solar, -1.2 + k * 1.0, TOP + 0.3, 0.6); p.rotation.x = -0.35; bld.add(p); }
    const mast = box(0.05, 1.6, 0.05, hvac, 2.6, TOP + 0.8, -1.6); bld.add(mast);
    const antLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    antLight.position.set(2.6, TOP + 1.65, -1.6); bld.add(antLight);
    // luz cálida del vestíbulo
    const lobbyLight = new THREE.PointLight(0xfcd9a0, 1.2, 6, 2); lobbyLight.position.set(1.3, 1.2, 3.8); bld.add(lobbyLight);

    // ---------- escaneo holográfico ----------
    const scan = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.0, 64), new THREE.MeshBasicMaterial({ color: statusCol, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    scan.rotation.x = -Math.PI / 2; g.add(scan);

    const frame = (t) => {
      const k = s.reduce ? 0 : t;
      pulses.forEach((p) => { const f = (p.userData.o + k * 0.35) % 1; p.position.set(beam.position.x, TOP + 0.55 + f * beamH, beam.position.z); p.visible = tone !== 'crit'; p.scale.setScalar(0.6 + Math.sin(f * Math.PI) * 0.6); });
      antLight.visible = Math.sin(k * 3.2) > 0.2;
      awsCore.rotation.y = k * 0.6; awsCore.rotation.x = k * 0.3; awsRing.rotation.z = k * 0.8;
      scan.position.y = 0.2 + ((k * 0.9) % 1) * (TOP + 0.4); scan.material.opacity = 0.4 * (1 - ((k * 0.9) % 1));
      baseRing.material.opacity = tone === 'crit' ? 0.4 + Math.sin(k * 5) * 0.4 : 0.6 + Math.sin(k * 2) * 0.2;
      const ei = tone === 'crit' ? 0.5 + Math.sin(k * 5) * 0.45 : 0.3 + Math.sin(k * 1.3) * 0.08; whitePerf.emissiveIntensity = ei; wallMat.emissiveIntensity = ei; cornMat.emissiveIntensity = ei;
      for (const n of agNodes) {
        n.rotation.y = k * 1.2;
        const hot = s.hovered === n; n.scale.setScalar(hot ? 1.6 : 1);
        if (n.userData.packet) n.userData.packet.position.copy(n.userData.curve.getPoint((k * 0.4 + n.userData.phase) % 1));
      }
    };
    bld.rotation.y = Math.PI / 2; // muro perforado y lamas hacia la cámara, como en la foto
    // sombras: el edificio proyecta sobre la plaza
    bld.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    plaza.receiveShadow = true;
    s.frames.add(frame);
    return () => { s.frames.delete(frame); texs.forEach((x) => x.dispose()); };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Frame wrap={wrap} stage={stage} tip={tip} failed={failed} height={height} />;
}
