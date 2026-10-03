// Halloween V2 — FS mascot (ghost on a gravestone), rigged like the scatter V1:
// separated parts (ghost body + swappable faces, stone, slime with drips, letters F/S), weighted meshes, physics.
//   node mascot/build.mjs   ->  mascot/package/*
import fs from 'node:fs';
import crypto from 'node:crypto';
import { load, chromaKey, components, alphaBox, crop, resize, procedural, pack, composePage } from '../../tools/imagekit.js';

const NAME = 'fs_ghost';
const OUT = 'mascot/package';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const S = (f) => `source/${f}.png`;
const R = (v) => Math.round(v * 100) / 100;
const T = (t) => Math.round(t * 10000) / 10000;
const blank = (w, h) => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
const diff = (A, B, i) => Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]);
function dilate(m, w, h, r) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && dx * dx + dy * dy <= r * r) o[Y * w + X] = 1; }
  }
  return o;
}
const erode = (m, w, h, r) => dilate(m.map((v) => (v ? 0 : 1)), w, h, r).map((v) => (v ? 0 : 1));
function masked(src, m, feather = 0) {
  const o = blank(src.w, src.h);
  const inner = feather ? erode(m, src.w, src.h, feather) : m;
  for (let i = 0; i < src.w * src.h; i++) if (m[i]) { o.px.set(src.px.subarray(i * 4, i * 4 + 4), i * 4); if (!inner[i]) o.px[i * 4 + 3] *= 0.5; }
  return o;
}
const maskImg = (m, w, h) => { const o = blank(w, h); for (let i = 0; i < w * h; i++) if (m[i]) o.px[i * 4 + 3] = 255; return o; };

// ------------------------------------------------------------------ cut
const ghost = chromaKey(await load(S('m_ghost')), { minArea: 20000 });
const bodyG = chromaKey(await load(S('m_ghost_blank')), { minArea: 20000 });
const blinkG = chromaKey(await load(S('m_ghost_blink')), { minArea: 20000 });
const happyG = chromaKey(await load(S('m_ghost_happy')), { minArea: 20000 });
const stone = chromaKey(await load(S('m_tomb_blank')), { minArea: 20000 });
const tomb = chromaKey(await load(S('m_tomb2')), { minArea: 20000 });
const W = ghost.w, H = ghost.h; // all sources 2048x2048 and pixel-aligned
const A = (img, i) => img.px[i * 4 + 3] > 127;

// face region = where the expressions differ (+ margin)
const fm = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (A(ghost, i) && (diff(ghost, blinkG, i * 4) > 70 || diff(ghost, happyG, i * 4) > 70)) fm[i] = 1;
const fbox0 = components(maskImg(erode(fm, W, H, 2), W, H), { minArea: 400, gap: 12 });
const fu = fbox0.reduce((u, b) => ({ x0: Math.min(u.x0, b.x), y0: Math.min(u.y0, b.y), x1: Math.max(u.x1, b.x + b.w), y1: Math.max(u.y1, b.y + b.h) }), { x0: W, y0: H, x1: 0, y1: 0 });
const pad = 28;
const faceBox = { x: fu.x0 - pad, y: fu.y0 - pad, w: fu.x1 - fu.x0 + pad * 2, h: fu.y1 - fu.y0 + pad * 2 };
const faceMask = new Uint8Array(W * H);
// soft ellipse covering the face box (the ghost is plain cream there: seamless swap)
for (let y = faceBox.y; y < faceBox.y + faceBox.h; y++) for (let x = faceBox.x; x < faceBox.x + faceBox.w; x++) {
  const dx = (x - (faceBox.x + faceBox.w / 2)) / (faceBox.w / 2), dy = (y - (faceBox.y + faceBox.h / 2)) / (faceBox.h / 2);
  if (dx * dx + dy * dy <= 1 && A(ghost, y * W + x)) faceMask[y * W + x] = 1;
}
const faceCrop = (img) => {
  const o = masked(img, faceMask, 6);
  // feather the ellipse edge for a seamless overlay
  return crop(o, faceBox, 0);
};

const stoneBox = alphaBox(stone, 128);
// slime + letters = what tomb2 adds on the bare stone
const added = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (A(tomb, i) && (!A(stone, i) || diff(tomb, stone, i * 4) > 70)) added[i] = 1;
const purple = (img, i) => { const r = img.px[i * 4], g = img.px[i * 4 + 1], b = img.px[i * 4 + 2]; return b > 100 && b > g + 30 && r > 60; };
const orange = (img, i) => { const r = img.px[i * 4], g = img.px[i * 4 + 1], b = img.px[i * 4 + 2]; return r > 170 && r - b > 90; };
const slimeCore = new Uint8Array(W * H), fill = new Uint8Array(W * H);
const topLimit = stoneBox.y + stoneBox.h * 0.45; // slime only on the upper part of the stone
for (let i = 0; i < W * H; i++) {
  const r = tomb.px[i * 4], b = tomb.px[i * 4 + 2];
  if (added[i] && purple(tomb, i) && b > 140 && r > 100 && Math.floor(i / W) < topLimit) slimeCore[i] = 1;
  if (added[i] && orange(tomb, i)) fill[i] = 1;
}
{ // keep only the main slime blob (connected to the top band)
  const im = maskImg(slimeCore, W, H);
  const bx = components(im, { minArea: 2000, gap: 3 }).sort((a, b2) => b2.w * b2.h - a.w * a.h)[0];
  for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; if (x < bx.x || x > bx.x + bx.w || y < bx.y || y > bx.y + bx.h) slimeCore[i] = 0; }
}
const slimeZone = dilate(slimeCore, W, H, 14);
const letterZone = dilate(fill, W, H, 40);
const slimeM = new Uint8Array(W * H), lettersM = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!added[i] && !(slimeZone[i] && A(tomb, i) && !A(stone, i))) continue;
  if (slimeZone[i]) slimeM[i] = 1;
  else if (letterZone[i]) lettersM[i] = 1;
}
const slimeImg = masked(tomb, dilate(slimeM, W, H, 1), 2);
// letters: each pixel goes to the nearest orange fill (F / S)
const fillBoxes = components(maskImg(fill, W, H), { minArea: 3000, gap: 2 }).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 2).sort((a, b) => a.x - b.x);
const lab = new Int32Array(W * H).fill(-1);
let q = [];
fillBoxes.forEach((b, k) => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = y * W + x; if (fill[i]) { lab[i] = k; q.push(i); } } });
while (q.length) { const nx = []; for (const i of q) for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < W * H && lab[j] < 0 && lettersM[j]) { lab[j] = lab[i]; nx.push(j); } q = nx; }
const letterImgs = fillBoxes.map((_, k) => { const m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (lab[i] === k) m[i] = 1; return masked(tomb, m, 2); });

