// Halloween symbol set (3 low + 4 high): one Spine 4.2 package per symbol.
// Each symbol = one AI image (sjinn / Nano Banana Pro, see source/prompts.jsonl) rigged as a weighted grid mesh
// whose zones (head, tail, jaw, flame, potion...) follow their own bones, + shared FX (glow, rays, flash, ring, stars, smoke).
//   node build_symbols.mjs   ->  ../<symbol>/package/*
import fs from 'node:fs';
import crypto from 'node:crypto';
import { load, chromaKey, alphaBox, crop, largestBlob, resize, procedural, pack, composePage } from '../../tools/imagekit.js';

const R = (v) => Math.round(v * 100) / 100;
const T = (t) => Math.round(t * 10000) / 10000;
const SC = '../scatter/parts/'; // shared FX images from the scatter
const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

// zones: bone name, centre [u, v] in the cropped symbol (0..1, v down), radius (fraction of width)
const SYMBOLS = [
  { id: 'candycorn', label: 'Bonbon maïs', tier: 'low', file: 'L1_candycorn.png', width: 150, zones: [{ b: 'tip', at: [0.72, 0.12], r: 0.35 }] },
  { id: 'wrapped', label: 'Bonbon emballé', tier: 'low', file: 'L2_wrapped.png', width: 175, blob: true, zones: [{ b: 'end_l', at: [0.12, 0.75], r: 0.22 }, { b: 'end_r', at: [0.86, 0.22], r: 0.22 }] },
  { id: 'apple', label: "Pomme d'amour", tier: 'low', file: 'L3_apple.png', width: 125, zones: [{ b: 'stick', at: [0.72, 0.1], r: 0.3 }, { b: 'drips', at: [0.45, 0.93], r: 0.35 }] },
  { id: 'cat', label: 'Chat noir', tier: 'high', rank: 1, file: 'H1_cat.png', width: 195, zones: [{ b: 'head', at: [0.36, 0.27], r: 0.3 }, { b: 'tail', at: [0.88, 0.42], r: 0.25 }, { b: 'bell', at: [0.35, 0.55], r: 0.1 }] },
  { id: 'skull', label: 'Crâne à la bougie', tier: 'high', rank: 2, file: 'H2_skull.png', width: 170, zones: [{ b: 'flame', at: [0.47, 0.04], r: 0.13 }, { b: 'candle', at: [0.47, 0.2], r: 0.2 }, { b: 'jaw', at: [0.45, 0.86], r: 0.27 }] },
  { id: 'cauldron', label: 'Chaudron', tier: 'high', rank: 3, file: 'H3_cauldron.png', width: 185, zones: [{ b: 'smoke', at: [0.45, 0.07], r: 0.22 }, { b: 'potion', at: [0.45, 0.33], r: 0.32 }, { b: 'ladle', at: [0.82, 0.18], r: 0.18 }] },
  { id: 'owl', label: 'Hibou', tier: 'high', rank: 4, file: 'H4_owl.png', width: 165, zones: [{ b: 'head', at: [0.5, 0.25], r: 0.33 }, { b: 'wing_l', at: [0.1, 0.58], r: 0.2 }, { b: 'wing_r', at: [0.9, 0.58], r: 0.2 }] },
];

