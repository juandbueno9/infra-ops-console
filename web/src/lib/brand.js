// Monograma "C•" de la marca del panel (diseño propio inspirado en el azul corporativo de Infra Ops):
// una C de trazo variable (más gruesa a la izquierda, puntas redondeadas) y un punto de "pulso" en la abertura.
// Se usa igual en SVG (menú) y en three.js (logo 3D y fachada del edificio). Coordenadas SVG 0..48 (y hacia abajo).
export const BRAND = { blue: '#2F7CF6', sky: '#5AB8FF', deep: '#1E3A8A', cyan: '#22D3EE', lime: '#A3E635', gray: '#23282D' };

export function monogram(steps = 64) {
  const R = 19, r = 12.4, cx = 24, cy = 24, icx = 27.4; // interior desplazado → trazo variable
  const a0 = (40 * Math.PI) / 180, a1 = (320 * Math.PI) / 180;
  const pt = (x0, rad, a) => [x0 + Math.cos(a) * rad, cy - Math.sin(a) * rad];
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(pt(cx, R, a0 + ((a1 - a0) * i) / steps));
  // punta inferior redondeada (de exterior a interior)
  const e1 = pt(cx, R, a1), e2 = pt(icx, r, a1), m1 = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], cr1 = Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) / 2;
  const base1 = Math.atan2(-(e1[1] - m1[1]), e1[0] - m1[0]);
  for (let i = 1; i < 12; i++) { const a = base1 + (Math.PI * i) / 12; out.push([m1[0] + Math.cos(a) * cr1, m1[1] - Math.sin(a) * cr1]); }
  for (let i = steps; i >= 0; i--) out.push(pt(icx, r, a0 + ((a1 - a0) * i) / steps));
  // punta superior redondeada (de interior a exterior)
  const f1 = pt(icx, r, a0), f2 = pt(cx, R, a0), m2 = [(f1[0] + f2[0]) / 2, (f1[1] + f2[1]) / 2], cr2 = Math.hypot(f1[0] - f2[0], f1[1] - f2[1]) / 2;
  const base2 = Math.atan2(-(f1[1] - m2[1]), f1[0] - m2[0]);
  for (let i = 1; i < 12; i++) { const a = base2 + (Math.PI * i) / 12; out.push([m2[0] + Math.cos(a) * cr2, m2[1] - Math.sin(a) * cr2]); }
  return { outline: out, dot: { cx: 38.2, cy: 24, r: 3.6 } };
}

export function monogramPath() {
  const { outline, dot } = monogram(48);
  const c = outline.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
  const d = `M${dot.cx - dot.r} ${dot.cy}a${dot.r} ${dot.r} 0 1 0 ${dot.r * 2} 0a${dot.r} ${dot.r} 0 1 0 ${-dot.r * 2} 0Z`;
  return { c, d };
}