// drips: columns where the slime hangs well below its band
const sb = alphaBox(slimeImg, 60);
const lowest = [];
for (let x = sb.x; x < sb.x + sb.w; x++) { let ly = -1; for (let y = sb.y + sb.h - 1; y >= sb.y; y--) if (slimeImg.px[(y * W + x) * 4 + 3] > 127) { ly = y; break; } lowest.push(ly); }
const sorted = lowest.filter((v) => v > 0).sort((a, b) => a - b);
const band = sorted[Math.floor(sorted.length * 0.35)];
const dripsPx = [];
let run = null;
lowest.forEach((ly, i) => { const x = sb.x + i; if (ly > band + 30) { if (!run) run = { x0: x, x1: x, tip: ly }; run.x1 = x; run.tip = Math.max(run.tip, ly); } else if (run) { dripsPx.push(run); run = null; } });
if (run) dripsPx.push(run);

// ------------------------------------------------------------------ units
const GHOST_W = 230;
const k = GHOST_W / alphaBox(ghost, 128).w; // px -> units, same scale for every piece (aligned sources)
const C = [W / 2, H / 2];
const U = (x, y) => [(x - C[0]) * k, (C[1] - y) * k];
const items = [], size = {}, off = {};
async function piece(name, img, box) {
  const c = crop(img, box, 2);
  const w = c.w * k, h = c.h * k;
  size[name] = [w, h];
  off[name] = U(c.x0 + c.w / 2, c.y0 + c.h / 2);
  items.push({ name, img: await resize(c, w * 2, h * 2) });
}
const STONE_SHIFT_Y = -330; // stone sits lower so the ghost floats above it (px of the source)
await piece('ghost', bodyG, alphaBox(bodyG, 8));
// each face = only the features of that expression (difference with the faceless body), soft edges
for (const [n, img] of [['face_angry', ghost], ['face_blink', blinkG], ['face_happy', happyG]]) {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (faceMask[i] && diff(img, bodyG, i * 4) > 40) m[i] = 1;
  await piece(n, masked(img, dilate(erode(m, W, H, 1), W, H, 5), 3), faceBox);
}
await piece('stone', stone, alphaBox(stone, 8));
await piece('slime', slimeImg, alphaBox(slimeImg, 8));
for (let i = 0; i < letterImgs.length; i++) await piece(`letter${i + 1}`, letterImgs[i], alphaBox(letterImgs[i], 8));
const SC = '../halloween/scatter/parts/';
for (const [n, w] of [['star', 40], ['smoke_small', 90], ['smoke_big', 130]]) { const i = await load(SC + n + '.png'); size[n] = [w, (w * i.h) / i.w]; items.push({ name: n, img: await resize(i, w * 2, size[n][1] * 2) }); }
for (const [n, w, t] of [['glow', 420, 256], ['rays', 620, 512], ['flash', 340, 256], ['ring', 340, 256]]) { size[n] = [w, w]; items.push({ name: n, img: procedural(n, t) }); }
const [page] = pack(items, { maxSize: 2048, padding: 4 });
fs.writeFileSync(`${OUT}/${NAME}.png`, await composePage(page));
fs.writeFileSync(`${OUT}/${NAME}.atlas`, `${NAME}.png\nsize:${page.w},${page.h}\nfilter:Linear,Linear\n` + page.rects.map((r) => `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`).join(''));