const EASE = {
  in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1], sine: [0.37, 0, 0.63, 1], outBack: [0.34, 1.56, 0.64, 1],
  inBack: [0.36, 0, 0.66, -0.56], outQuad: [0.5, 1, 0.89, 1], inQuad: [0.11, 0, 0.5, 0], outCubic: [0.33, 1, 0.68, 1], outExpo: [0.16, 1, 0.3, 1],
};
function curve(t0, v0, t1, v1, e) {
  if (e === 'stepped') return 'stepped';
  const c = EASE[e];
  if (!c) return null;
  return v0.flatMap((_, i) => [T(t0 + c[0] * (t1 - t0)), R(v0[i] + c[1] * (v1[i] - v0[i])), T(t0 + c[2] * (t1 - t0)), R(v0[i] + c[3] * (v1[i] - v0[i]))]);
}
const tl = (keys, fields) => keys.map((k, i) => {
  const o = {}; if (k[0]) o.time = T(k[0]);
  fields.forEach((f, j) => (o[f] = R(k[1 + j])));
  const n = keys[i + 1]; if (n) { const c = curve(k[0], k.slice(1, 1 + fields.length), n[0], n.slice(1, 1 + fields.length), k[1 + fields.length]); if (c) o.curve = c; }
  return o;
});
const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
class Anim {
  constructor() { this.bones = {}; this.slots = {}; this.events = []; }
  rot(b, k) { (this.bones[b] ||= {}).rotate = tl(k, ['value']); return this; }
  move(b, k) { (this.bones[b] ||= {}).translate = tl(k, ['x', 'y']); return this; }
  scale(b, k) { (this.bones[b] ||= {}).scale = tl(k, ['x', 'y']); return this; }
  alpha(s, rgb, keys) {
    (this.slots[s] ||= {}).rgba = keys.map(([t, a, e], i) => {
      const o = {}; if (t) o.time = T(t); o.color = [...rgb, a].map(hex).join('');
      const n = keys[i + 1]; if (n) { const c = curve(t, [...rgb, a], n[0], [...rgb, n[1]], e); if (c) o.curve = c; }
      return o;
    });
    return this;
  }
  show(s, keys) { (this.slots[s] ||= {}).attachment = keys.map(([t, n]) => ({ ...(t ? { time: T(t) } : {}), name: n })); return this; }
  ev(t, name) { this.events.push({ ...(t ? { time: T(t) } : {}), name }); return this; }
  json() { const o = {}; if (Object.keys(this.slots).length) o.slots = this.slots; if (Object.keys(this.bones).length) o.bones = this.bones; if (this.events.length) o.events = this.events; return o; }
}