// ------------------------------------------------------------------ rig
const stoneY = STONE_SHIFT_Y * k;
const gb = alphaBox(ghost, 128);
const [gcx, gcy] = off.ghost;
const ghostH = size.ghost[1];
const bones = [], BI = {};
const bone = (name, parent, o = {}) => { BI[name] = bones.length; bones.push({ name, ...(parent ? { parent } : {}), ...Object.fromEntries(Object.entries(o).map(([a, v]) => [a, typeof v === 'number' ? R(v) : v])) }); };
bone('root'); bone('main', 'root');
bone('aura', 'main', { y: gcy }); bone('rays', 'main', { y: gcy });
bone('ghost', 'main', { x: gcx, y: gcy + 40 }); // floating body (raised above the stone)
const gl = (u, v) => { const [x, y] = U(gb.x + gb.w * u, gb.y + gb.h * v); return [x - gcx, y - gcy]; }; // ghost-local point
bone('g_head', 'ghost', { x: gl(0.42, 0.12)[0], y: gl(0.42, 0.12)[1] });
bone('g_curl', 'g_head', { x: gl(0.12, 0.03)[0] - gl(0.42, 0.12)[0], y: gl(0.12, 0.03)[1] - gl(0.42, 0.12)[1] });
bone('g_arm_l', 'ghost', { x: gl(0.17, 0.33)[0], y: gl(0.17, 0.33)[1] });
bone('g_arm_r', 'ghost', { x: gl(0.83, 0.33)[0], y: gl(0.83, 0.33)[1] });
const HEM = [0.12, 0.37, 0.63, 0.88];
HEM.forEach((u, i) => bone(`g_hem${i + 1}`, 'ghost', { x: gl(u, 0.9)[0], y: gl(u, 0.9)[1], rotation: -90, length: 30 }));
bone('face', 'ghost', { x: off.face_angry[0] - gcx, y: off.face_angry[1] - gcy });
bone('tomb', 'main', { y: stoneY, scaleX: 0.86, scaleY: 0.86 });
bone('slime', 'tomb', { x: off.slime[0], y: off.slime[1] });
const DR = dripsPx.filter((d) => d.x1 - d.x0 > 8).map((d) => ({ x: ((d.x0 + d.x1) / 2 - C[0]) * k - off.slime[0], tip: (C[1] - d.tip) * k - off.slime[1], band: (C[1] - band) * k - off.slime[1], w: (d.x1 - d.x0) * k }));
DR.forEach((d, i) => bone(`drip${i + 1}`, 'slime', { x: d.x, y: d.band, rotation: -90, length: Math.max(4, d.band - d.tip) }));
letterImgs.forEach((_, i) => bone(`letter${i + 1}`, 'tomb', { x: off[`letter${i + 1}`][0], y: off[`letter${i + 1}`][1] }));
bone('shine', 'tomb', { x: -150, y: off.letter1[1] });
for (const n of ['flash', 'ring']) bone(n, 'main', { y: gcy - 30 });
const STARS = [[-150, 210], [160, 170], [-185, -10], [180, -70], [-120, -170], [130, 260]];
STARS.forEach(([x, y], i) => bone(`star${i + 1}`, 'main', { x, y }));
bone('smoke1', 'main', { x: -95, y: stoneY + off.stone[1] - size.stone[1] / 2 + 20 });
bone('smoke2', 'main', { x: 95, y: stoneY + off.stone[1] - size.stone[1] / 2 + 20 });

// world matrices (no rotations except drips/hem, used only for weights)
const world = {};
for (const b of bones) {
  const r = ((b.rotation || 0) * Math.PI) / 180;
  const l = [Math.cos(r), -Math.sin(r), b.x || 0, Math.sin(r), Math.cos(r), b.y || 0];
  const p = b.parent ? world[b.parent] : [1, 0, 0, 0, 1, 0];
  world[b.name] = [p[0] * l[0] + p[1] * l[3], p[0] * l[1] + p[1] * l[4], p[0] * l[2] + p[1] * l[5] + p[2], p[3] * l[0] + p[4] * l[3], p[3] * l[1] + p[4] * l[4], p[3] * l[2] + p[4] * l[5] + p[5]];
}
const toLocal = (b, [x, y]) => { const m = world[b]; const d = m[0] * m[4] - m[1] * m[3]; const dx = x - m[2], dy = y - m[5]; return [(m[4] * dx - m[1] * dy) / d, (-m[3] * dx + m[0] * dy) / d]; };
const pos = (b) => [world[b][2], world[b][5]];
function gridMesh(region, centre, cols, rows, weights) {
  const [w, h] = size[region];
  const uvs = [], verts = [], tris = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    uvs.push(R(u), R(v));
    const wp = [centre[0] + (u - 0.5) * w, centre[1] + (0.5 - v) * h];
    let ws = weights(wp[0], wp[1]).filter(([, x]) => x > 0.001);
    const s = ws.reduce((a, [, x]) => a + x, 0);
    ws = ws.map(([b, x]) => [b, x / s]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s2 = ws.reduce((a, [, x]) => a + x, 0);
    verts.push(ws.length);
    for (const [b, x] of ws) { const lp = toLocal(b, wp); verts.push(BI[b], R(lp[0]), R(lp[1]), R(x / s2)); }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; tris.push(a, c, b, b, c, d); }
  return { type: 'mesh', path: region, uvs, triangles: tris, vertices: verts, hull: 0, width: R(w * 2), height: R(h * 2) };
}
const gauss = (p, c, r) => Math.exp(-((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2) / (r * r));
const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const ghostWeights = (x, y) => {
  const p = [x, y];
  const out = [['ghost', 0.35]];
  out.push(['g_arm_l', gauss(p, pos('g_arm_l'), 42) * 1.6], ['g_arm_r', gauss(p, pos('g_arm_r'), 42) * 1.6]);
  out.push(['g_curl', gauss(p, pos('g_curl'), 30) * 1.4], ['g_head', gauss(p, pos('g_head'), 70) * 0.6]);
  const hemY = pos('g_hem1')[1];
  const low = smooth((hemY + 45 - y) / 70);
  HEM.forEach((_, i) => out.push([`g_hem${i + 1}`, low * gauss([x, 0], [pos(`g_hem${i + 1}`)[0], 0], 40) * 1.8]));
  return out;
};
const slimeWeights = (x, y) => {
  const out = [['slime', 1]];
  DR.forEach((d, i) => {
    const lp = toLocal('slime', [x, y]);
    const len = Math.max(4, d.band - d.tip);
    const down = Math.max(0, Math.min(1, (d.band - lp[1]) / len)), side = smooth(1 - Math.abs(lp[0] - d.x) / (d.w * 1.1 + 10));
    const w = side * smooth(down * 1.1);
    if (w > 0) out.push([`drip${i + 1}`, w * 1.3]);
  });
  return out;
};

const slots = [], AT = {};
const slot = (name, b, att = name, o = {}) => slots.push({ name, bone: b, ...(att ? { attachment: att } : {}), ...o });
const put = (s, key, v) => ((AT[s] ||= {})[key] = v);
const att = (n, o = {}) => ({ width: R(size[n][0]), height: R(size[n][1]), ...o });
slot('aura', 'aura', 'glow', { color: 'b9c8ff73', blend: 'additive' }); put('aura', 'glow', att('glow'));
slot('rays', 'rays', 'rays', { color: 'ffe7a000', blend: 'additive' }); // invisible until animated put('rays', 'rays', att('rays'));
slot('smoke1', 'smoke1', null); slot('smoke2', 'smoke2', null);
for (const s of ['smoke1', 'smoke2']) { put(s, 'smoke_small', att('smoke_small')); put(s, 'smoke_big', att('smoke_big')); }
slot('ghost_clip', 'main', 'ghost_clip');
{ const cut = stoneY + (off.stone[1] + size.stone[1] * 0.12) * 0.86; put('ghost_clip', 'ghost_clip', { type: 'clipping', end: 'face', vertexCount: 4, vertices: [-600, cut, 600, cut, 600, 1200, -600, 1200].map(R) }); }
slot('ghost', 'ghost'); put('ghost', 'ghost', gridMesh('ghost', [off.ghost[0], off.ghost[1]], 10, 12, ghostWeights));
slot('face', 'face', 'face_angry');
for (const n of ['face_angry', 'face_blink', 'face_happy']) put('face', n, att(n));
slot('stone', 'tomb'); put('stone', 'stone', att('stone', { x: off.stone[0], y: off.stone[1] }));
letterImgs.forEach((_, i) => { slot(`letter${i + 1}`, `letter${i + 1}`); put(`letter${i + 1}`, `letter${i + 1}`, att(`letter${i + 1}`)); });
slot('clip', 'tomb', 'clip');
{ const sw = size.stone[0] * 0.42, sh = size.stone[1] * 0.42; const [cx, cy] = off.stone; put('clip', 'clip', { type: 'clipping', end: 'shine', vertexCount: 4, vertices: [cx - sw, cy - sh, cx + sw, cy - sh, cx + sw, cy + sh, cx - sw, cy + sh].map(R) }); }
slot('shine', 'shine', 'flash', { color: 'ffffff00', blend: 'additive' }); put('shine', 'flash', att('flash', { scaleX: 0.25, scaleY: 1.4, rotation: -18 }));
slot('slime', 'slime'); put('slime', 'slime', gridMesh('slime', [off.slime[0], stoneY + off.slime[1]], 30, 10, slimeWeights));
STARS.forEach((_, i) => { slot(`star${i + 1}`, `star${i + 1}`, 'star', { color: 'ffffff00' }); put(`star${i + 1}`, 'star', att('star', { scaleX: 0.7 + (i % 3) * 0.15, scaleY: 0.7 + (i % 3) * 0.15 })); });
slot('ring', 'ring', null, { blend: 'additive' }); put('ring', 'ring', att('ring'));
slot('flash', 'flash', null, { blend: 'additive' }); put('flash', 'flash', att('flash'));

const physics = [
  { name: 'p_curl', bone: 'g_curl', x: 1, y: 1, inertia: 0.6, strength: 120, damping: 0.8 },
  { name: 'p_arm_l', bone: 'g_arm_l', y: 1, inertia: 0.5, strength: 140, damping: 0.85 },
  { name: 'p_arm_r', bone: 'g_arm_r', y: 1, inertia: 0.5, strength: 140, damping: 0.85 },
  ...HEM.map((_, i) => ({ name: `p_hem${i + 1}`, bone: `g_hem${i + 1}`, x: 1, inertia: 0.7, strength: 90 + i * 10, damping: 0.75 })),
  ...DR.map((_, i) => ({ name: `p_drip${i + 1}`, bone: `drip${i + 1}`, rotate: 1, inertia: 0.8, strength: 80 + i * 8, damping: 0.7, gravity: 30 })),
];

// ------------------------------------------------------------------ animations
const EASE = { in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1], sine: [0.37, 0, 0.63, 1], outBack: [0.34, 1.56, 0.64, 1], inBack: [0.36, 0, 0.66, -0.56], outQuad: [0.5, 1, 0.89, 1], inQuad: [0.11, 0, 0.5, 0], outCubic: [0.33, 1, 0.68, 1], inCubic: [0.32, 0, 0.67, 0], outExpo: [0.16, 1, 0.3, 1] };
const curve = (t0, v0, t1, v1, e) => { if (e === 'stepped') return 'stepped'; const c = EASE[e]; if (!c) return null; return v0.flatMap((_, i) => [T(t0 + c[0] * (t1 - t0)), R(v0[i] + c[1] * (v1[i] - v0[i])), T(t0 + c[2] * (t1 - t0)), R(v0[i] + c[3] * (v1[i] - v0[i]))]); };
const tl = (keys, f) => keys.map((kk, i) => { const o = {}; if (kk[0]) o.time = T(kk[0]); f.forEach((n, j) => (o[n] = R(kk[1 + j]))); const nx = keys[i + 1]; if (nx) { const c = curve(kk[0], kk.slice(1, 1 + f.length), nx[0], nx.slice(1, 1 + f.length), kk[1 + f.length]); if (c) o.curve = c; } return o; });
const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
class Anim {
  constructor() { this.bones = {}; this.slots = {}; this.events = []; this.physics = {}; }
  b(n) { if (!(n in BI)) throw new Error('bone ' + n); return (this.bones[n] ||= {}); }
  rot(n, kk) { this.b(n).rotate = tl(kk, ['value']); return this; }
  move(n, kk) { this.b(n).translate = tl(kk, ['x', 'y']); return this; }
  scale(n, kk) { this.b(n).scale = tl(kk, ['x', 'y']); return this; }
  alpha(s, rgb, keys) { (this.slots[s] ||= {}).rgba = keys.map(([t, a, e], i) => { const o = {}; if (t) o.time = T(t); o.color = [...rgb, a].map(hex).join(''); const nx = keys[i + 1]; if (nx) { const c = curve(t, [...rgb, a], nx[0], [...rgb, nx[1]], e); if (c) o.curve = c; } return o; }); return this; }
  show(s, keys) { (this.slots[s] ||= {}).attachment = keys.map(([t, n]) => ({ ...(t ? { time: T(t) } : {}), name: n })); return this; }
  phys(n, t, keys) { (this.physics[n] ||= {})[t] = t === 'reset' ? keys.map((x) => (x ? { time: T(x) } : {})) : tl(keys, ['value']); return this; }
  ev(t, name) { this.events.push({ ...(t ? { time: T(t) } : {}), name }); return this; }
  json() { const o = {}; for (const kk of ['slots', 'bones', 'physics']) if (Object.keys(this[kk]).length) o[kk] = this[kk]; if (this.events.length) o.events = this.events.sort((a, b) => (a.time || 0) - (b.time || 0)); return o; }
}
const WHITE = [1, 1, 1], GOLD = [1, 0.85, 0.45], MINT = [0.72, 0.78, 1], LETTERS = letterImgs.length;
const twinkle = (a, i, t0, d = 0.5) => {
  a.alpha(`star${i}`, WHITE, [[0, 0], [t0, 0, 'outQuad'], [t0 + d * 0.35, 1, 'inQuad'], [t0 + d, 0]]);
  a.scale(`star${i}`, [[0, 0.2, 0.2], [t0, 0.2, 0.2, 'outBack'], [t0 + d * 0.35, 1.15, 1.15, 'inQuad'], [t0 + d, 0.3, 0.3]]);
  a.rot(`star${i}`, [[0, 0], [t0, 0], [t0 + d, 45]]);
};
const puff = (a, s, t0, dx, img = 'smoke_small', d = 0.6, peak = 0.7) => {
  a.show(s, [[0, null], [t0, img], [t0 + d, null]]);
  a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + d, dx, 14]]);
  a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outCubic'], [t0 + d, 1.2, 1]]);
  a.alpha(s, WHITE, [[0, 0], [t0, peak, 'in'], [t0 + d, 0]]);
};
const face = (a, keys) => a.show('face', keys);
const float = (a, D, amp = 10) => {
  a.move('ghost', [[0, 0, 0, 'sine'], [D / 2, 0, amp, 'sine'], [D, 0, 0]]);
  a.rot('ghost', [[0, 0, 'sine'], [D / 4, 2, 'sine'], [(3 * D) / 4, -2, 'sine'], [D, 0]]);
};
const arms = (a, D, amp, cyc = 2) => {
  for (const [s, dir] of [['l', 1], ['r', -1]]) {
    const kk = [];
    for (let c = 0; c < cyc; c++) { kk.push([(c * D) / cyc, 0, 0, 'sine']); kk.push([((c + 0.5) * D) / cyc, 0, amp * (s === 'l' ? 1 : 0.8), 'sine']); }
    kk.push([D, 0, 0]);
    a.move(`g_arm_${s}`, kk);
    void dir;
  }
};
const hemWave = (a, D, amp, cyc = 2) => HEM.forEach((_, i) => {
  const kk = [];
  for (let c = 0; c <= cyc * 2; c++) kk.push([(c * D) / (cyc * 2), c % 2 ? amp : -amp * 0.4, 'sine']);
  kk[kk.length - 1][1] = kk[0][1];
  a.rot(`g_hem${i + 1}`, kk.map(([t, v, e], j) => [t, v * (j % 2 ? 1 : 1) * (i % 2 ? -1 : 1), e]));
});
const letterHop = (a, t0, step, amp, d = 0.4) => { for (let i = 1; i <= LETTERS; i++) { const t = t0 + (i - 1) * step; a.move(`letter${i}`, [[0, 0, 0], [t, 0, 0, 'outQuad'], [t + d * 0.45, 0, amp, 'inQuad'], [t + d, 0, 0]]); a.scale(`letter${i}`, [[0, 1, 1], [t, 1, 1, 'outQuad'], [t + d * 0.45, 1.12, 1.12, 'inOut'], [t + d * 0.8, 0.95, 1.05, 'inOut'], [t + d, 1, 1]]); } };
const dripStretch = (a, i, t0, t1, amount) => a.scale(`drip${i}`, [[0, 1, 1], [t0, 1, 1, 'sine'], [t1 - 0.15, amount, 0.92, 'outBack'], [t1, 0.95, 1.05, 'outQuad'], [t1 + 0.25, 1, 1]]);
const shine = (a, t0, d = 0.55, peak = 0.75) => { a.move('shine', [[0, 0, 0], [t0, 0, 0, 'inOut'], [t0 + d, 300, 0]]); a.alpha('shine', WHITE, [[0, 0], [t0, peak], [t0 + d, peak, 'stepped'], [t0 + d + 0.01, 0]]); };
const anims = {};