async function build(S) {
  const OUT = `../${S.id}/package`;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let raw = await load(`source/${S.file}`);
  if (S.blob) {
    // the faint olive "ghost" left by the AI (no orange/purple in it): turn it into background before keying
    for (let i = 0; i < raw.w * raw.h; i++) { const r = raw.px[i * 4], g = raw.px[i * 4 + 1], b = raw.px[i * 4 + 2]; if (g > b + 20 && g > r * 0.78 && r < 170) raw.px.set([0, 255, 0], i * 4); }
  }
  let img = chromaKey(raw, { minArea: 20000 });
  if (S.blob) img = largestBlob(img, 225);
  img = crop(img, alphaBox(img, 20), 4);
  const W = S.width, H = (W * img.h) / img.w;
  const high = S.tier === 'high';
  const items = [{ name: S.id, img: await resize(img, W * 2, H * 2) }];
  const size = { [S.id]: [W, H] };
  for (const [n, w] of [['star', 30], ['smoke_small', 70]]) { const i = await load(SC + n + '.png'); size[n] = [w, (w * i.h) / i.w]; items.push({ name: n, img: await resize(i, w * 2, size[n][1] * 2) }); }
  { const i = await load('../scatter/parts2/drop_small.png'); size.bubble = [14, (14 * i.h) / i.w]; items.push({ name: 'bubble', img: await resize(i, 28, size.bubble[1] * 2) }); }
  for (const [n, w, t] of [['glow', 300, 256], ['rays', 420, 512], ['flash', 260, 256], ['ring', 260, 256]]) { size[n] = [w, w]; items.push({ name: n, img: procedural(n, t) }); }
  const [page] = pack(items, { maxSize: 2048, padding: 4 });
  fs.writeFileSync(`${OUT}/${S.id}.png`, await composePage(page));
  fs.writeFileSync(`${OUT}/${S.id}.atlas`, `${S.id}.png\nsize:${page.w},${page.h}\nfilter:Linear,Linear\n` + page.rects.map((r) => `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`).join(''));

  // ---- bones: base at the bottom (squash pivot), body at the centre, one bone per zone
  const zp = (z) => [(z.at[0] - 0.5) * W, (0.5 - z.at[1]) * H]; // zone centre in body space
  const bones = [{ name: 'root' }, { name: 'main', parent: 'root' }, { name: 'glow', parent: 'main' }, { name: 'rays', parent: 'main' },
    { name: 'base', parent: 'main', y: R(-H / 2) }, { name: 'body', parent: 'base', y: R(H / 2) }];
  for (const z of S.zones) { const [x, y] = zp(z); bones.push({ name: z.b, parent: 'body', x: R(x), y: R(y) }); }
  const FXB = ['flash', 'ring', 'smoke1', 'smoke2', 'star1', 'star2', 'star3', 'star4', 'bubble1', 'bubble2', 'bubble3'];
  const STARS = [[-0.5, 0.45], [0.52, 0.3], [-0.45, -0.35], [0.48, -0.42]];
  for (const n of FXB) {
    const st = n.startsWith('star') ? STARS[Number(n.slice(4)) - 1] : null;
    bones.push({ name: n, parent: 'main', ...(st ? { x: R(st[0] * W), y: R(st[1] * H) } : {}), ...(n === 'smoke1' ? { x: R(-W * 0.35), y: R(-H * 0.45) } : {}), ...(n === 'smoke2' ? { x: R(W * 0.35), y: R(-H * 0.45) } : {}) });
  }
  const BI = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const zoneWorld = Object.fromEntries(S.zones.map((z) => [z.b, zp(z)])); // body space == mesh space (body has no rotation/scale)

  // ---- weighted grid mesh: each vertex = body + zones (gaussian falloff)
  const cols = 12, rows = 12, uvs = [], verts = [], tris = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    uvs.push(R(u), R(v));
    const x = (u - 0.5) * W, y = (0.5 - v) * H;
    let ws = S.zones.map((z) => [z.b, Math.exp(-(((u - z.at[0]) ** 2 + (v - z.at[1]) ** 2) / (z.r * z.r)) * 2.2)]).filter(([, w]) => w > 0.02);
    const zs = ws.reduce((a, [, w]) => a + w, 0);
    if (zs > 0.92) ws = ws.map(([b, w]) => [b, (w * 0.92) / zs]);
    ws.push(['body', Math.max(0.08, 1 - ws.reduce((a, [, w]) => a + w, 0))]);
    ws = ws.sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = ws.reduce((a, [, w]) => a + w, 0);
    verts.push(ws.length);
    for (const [b, w] of ws) { const o = b === 'body' ? [0, 0] : zoneWorld[b]; verts.push(BI[b], R(x - o[0]), R(y - o[1]), R(w / s)); }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; tris.push(a, c, b, b, c, d); }

  const att = (n, o = {}) => ({ width: R(size[n][0]), height: R(size[n][1]), ...o });
  const slots = [
    { name: 'glow', bone: 'glow', attachment: 'glow', color: high ? 'ff9a3a59' : 'ffb04a00', blend: 'additive' },
    { name: 'rays', bone: 'rays', attachment: 'rays', color: 'ffc35a00', blend: 'additive' },
    { name: 'smoke1', bone: 'smoke1' }, { name: 'smoke2', bone: 'smoke2' },
    { name: 'symbol', bone: 'body', attachment: S.id },
    { name: 'bubble1', bone: 'bubble1' }, { name: 'bubble2', bone: 'bubble2' }, { name: 'bubble3', bone: 'bubble3' },
    ...[1, 2, 3, 4].map((i) => ({ name: `star${i}`, bone: `star${i}`, attachment: 'star', color: 'ffffff00' })),
    { name: 'ring', bone: 'ring', blend: 'additive' },
    { name: 'flash', bone: 'flash', blend: 'additive' },
  ];
  const A = {
    glow: { glow: att('glow') }, rays: { rays: att('rays') },
    smoke1: { smoke_small: att('smoke_small') }, smoke2: { smoke_small: att('smoke_small') },
    symbol: { [S.id]: { type: 'mesh', uvs, triangles: tris, vertices: verts, hull: 0, width: R(W * 2), height: R(H * 2) } },
    bubble1: { bubble: att('bubble') }, bubble2: { bubble: att('bubble') }, bubble3: { bubble: att('bubble') },
    ...Object.fromEntries([1, 2, 3, 4].map((i) => [`star${i}`, { star: att('star', { scaleX: 0.8 + (i % 2) * 0.3, scaleY: 0.8 + (i % 2) * 0.3 }) }])),
    ring: { ring: att('ring') }, flash: { flash: att('flash') },
  };

  // ---- animations
  const anims = {};
  const WHITE = [1, 1, 1], GOLD = [1, 0.77, 0.35], ORANGE = [1, 0.6, 0.23];
  const twinkle = (a, i, t0, d = 0.5) => {
    a.alpha(`star${i}`, WHITE, [[0, 0], [t0, 0, 'outQuad'], [t0 + d * 0.35, 1, 'inQuad'], [t0 + d, 0]]);
    a.scale(`star${i}`, [[0, 0.2, 0.2], [t0, 0.2, 0.2, 'outBack'], [t0 + d * 0.35, 1.15, 1.15, 'inQuad'], [t0 + d, 0.3, 0.3]]);
    a.rot(`star${i}`, [[0, 0], [t0, 0], [t0 + d, 45]]);
  };
  const puff = (a, s, t0, dx, d = 0.55) => {
    a.show(s, [[0, null], [t0, 'smoke_small'], [t0 + d, null]]);
    a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + d, dx, 12]]);
    a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outCubic'], [t0 + d, 1.2, 1]]);
    a.alpha(s, WHITE, [[0, 0], [t0, 0.75, 'in'], [t0 + d, 0]]);
  };
  const bubbles = (a, t0, period, count = 3) => {
    const p = zoneWorld.potion || [0, H * 0.2];
    for (let i = 1; i <= count; i++) {
      const t = t0 + (i - 1) * period, x = p[0] + (i - 2) * W * 0.17;
      a.show(`bubble${i}`, [[0, null], [t, 'bubble'], [t + 0.7, null]]);
      a.move(`bubble${i}`, [[0, x, p[1]], [t, x, p[1], 'out'], [t + 0.7, x + (i % 2 ? 6 : -6), p[1] + H * 0.45]]);
      a.scale(`bubble${i}`, [[0, 0.3, 0.3], [t, 0.3, 0.3, 'outBack'], [t + 0.25, 1.2, 1.2], [t + 0.6, 1, 1, 'outQuad'], [t + 0.7, 1.8, 1.8]]);
      a.alpha(`bubble${i}`, WHITE, [[0, 1], [t + 0.55, 1, 'in'], [t + 0.7, 0]]);
    }
  };
  /** zone-specific motion: amp 1 = idle, bigger for win */
  function zones(a, D, amp, cyc = 1) {
    const s = (v) => v * amp;
    const loop = (b, kind, vals) => {
      const n = vals.length, keys = [];
      for (let c = 0; c < cyc; c++) vals.forEach((v, k) => keys.push([(c * n + k) * (D / (n * cyc)), ...(Array.isArray(v) ? v : [v]), 'sine']));
      keys.push([D, ...(Array.isArray(vals[0]) ? vals[0] : [vals[0]])]);
      a[kind](b, keys);
    };
    switch (S.id) {
      case 'candycorn': loop('tip', 'rot', [0, s(5), 0, s(-5)]); break;
      case 'wrapped': loop('end_l', 'rot', [0, s(10), 0, s(-6)]); loop('end_r', 'rot', [0, s(-10), 0, s(6)]); loop('end_l', 'scale', [[1, 1], [1 + s(0.06), 0.94], [1, 1], [0.95, 1 + s(0.06)]]); break;
      case 'apple': loop('stick', 'rot', [0, s(4), 0, s(-4)]); loop('drips', 'scale', [[1, 1], [1, 1 + s(0.12)], [1, 1], [1, 1 + s(0.05)]]); break;
      case 'cat': loop('head', 'rot', [0, s(5), 0, s(-4)]); loop('tail', 'rot', [0, s(14), 0, s(-10)]); loop('bell', 'rot', [0, s(12), 0, s(-12)]); break;
      case 'skull': loop('flame', 'scale', [[1, 1], [0.9, 1 + s(0.18)], [1.05, 0.95], [0.95, 1 + s(0.1)]]); loop('flame', 'rot', [0, s(6), 0, s(-6)]); loop('jaw', 'move', [[0, 0], [0, s(-3)], [0, 0], [0, s(-1.5)]]); break;
      case 'cauldron': loop('potion', 'scale', [[1, 1], [1.02, 1 + s(0.06)], [1, 1], [0.98, 1 + s(0.04)]]); loop('smoke', 'move', [[0, 0], [s(4), s(6)], [0, 0], [s(-4), s(3)]]); loop('ladle', 'rot', [0, s(4), 0, s(-3)]); break;
      case 'owl': loop('head', 'rot', [0, s(6), 0, s(-6)]); loop('wing_l', 'rot', [0, s(-5), 0, s(2)]); loop('wing_r', 'rot', [0, s(5), 0, s(-2)]); break;
    }
  }

  { // IDLE
    const D = 2.4, a = new Anim();
    a.scale('base', [[0, 1, 1, 'sine'], [D / 2, 1.02, 0.98, 'sine'], [D, 1, 1]]);
    zones(a, D, 1, 1);
    if (high) { a.alpha('glow', ORANGE, [[0, 0.35, 'sine'], [D / 2, 0.55, 'sine'], [D, 0.35]]); twinkle(a, 1, 0.4, 0.6); twinkle(a, 3, 1.5, 0.6); }
    if (S.id === 'cauldron') bubbles(a, 0.2, 0.75);
    anims.idle = a;
  }
  { // LAND
    const a = new Anim();
    a.move('main', [[0, 0, 45, 'inQuad'], [0.09, 0, 0]]);
    a.scale('base', [[0, 0.9, 1.12, 'inQuad'], [0.09, 1.18, 0.82, 'outQuad'], [0.22, 0.95, 1.06, 'inOut'], [0.34, 1.02, 0.98, 'inOut'], [0.45, 1, 1]]);
    zones(a, 0.45, 2.2, 1);
    puff(a, 'smoke1', 0.07, -25); puff(a, 'smoke2', 0.07, 25);
    a.ev(0.09, 'land');
    anims.land = a;
  }
  { // WIN
    const D = high ? 2.0 : 1.3, a = new Anim();
    a.scale('main', [[0, 1, 1, 'outBack'], [0.18, high ? 1.28 : 1.18, high ? 1.28 : 1.18, 'inOut'], [D * 0.55, high ? 1.18 : 1.1, high ? 1.18 : 1.1, 'inOut'], [D, 1, 1]]);
    a.scale('base', [[0, 1, 1, 'outQuad'], [0.08, 0.86, 1.15, 'outQuad'], [0.2, 1.12, 0.9, 'inOut'], [0.34, 0.97, 1.03, 'inOut'], [0.5, 1, 1]]);
    a.rot('body', [[0, 0], [0.2, 0, 'inOut'], [0.35, -5, 'inOut'], [0.5, 5, 'inOut'], [0.65, -2, 'inOut'], [0.8, 0]]);
    zones(a, D, high ? 3 : 2.2, high ? 3 : 2);
    if (S.id === 'skull') a.move('jaw', [[0, 0, 0], [0.15, 0, 0, 'outBack'], [0.3, 0, -12, 'inOut'], [0.45, 0, -3, 'inOut'], [0.6, 0, -12, 'inOut'], [0.75, 0, -3, 'inOut'], [0.9, 0, -12, 'inOut'], [1.2, 0, 0]]);
    if (S.id === 'owl') { a.rot('wing_l', [[0, 0], [0.15, 0, 'outBack'], [0.3, -28, 'inOut'], [0.45, -8, 'inOut'], [0.6, -28, 'inOut'], [0.75, -8, 'inOut'], [0.9, -28, 'inOut'], [1.2, 0]]); a.rot('wing_r', [[0, 0], [0.15, 0, 'outBack'], [0.3, 28, 'inOut'], [0.45, 8, 'inOut'], [0.6, 28, 'inOut'], [0.75, 8, 'inOut'], [0.9, 28, 'inOut'], [1.2, 0]]); }
    if (S.id === 'cat') a.move('head', [[0, 0, 0], [0.15, 0, 0, 'outBack'], [0.3, 0, 8, 'inOut'], [0.5, 0, 0, 'inOut'], [0.7, 0, 8, 'inOut'], [0.9, 0, 0]]);
    if (S.id === 'cauldron') bubbles(a, 0.1, 0.18);
    a.alpha('glow', ORANGE, [[0, high ? 0.35 : 0], [0.12, 1, 'out'], [D, high ? 0.35 : 0]]);
    a.scale('glow', [[0, 1, 1, 'outBack'], [0.2, 1.25, 1.25, 'inOut'], [D, 1, 1]]);
    if (high) { a.alpha('rays', GOLD, [[0, 0], [0.15, 0.85, 'sine'], [D * 0.7, 0.6, 'out'], [D, 0]]); a.rot('rays', [[0, 0], [D, -70]]); }
    a.show('flash', [[0, null], [0.1, 'flash'], [0.5, null]]);
    a.alpha('flash', WHITE, [[0, 0], [0.1, high ? 0.9 : 0.6, 'out'], [0.5, 0]]);
    a.scale('flash', [[0, 0.5, 0.5], [0.1, 0.6, 0.6, 'outCubic'], [0.5, 1.6, 1.6]]);
    a.show('ring', [[0, null], [0.12, 'ring'], [0.7, null]]);
    a.alpha('ring', GOLD, [[0, 0], [0.12, 1, 'in'], [0.7, 0]]);
    a.scale('ring', [[0, 0.3, 0.3], [0.12, 0.3, 0.3, 'outCubic'], [0.7, 1.9, 1.9]]);
    [1, 2, 3, 4].forEach((i) => twinkle(a, i, 0.12 + i * (high ? 0.15 : 0.1), 0.5));
    a.ev(0.1, 'win');
    anims.win = a;
  }
  { // EXIT (cascade / removal)
    const a = new Anim();
    a.scale('main', [[0, 1, 1, 'outQuad'], [0.12, 1.15, 1.15, 'inBack'], [0.38, 0, 0]]);
    a.rot('body', [[0, 0], [0.12, 0, 'in'], [0.38, high ? -40 : 30]]);
    a.show('flash', [[0, null], [0.25, 'flash'], [0.55, null]]);
    a.alpha('flash', WHITE, [[0, 0], [0.25, 0.8, 'out'], [0.55, 0]]);
    a.scale('flash', [[0, 0.3, 0.3], [0.25, 0.3, 0.3, 'outCubic'], [0.55, 1.3, 1.3]]);
    puff(a, 'smoke1', 0.22, -45, 0.45); puff(a, 'smoke2', 0.22, 45, 0.45);
    [1, 2, 3, 4].forEach((i) => twinkle(a, i, 0.22 + i * 0.04, 0.35));
    a.ev(0.3, 'pop');
    anims.exit = a;
  }
  if (high) { // ANTICIPATION (loop)
    const D = 1.0, a = new Anim();
    a.scale('main', [[0, 1.08, 1.08, 'sine'], [D / 2, 1.12, 1.12, 'sine'], [D, 1.08, 1.08]]);
    const shake = [];
    for (let i = 0; i <= 10; i++) shake.push([(i * D) / 10, i === 0 || i === 10 ? 0 : (i % 2 ? 1 : -1) * 3, 'sine']);
    a.rot('body', shake);
    zones(a, D, 1.6, 2);
    a.alpha('glow', ORANGE, [[0, 0.8, 'sine'], [D / 2, 1, 'sine'], [D, 0.8]]);
    a.alpha('rays', GOLD, [[0, 0.5, 'sine'], [D / 2, 0.7, 'sine'], [D, 0.5]]);
    a.rot('rays', [[0, 0], [D, 30]]);
    anims.anticipation = a;
  }

  const skel = {
    skeleton: { hash: '', spine: '4.2.43', x: R(-W), y: R(-H), width: R(W * 2), height: R(H * 2), images: './images/', audio: '' },
    bones, slots, skins: [{ name: 'default', attachments: A }],
    events: { land: {}, win: {}, pop: {} },
    animations: Object.fromEntries(Object.entries(anims).map(([k, v]) => [k, v.json()])),
  };
  skel.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skel)).digest('base64').slice(0, 11);
  fs.writeFileSync(`${OUT}/${S.id}.json`, JSON.stringify(skel));
  fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
    id: `creations/halloween/${S.id}`, package: S.id, name: S.id, label: S.label, game: 'Halloween (créations)', game_slug: 'halloween',
    format: 'spine', skeleton_format: 'json', skeleton_file: `${S.id}.json`, skeleton_version: '4.2.43', category: 'symbol',
    subtypes: [high ? 'high_pay' : 'low_pay', 'land', 'idle', 'win', 'exit', ...(high ? ['anticipation'] : [])], tier: S.tier, rank: S.rank || null,
    animations: Object.keys(anims), events: Object.keys(skel.events), bones_count: bones.length, slots_count: slots.length, skins: ['default'],
    atlases: [{ file: `${S.id}.atlas`, pages: [`${S.id}.png`] }], textures: [{ file: `${S.id}.png`, page: `${S.id}.png`, width: page.w, height: page.h, pma: false }],
    complete: true, warnings: [], source_image: `symbols/source/${S.file}`,
  }, null, 1));
  return `${S.id}: ${bones.length} os, ${Object.keys(anims).length} anims (${Object.keys(anims).join(', ')})`;
}

for (const S of SYMBOLS) console.log(await build(S));