{ // INTRO: stone rises, ghost swoops up from behind it, letters pop
  const a = new Anim();
  a.move('tomb', [[0, 0, -120, 'outBack'], [0.35, 0, 8, 'inOut'], [0.45, 0, 0]]);
  a.scale('tomb', [[0, 0.6, 0.2, 'outBack'], [0.35, 1.08, 0.95, 'inOut'], [0.5, 1, 1]]);
  a.move('ghost', [[0, 0, -180], [0.3, 0, -180, 'outBack'], [0.75, 0, 18, 'inOut'], [0.95, 0, 0]]);
  a.scale('ghost', [[0, 0.4, 0.7], [0.3, 0.4, 0.7, 'outBack'], [0.7, 1.05, 0.97, 'inOut'], [0.9, 1, 1]]);
  a.rot('ghost', [[0, 0], [0.3, -14, 'outQuad'], [0.7, 6, 'inOut'], [0.95, 0]]);
  a.alpha('ghost', WHITE, [[0, 0], [0.3, 0, 'out'], [0.55, 1]]); a.alpha('face', WHITE, [[0, 0], [0.3, 0, 'out'], [0.55, 1]]);
  a.move('g_arm_l', [[0, 0, 0], [0.55, 0, 0, 'outBack'], [0.8, 0, 26, 'inOut'], [1.1, 0, 0]]);
  a.move('g_arm_r', [[0, 0, 0], [0.6, 0, 0, 'outBack'], [0.85, 0, 22, 'inOut'], [1.15, 0, 0]]);
  face(a, [[0, 'face_angry'], [1.15, 'face_blink'], [1.27, 'face_angry']]);
  DR.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 0.05, 1], [0.45 + i * 0.05, 0.05, 1, 'outBack'], [0.9 + i * 0.05, 1.2, 0.95, 'inOut'], [1.15 + i * 0.05, 1, 1]]));
  for (let i = 1; i <= LETTERS; i++) { const t = 0.5 + i * 0.12; a.scale(`letter${i}`, [[0, 0, 0], [t, 0, 0, 'outBack'], [t + 0.25, 1.2, 1.2, 'inOut'], [t + 0.4, 1, 1]]); }
  a.alpha('aura', MINT, [[0, 0], [0.5, 0, 'out'], [1, 0.45]]);
  puff(a, 'smoke1', 0.25, -40); puff(a, 'smoke2', 0.27, 40);
  shine(a, 1.05);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.8 + i * 0.07, 0.5));
  a.ev(0.35, 'land').ev(0.55, 'woosh');
  anims.intro = a;
}
{ // IDLE: float, arms sway, hem ripples, slime drips stretch, blink
  const D = 3.2, a = new Anim();
  float(a, D, 10); arms(a, D, 8, 2); hemWave(a, D, 7, 2);
  a.rot('g_curl', [[0, 0, 'sine'], [D / 4, 10, 'sine'], [(3 * D) / 4, -6, 'sine'], [D, 0]]);
  face(a, [[0, 'face_angry'], [2.1, 'face_blink'], [2.22, 'face_angry']]);
  a.alpha('aura', MINT, [[0, 0.45, 'sine'], [D / 2, 0.65, 'sine'], [D, 0.45]]);
  a.scale('aura', [[0, 1, 1, 'sine'], [D / 2, 1.06, 1.06, 'sine'], [D, 1, 1]]);
  DR.forEach((_, i) => dripStretch(a, i + 1, 0.2 + i * 0.5 % 1.8, 1.4 + (i * 0.5) % 1.8, 1.2 + (i % 2) * 0.1));
  letterHop(a, 2.5, 0.08, 4, 0.4);
  shine(a, 1.0, 0.6, 0.5);
  [[1, 0.3], [3, 1.4], [5, 2.4]].forEach(([i, t]) => twinkle(a, i, t, 0.6));
  anims.idle = a;
}
{ // LAND
  const a = new Anim();
  a.move('main', [[0, 0, 40, 'inQuad'], [0.09, 0, 0]]);
  a.scale('tomb', [[0, 1, 1], [0.09, 1.1, 0.88, 'outQuad'], [0.24, 0.97, 1.03, 'inOut'], [0.4, 1, 1]]);
  a.move('ghost', [[0, 0, 0], [0.09, 0, 0, 'outQuad'], [0.2, 0, -14, 'inOut'], [0.36, 0, 4, 'inOut'], [0.5, 0, 0]]);
  a.scale('ghost', [[0, 1, 1], [0.09, 1, 1, 'outQuad'], [0.18, 1.08, 0.92, 'inOut'], [0.34, 0.98, 1.02, 'inOut'], [0.5, 1, 1]]);
  face(a, [[0, 'face_angry'], [0.09, 'face_blink'], [0.2, 'face_angry']]);
  DR.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 1, 1], [0.09, 1, 1, 'outQuad'], [0.2, 1.3, 0.92, 'inOut'], [0.4, 0.95, 1.04, 'inOut'], [0.55, 1, 1]]));
  puff(a, 'smoke1', 0.07, -30, 'smoke_small', 0.45, 0.55); puff(a, 'smoke2', 0.07, 30, 'smoke_small', 0.45, 0.55);
  a.ev(0.09, 'land');
  anims.land = a;
}
const antiBase = (a, t) => { a.scale('main', [[0, 1, 1, 'outBack'], [t, 1.08, 1.08]]); a.alpha('aura', MINT, [[0, 0.45, 'out'], [t, 0.9]]); a.alpha('rays', GOLD, [[0, 0, 'out'], [t, 0.5]]); };
{ // ANTICIPATION (start)
  const a = new Anim();
  antiBase(a, 0.35);
  a.move('ghost', [[0, 0, 0, 'outBack'], [0.35, 0, 22]]);
  a.move('g_arm_l', [[0, 0, 0, 'outBack'], [0.35, 0, 30]]); a.move('g_arm_r', [[0, 0, 0, 'outBack'], [0.35, 0, 30]]);
  a.ev(0, 'tease');
  anims.anticipation = a;
}
{ // ANTICIPATION_IDLE (loop)
  const D = 1.2, a = new Anim();
  a.scale('main', [[0, 1.08, 1.08, 'sine'], [D / 2, 1.11, 1.11, 'sine'], [D, 1.08, 1.08]]);
  a.move('ghost', [[0, 0, 22, 'sine'], [D / 2, 0, 30, 'sine'], [D, 0, 22]]);
  const sh = []; for (let i = 0; i <= 12; i++) sh.push([(i * D) / 12, i === 0 || i === 12 ? 0 : (i % 2 ? 1 : -1) * 3, 'sine']);
  a.rot('ghost', sh);
  a.move('g_arm_l', [[0, 0, 30, 'sine'], [D / 4, 0, 40, 'sine'], [D / 2, 0, 30, 'sine'], [(3 * D) / 4, 0, 40, 'sine'], [D, 0, 30]]);
  a.move('g_arm_r', [[0, 0, 30, 'sine'], [D / 4, 0, 40, 'sine'], [D / 2, 0, 30, 'sine'], [(3 * D) / 4, 0, 40, 'sine'], [D, 0, 30]]);
  hemWave(a, D, 12, 3);
  a.alpha('aura', MINT, [[0, 0.9, 'sine'], [D / 2, 0.65, 'sine'], [D, 0.9]]);
  a.alpha('rays', GOLD, [[0, 0.5, 'sine'], [D / 2, 0.7, 'sine'], [D, 0.5]]); a.rot('rays', [[0, 0], [D, 30]]);
  letterHop(a, 0, 0.1, 6, 0.35);
  [[2, 0.1], [4, 0.5], [6, 0.85]].forEach(([i, t]) => twinkle(a, i, t, 0.4));
  anims.anticipation_idle = a;
}
{ // ANTICIPATION_END
  const a = new Anim();
  a.scale('main', [[0, 1.08, 1.08, 'inOut'], [0.45, 1, 1]]);
  a.move('ghost', [[0, 0, 22, 'inOut'], [0.45, 0, 0]]);
  a.move('g_arm_l', [[0, 0, 30, 'inOut'], [0.45, 0, 0]]); a.move('g_arm_r', [[0, 0, 30, 'inOut'], [0.45, 0, 0]]);
  a.alpha('aura', MINT, [[0, 0.9, 'out'], [0.45, 0.45]]); a.alpha('rays', GOLD, [[0, 0.5, 'out'], [0.4, 0]]);
  anims.anticipation_end = a;
}
{ // WIN: happy laugh, spin loop above the stone, letters bounce
  const D = 2.4, a = new Anim();
  face(a, [[0, 'face_angry'], [0.1, 'face_happy'], [2.05, 'face_angry']]);
  a.scale('main', [[0, 1, 1, 'outBack'], [0.2, 1.18, 1.18, 'inOut'], [1.8, 1.12, 1.12, 'inOut'], [D, 1, 1]]);
  a.move('ghost', [[0, 0, 0, 'outCubic'], [0.35, 0, 70, 'inOut'], [0.8, 30, 90, 'inOut'], [1.2, -30, 80, 'inOut'], [1.6, 0, 70, 'inOut'], [2.1, 0, 0]]);
  a.rot('ghost', [[0, 0, 'inOut'], [0.35, 0, 'inOut'], [1.2, 360, 'inOut'], [1.3, 360]]);
  a.scale('ghost', [[0, 1, 1, 'outQuad'], [0.1, 0.9, 1.12, 'outQuad'], [0.3, 1.08, 0.94, 'inOut'], [0.5, 1, 1], [2.0, 1, 1, 'outQuad'], [2.1, 1.1, 0.9, 'outBack'], [2.3, 1, 1]]);
  a.move('g_arm_l', [[0, 0, 0], [0.1, 0, 40, 'inOut'], [0.3, 0, 10, 'inOut'], [0.5, 0, 40, 'inOut'], [0.7, 0, 10, 'inOut'], [1.6, 0, 40, 'inOut'], [2.0, 0, 0]]);
  a.move('g_arm_r', [[0, 0, 0], [0.15, 0, 40, 'inOut'], [0.35, 0, 10, 'inOut'], [0.55, 0, 40, 'inOut'], [0.75, 0, 10, 'inOut'], [1.65, 0, 40, 'inOut'], [2.0, 0, 0]]);
  hemWave(a, D, 14, 4);
  a.scale('tomb', [[0, 1, 1], [0.1, 1, 1, 'outQuad'], [0.18, 1.08, 0.92, 'outBack'], [0.4, 1, 1]]);
  letterHop(a, 0.2, 0.12, 22, 0.45); letterHop; // single strong hop
  DR.forEach((_, i) => dripStretch(a, i + 1, 0.15 + i * 0.05, 0.75 + i * 0.07, 1.35));
  a.alpha('aura', MINT, [[0, 0.45, 'out'], [0.2, 1, 'sine'], [1.8, 0.8, 'out'], [D, 0.45]]);
  a.alpha('rays', GOLD, [[0, 0], [0.15, 0.85, 'sine'], [1.8, 0.6, 'out'], [D, 0]]); a.rot('rays', [[0, 0], [D, -80]]);
  a.show('flash', [[0, null], [0.1, 'flash'], [0.55, null]]); a.alpha('flash', WHITE, [[0, 0], [0.1, 0.9, 'out'], [0.55, 0]]); a.scale('flash', [[0, 0.5, 0.5], [0.1, 0.6, 0.6, 'outCubic'], [0.55, 1.8, 1.8]]);
  a.show('ring', [[0, null], [0.12, 'ring'], [0.8, null]]); a.alpha('ring', GOLD, [[0, 0], [0.12, 1, 'in'], [0.8, 0]]); a.scale('ring', [[0, 0.3, 0.3], [0.12, 0.3, 0.3, 'outCubic'], [0.8, 2.2, 2.2]]);
  shine(a, 0.3, 0.5, 1); shine;
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.15 + i * 0.12, 0.55));
  for (const n of ['p_curl', 'p_arm_l', 'p_arm_r']) a.phys(n, 'reset', [1.3]);
  a.ev(0.1, 'laugh').ev(0.12, 'burst');
  anims.win = a;
}
{ // TRIGGER: free spins — charge then burst, holds a powered pose
  const D = 1.8, a = new Anim();
  face(a, [[0, 'face_angry'], [0.9, 'face_happy']]);
  const sh = []; for (let i = 0; i <= 18; i++) sh.push([(i * 0.9) / 18, i === 0 ? 0 : (i % 2 ? 1 : -1) * (1 + i * 0.3), 'sine']); sh.push([1.0, 0, 'outBack'], [D, 0]);
  a.rot('ghost', sh);
  a.scale('main', [[0, 1, 1, 'inCubic'], [0.9, 1.15, 1.15, 'outExpo'], [1.05, 1.35, 1.35, 'inOut'], [D, 1.28, 1.28]]);
  a.move('ghost', [[0, 0, 0, 'in'], [0.9, 0, -10, 'outBack'], [1.2, 0, 40, 'inOut'], [D, 0, 34]]);
  a.move('g_arm_l', [[0, 0, 0, 'in'], [0.9, 0, -10, 'outBack'], [1.1, 0, 50]]); a.move('g_arm_r', [[0, 0, 0, 'in'], [0.9, 0, -10, 'outBack'], [1.1, 0, 50]]);
  a.alpha('aura', [0.8, 0.6, 1], [[0, 0.45, 'in'], [0.9, 1, 'out'], [D, 0.85]]); a.scale('aura', [[0, 1, 1, 'in'], [0.9, 1.4, 1.4, 'out'], [D, 1.25, 1.25]]);
  a.alpha('rays', [0.85, 0.7, 1], [[0, 0, 'in'], [0.9, 1, 'out'], [D, 0.75]]); a.rot('rays', [[0, 0, 'in'], [D, -160]]);
  a.show('flash', [[0, null], [0.9, 'flash'], [1.5, null]]); a.alpha('flash', [0.9, 0.85, 1], [[0, 0], [0.9, 0.9, 'out'], [1.5, 0]]); a.scale('flash', [[0, 1, 1], [0.9, 1, 1, 'outCubic'], [1.5, 3, 3]]);
  a.show('ring', [[0, null], [0.9, 'ring'], [1.6, null]]); a.alpha('ring', [0.8, 0.7, 1], [[0, 0], [0.9, 1, 'in'], [1.6, 0]]); a.scale('ring', [[0, 0.3, 0.3], [0.9, 0.3, 0.3, 'outCubic'], [1.6, 3, 3]]);
  for (let i = 1; i <= LETTERS; i++) a.move(`letter${i}`, [[0, 0, 0, 'in'], [0.9, 0, 0, 'outBack'], [1.05, 0, 16, 'inOut'], [1.3 + i * 0.04, 0, 5, 'inOut'], [D, 0, 7]]);
  shine(a, 0.9, 0.5, 1);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.9 + (i % 3) * 0.1, 0.6));
  a.ev(0, 'charge').ev(0.9, 'trigger');
  anims.trigger = a;
}
{ // OUTRO: ghost waves bye and flies off, stone sinks into the ground
  const a = new Anim();
  face(a, [[0, 'face_happy']]);
  a.move('g_arm_r', [[0, 0, 0], [0.1, 0, 35, 'inOut'], [0.2, 0, 15, 'inOut'], [0.3, 0, 35, 'inOut'], [0.4, 0, 15]]);
  a.move('ghost', [[0, 0, 0], [0.35, 0, 0, 'inBack'], [0.85, 140, 380]]);
  a.rot('ghost', [[0, 0], [0.35, 0, 'in'], [0.85, -35]]);
  a.scale('ghost', [[0, 1, 1], [0.35, 1, 1, 'in'], [0.85, 0.5, 0.7]]);
  a.alpha('ghost', WHITE, [[0, 1], [0.55, 1, 'in'], [0.85, 0]]); a.alpha('face', WHITE, [[0, 1], [0.55, 1, 'in'], [0.85, 0]]);
  for (let i = 1; i <= LETTERS; i++) { const t = 0.3 + i * 0.05; a.scale(`letter${i}`, [[0, 1, 1], [t, 1.15, 1.15, 'inBack'], [t + 0.25, 0, 0]]); }
  a.move('tomb', [[0, 0, 0], [0.45, 0, 6, 'inBack'], [0.9, 0, -160]]);
  a.scale('tomb', [[0, 1, 1], [0.45, 1.04, 0.96, 'in'], [0.9, 0.7, 0.2]]);
  a.alpha('aura', MINT, [[0, 0.45, 'in'], [0.6, 0]]);
  puff(a, 'smoke1', 0.55, -50, 'smoke_big', 0.5, 0.9); puff(a, 'smoke2', 0.58, 50, 'smoke_big', 0.5, 0.9);
  a.ev(0.35, 'woosh').ev(0.6, 'vanish');
  anims.outro = a;
}

const skel = {
  skeleton: { hash: '', spine: '4.2.43', x: -260, y: -300, width: 520, height: 620, images: './images/', audio: '' },
  bones, slots, physics, skins: [{ name: 'default', attachments: AT }],
  events: { land: {}, woosh: {}, tease: {}, laugh: {}, burst: {}, charge: {}, trigger: {}, vanish: {} },
  animations: Object.fromEntries(Object.entries(anims).map(([n, v]) => [n, v.json()])),
};
skel.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skel)).digest('base64').slice(0, 11);
fs.writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(skel));
fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
  id: 'creations/halloween-v2/fs_ghost', package: NAME, name: NAME, label: 'Mascotte FS (fantôme)', game: 'Halloween V2', game_slug: 'halloween-v2',
  format: 'spine', skeleton_format: 'json', skeleton_file: `${NAME}.json`, skeleton_version: '4.2.43', category: 'symbol',
  subtypes: ['scatter', 'mascot', 'entrance', 'idle', 'land', 'anticipation', 'win', 'exit'], tags: ['halloween', 'ghost', 'free_spins', 'fs', 'scatter'],
  animations: Object.keys(anims), events: Object.keys(skel.events), bones_count: bones.length, slots_count: slots.length, physics_constraints: physics.length, skins: ['default'],
  atlases: [{ file: `${NAME}.atlas`, pages: [`${NAME}.png`] }], textures: [{ file: `${NAME}.png`, page: `${NAME}.png`, width: page.w, height: page.h, pma: false }],
  complete: true, warnings: [],
  usage: { tracks: { 0: 'intro -> idle | land | anticipation -> anticipation_idle -> anticipation_end | win | trigger | outro' } },
}, null, 1));
console.log(`fs_ghost: ${bones.length} os, ${slots.length} slots, ${physics.length} physics, ${DR.length} drips, letters ${LETTERS}, anims: ${Object.keys(anims).join(', ')}`);
