// V2: Halloween scatter rigged like a production character (cf. Interrogator "croc"):
// separated parts, weighted meshes on bone chains, Spine 4.2 physics, expression swaps, events.
//   node cut2.mjs && node build2.mjs   ->  package/halloween_scatter.{json,atlas,png...} + metadata.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { load, resize, procedural, pack, composePage, alphaBox } from '../../tools/imagekit.js';

const NAME = 'halloween_scatter';
const OUT = 'package';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const RES = 2;
const P2 = JSON.parse(fs.readFileSync('parts2/meta.json', 'utf8'));
const R = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ scales (pixels of the source -> skeleton units)
const PUMPKIN_W = 210, PLAQUE_W = 330;
const NL = Object.keys(P2.pieces).filter((k) => k.startsWith('letter_')).length; // letters on the sign
const kP = PUMPKIN_W / P2.pumpkin.w; // pumpkin pieces
const kQ = PLAQUE_W / P2.plaque.w; // plaque pieces
const PUMPKIN_H = P2.pumpkin.h * kP;

const items = [];
const size = {}; // attachment size in units
const offs = {}; // attachment offset (units) from its anchor (pumpkin / plaque centre)
async function addImage(name, file, unitsW, k = null) {
  const img = await load(file);
  const w = k ? img.w * k : unitsW, h = (w * img.h) / img.w;
  size[name] = [w, h];
  items.push({ name, img: await resize(img, w * RES, h * RES) });
}
for (const [name, p] of Object.entries(P2.pieces)) {
  if (name.startsWith('face_') || name.startsWith('pumpkin_')) { await addImage(name, `parts2/${name}.png`, 0, kP); offs[name] = [p.cx * kP, p.cy * kP]; }
  else if (name.startsWith('plaque_') || name.startsWith('letter_')) { await addImage(name, `parts2/${name}.png`, 0, kQ); offs[name] = [p.cx * kQ, p.cy * kQ]; }
}
const V1 = { hat: 262, moon: 300, bat_body: 40, wing: 84, ghost: 84, smoke_big: 120, smoke_small: 80, star: 46, candy1: 30, candy2: 30, candy3: 30 };
for (const [n, w] of Object.entries(V1)) await addImage(n, `parts/${n}.png`, w);
const FX = { glow: [420, 256], rays: [600, 512], flash: [320, 256], ring: [320, 256], shine: [120, 128] };
for (const [n, [w, t]] of Object.entries(FX)) { size[n] = n === 'shine' ? [w, 170] : [w, w]; items.push({ name: n, img: procedural(n, t) }); }

// hat geometry (tip / seat) measured on the image
const hatImg = await load('parts/hat.png');
const hatGeo = (() => {
  const { w, h, px } = hatImg;
  let tip = null;
  for (let y = 0; y < h && !tip; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 128) { tip = [x, y]; break; }
  const row = Math.round(h * 0.8);
  let x0 = -1, x1 = -1;
  for (let x = 0; x < w; x++) if (px[(row * w + x) * 4 + 3] > 128) { if (x0 < 0) x0 = x; x1 = x; }
  const k = size.hat[0] / w;
  const toU = ([x, y]) => [(x - w / 2) * k, (h / 2 - y) * k];
  // bottom edge of the (trimmed) brim, sampled left -> right: used to hide the pumpkin top inside the hat
  const edge = [];
  // real horizontal extent of the brim (its tips are higher than the 0.8h row)
  let ex0 = w, ex1 = -1;
  for (let y = Math.floor(h * 0.45); y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 128) { if (x < ex0) ex0 = x; if (x > ex1) ex1 = x; }
  for (let i = 0; i <= 30; i++) {
    const x = Math.round(ex0 + (ex1 - ex0) * (0.01 + 0.98 * (i / 30)));
    let yb = -1;
    for (let y = h - 1; y > h * 0.4; y--) if (px[(y * w + x) * 4 + 3] > 128) { yb = y; break; }
    if (yb > 0) edge.push(toU([x, yb - h * 0.015]));
  }
  return { tip: toU(tip), seat: toU([(x0 + x1) / 2, h * 0.8]), brimL: toU([x0, row]), brimR: toU([x1, row]), edge };
})();

// ------------------------------------------------------------------ atlas (may span several pages)
const pages = pack(items, { maxSize: 2048, padding: 4 });
let atlas = '';
for (let i = 0; i < pages.length; i++) {
  const file = pages.length > 1 ? `${NAME}${i ? '_' + (i + 1) : ''}.png` : `${NAME}.png`;
  fs.writeFileSync(`${OUT}/${file}`, await composePage(pages[i]));
  atlas += `${i ? '\n' : ''}${file}\nsize:${pages[i].w},${pages[i].h}\nfilter:Linear,Linear\n`;
  for (const r of pages[i].rects.sort((a, b) => a.name.localeCompare(b.name))) atlas += `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`;
}
fs.writeFileSync(`${OUT}/${NAME}.atlas`, atlas);

// ------------------------------------------------------------------ bones (+ setup world matrices for mesh weights)
const bones = [];
const BI = {};
function bone(name, parent, o = {}) {
  const b = { name, ...(parent ? { parent } : {}) };
  for (const [k, v] of Object.entries(o)) b[k] = typeof v === 'number' ? R(v) : v;
  BI[name] = bones.length;
  bones.push(b);
}
const world = {};
function computeWorld() {
  for (const b of bones) {
    const r = ((b.rotation || 0) * Math.PI) / 180, sx = b.scaleX ?? 1, sy = b.scaleY ?? 1;
    const l = [Math.cos(r) * sx, -Math.sin(r) * sy, b.x || 0, Math.sin(r) * sx, Math.cos(r) * sy, b.y || 0];
    const p = b.parent ? world[b.parent] : [1, 0, 0, 0, 1, 0];
    world[b.name] = [p[0] * l[0] + p[1] * l[3], p[0] * l[1] + p[1] * l[4], p[0] * l[2] + p[1] * l[5] + p[2], p[3] * l[0] + p[4] * l[3], p[3] * l[1] + p[4] * l[4], p[3] * l[2] + p[4] * l[5] + p[5]];
  }
}
const toWorld = (b, [x, y]) => { const m = world[b]; return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]; };
const toLocal = (b, [x, y]) => { const m = world[b]; const det = m[0] * m[4] - m[1] * m[3]; const dx = x - m[2], dy = y - m[5]; return [(m[4] * dx - m[1] * dy) / det, (-m[3] * dx + m[0] * dy) / det]; };
const chainBones = (prefix, parent, from, to, n, o = {}) => {
  // n bones from `from` to `to` (coordinates in parent space), each pointing to the next
  const ang = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) / n;
  bone(`${prefix}1`, parent, { x: from[0], y: from[1], rotation: ang, length: len, ...o });
  for (let i = 2; i <= n; i++) bone(`${prefix}${i}`, `${prefix}${i - 1}`, { x: len, length: len });
  return { ang, len };
};

const PC = [0, 30]; // pumpkin centre (in main)
bone('root');
bone('main', 'root');
bone('aura', 'main', { y: 40 });
bone('rays', 'main', { y: 40 });
bone('moon', 'main', { y: 80 });
bone('ghost', 'main', { x: 40, y: 20 });
bone('ghost_tail', 'ghost', { y: -20, rotation: -90, length: 20 });
bone('body', 'main', { x: PC[0], y: PC[1] - PUMPKIN_H / 2 });
bone('pumpkin', 'body', { y: PUMPKIN_H / 2 });
bone('pumpkin_top', 'pumpkin', { y: PUMPKIN_H * 0.42, rotation: 90, length: 12 });
bone('pumpkin_l', 'pumpkin', { x: -PUMPKIN_W * 0.44, rotation: 180, length: 12 });
bone('pumpkin_r', 'pumpkin', { x: PUMPKIN_W * 0.44, length: 12 });
bone('face', 'pumpkin');
for (const f of ['eye_l', 'eye_r', 'nose', 'mouth']) bone(f, 'face', { x: offs[`face_${f}`][0], y: offs[`face_${f}`][1] });
const stem = P2.pieces.pumpkin_stem;
const stemBase = [stem.base[0] * kP, stem.base[1] * kP];
const stemTop = [offs.pumpkin_stem[0] + size.pumpkin_stem[0] * 0.25, offs.pumpkin_stem[1] + size.pumpkin_stem[1] * 0.45];
chainBones('stem', 'pumpkin', stemBase, stemTop, 2);
bone('hat', 'body', { x: -40, y: PUMPKIN_H * 0.74, rotation: -2 });
// hat attachment is drawn so that its seat sits on the hat bone
const hatAtt = [-hatGeo.seat[0], -hatGeo.seat[1]];
const hTip = [hatGeo.tip[0] + hatAtt[0], hatGeo.tip[1] + hatAtt[1]];
const hatChain = chainBones('hat_cone', 'hat', [0, size.hat[1] * 0.12], hTip, 3);
bone('hat_brim_l', 'hat', { x: hatGeo.brimL[0] + hatAtt[0] + 20, y: hatGeo.brimL[1] + hatAtt[1], rotation: 180, length: 30 });
bone('hat_brim_r', 'hat', { x: hatGeo.brimR[0] + hatAtt[0] - 20, y: hatGeo.brimR[1] + hatAtt[1], length: 30 });
bone('plaque', 'main', { y: -100 });
for (let i = 1; i <= NL; i++) { const n = Object.keys(P2.pieces).find((k) => k.startsWith(`letter_${i}_`)); bone(`letter${i}`, 'plaque', { x: offs[n][0], y: offs[n][1] }); }
const SL = P2.pieces.plaque_slime;
const bandY = SL.band * kQ;
bone('slime', 'plaque', { y: bandY });
const DRIPS = SL.drips.map((d) => ({ x: d.x * kQ, tip: d.tipY * kQ, w: d.w * kQ }));
const WAVES = [-0.42, -0.21, 0, 0.21, 0.42].map((f) => f * size.plaque_board[0]);
WAVES.forEach((x, i) => bone(`slime_wave${i + 1}`, 'slime', { x, y: 0 }));
DRIPS.forEach((d, i) => {
  bone(`drip${i + 1}`, 'slime', { x: d.x, y: 0, rotation: -90, length: Math.max(4, bandY - d.tip) });
});
bone('plaque_shine', 'plaque', { x: -230 });
for (const [side, x, y, s] of [['l', -140, 60, 1], ['r', 140, 0, 0.9]]) { // bats frame the pumpkin sides
  bone(`bat_${side}`, 'main', { x, y, scaleX: s, scaleY: s });
  // wing image: shoulder at its right end, tip at the left (left wing); right wing is mirrored
  for (const [w, dir] of [['l', -1], ['r', 1]]) chainBones(`bat_${side}_wing_${w}`, `bat_${side}`, [dir * 9, 10], [dir * (9 + size.wing[0] * 0.95), 10 + size.wing[1] * 0.18], 2);
}
for (let i = 1; i <= 3; i++) bone(`candy${i}`, 'main', { y: 40 });
const SMOKE = [[-62, -150], [62, -150], [-105, 10], [105, 0]]; // puffs hug the (narrow FS) sign base
SMOKE.forEach(([x, y], i) => bone(`smoke${i + 1}`, 'main', { x, y }));
const STARS = [[-150, 200], [160, 180], [-205, 20], [200, -40], [-120, -195], [125, 235]];
STARS.forEach(([x, y], i) => bone(`star${i + 1}`, 'main', { x, y }));
bone('ring', 'main', { y: 40 });
bone('flash', 'main', { y: 40 });
computeWorld();

// ------------------------------------------------------------------ meshes
/** Grid mesh over a region; weights(xWorld, yWorld) -> [[bone, w], ...] (or null for an unweighted mesh). */
function gridMesh(regionName, slotBone, center, cols, rows, weights, { mirror = false, world = false } = {}) {
  const [w0, h0] = size[regionName];
  const w = w0 * (arguments[6]?.scale || 1), h = h0 * (arguments[6]?.scale || 1);
  const uvs = [], verts = [], tris = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols, v = j / rows;
    uvs.push(R(mirror ? 1 - u : u), R(v));
    const lx = center[0] + (u - 0.5) * w, ly = center[1] + (0.5 - v) * h;
    if (!weights) { verts.push(R(lx), R(ly)); continue; }
    const wp = world ? [lx, ly] : toWorld(slotBone, [lx, ly]);
    let ws = weights(wp[0], wp[1]).filter(([, x]) => x > 0.001);
    const sum = ws.reduce((a, [, x]) => a + x, 0);
    ws = ws.map(([b, x]) => [b, x / sum]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s2 = ws.reduce((a, [, x]) => a + x, 0);
    verts.push(ws.length);
    for (const [b, x] of ws) { const lp = toLocal(b, wp); verts.push(BI[b], R(lp[0]), R(lp[1]), R(x / s2)); }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    tris.push(a, c, b, b, c, d);
  }
  return { type: 'mesh', path: regionName, uvs, triangles: tris, vertices: verts, hull: 0, width: R(w * RES), height: R(h * RES) };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

// pumpkin body: centre + top / left / right bulge bones
const pc = toWorld('pumpkin', [0, 0]);
const pumpkinWeights = (x, y) => {
  const dx = (x - pc[0]) / (PUMPKIN_W / 2), dy = (y - pc[1]) / (PUMPKIN_H / 2);
  const top = smooth(dy) * 0.75, l = smooth(-dx) * 0.6, r = smooth(dx) * 0.6;
  return [['pumpkin', Math.max(0.15, 1 - top - l - r)], ['pumpkin_top', top], ['pumpkin_l', l], ['pumpkin_r', r]];
};
// hat: brim on the hat / brim bones, cone along its 3-bone chain
const hatSeatW = toWorld('hat', [0, 0]);
const hatWeights = (x, y) => {
  const lp = toLocal('hat', [x, y]);
  const along = (lp[0] * Math.cos((hatChain.ang * Math.PI) / 180) + (lp[1] - size.hat[1] * 0.12) * Math.sin((hatChain.ang * Math.PI) / 180)) / (hatChain.len * 3);
  const brim = lp[1] < size.hat[1] * 0.1;
  if (brim) {
    const half = (hatGeo.brimR[0] - hatGeo.brimL[0]) / 2;
    const l = smooth((-lp[0] - half * 0.35) / (half * 0.65)), r = smooth((lp[0] - half * 0.35) / (half * 0.65));
    return [['hat', 1 - Math.max(l, r)], ['hat_brim_l', l], ['hat_brim_r', r]];
  }
  const t = clamp01(along) * 3; // 0..3 along the chain
  const out = [['hat', Math.max(0, 1 - t)]];
  for (let i = 1; i <= 3; i++) out.push([`hat_cone${i}`, Math.max(0, 1 - Math.abs(t - i + 0.5))]);
  return out;
};
void hatSeatW;
// slime: band on `slime`, drips on their bones
const slimeWeights = (x, y) => {
  const lp = toLocal('slime', [x, y]);
  const out = [['slime', 0.25]];
  WAVES.forEach((wx, i) => out.push([`slime_wave${i + 1}`, Math.exp(-(((lp[0] - wx) / (PLAQUE_W * 0.11)) ** 2))]));
  DRIPS.forEach((d, i) => {
    const len = Math.max(4, bandY - d.tip);
    const down = clamp01(-lp[1] / len), side = smooth(1 - Math.abs(lp[0] - d.x) / (d.w * 1.1 + 14));
    const wgt = side * smooth(down * 1.1);
    if (wgt > 0) out.push([`drip${i + 1}`, wgt * 1.2]);
  });
  return out;
};
const wingWeights = (prefix) => (x, y) => {
  const a = toWorld(`${prefix}1`, [0, 0]);
  const tipW = toWorld(`${prefix}2`, [bones[BI[`${prefix}2`]].length, 0]);
  const L = Math.hypot(tipW[0] - a[0], tipW[1] - a[1]);
  const t = clamp01(((x - a[0]) * (tipW[0] - a[0]) + (y - a[1]) * (tipW[1] - a[1])) / (L * L));
  return [[`${prefix}1`, 1 - smooth(t * 1.4 - 0.2)], [`${prefix}2`, smooth(t * 1.4 - 0.2)]];
};
const ghostWeights = (x, y) => {
  const lp = toLocal('ghost', [x, y]);
  const t = smooth((-lp[1] + 5) / (size.ghost[1] * 0.5));
  return [['ghost', 1 - t], ['ghost_tail', t]];
};

// ------------------------------------------------------------------ slots & attachments
const slots = [];
const A = {};
const slot = (name, b, attachment = name, o = {}) => slots.push({ name, bone: b, ...(attachment ? { attachment } : {}), ...o });
const put = (s, key, value) => ((A[s] ||= {})[key] = value);
const att = (name, o = {}) => ({ width: R(size[name][0]), height: R(size[name][1]), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? R(v) : v])) });
const rel = (name, anchorBone, anchorXY) => { const [ax, ay] = anchorXY; return { x: offs[name][0] - ax, y: offs[name][1] - ay }; };

slot('aura', 'aura', 'glow', { color: 'ff8a2a8c', blend: 'additive' }); put('aura', 'glow', att('glow', { scaleX: 1.15, scaleY: 1.15 }));
slot('rays', 'rays', 'rays', { color: 'ffc35a00', blend: 'additive' }); put('rays', 'rays', att('rays'));
slot('moon_glow', 'moon', 'glow', { color: 'fff1b066', blend: 'additive' }); put('moon_glow', 'glow', att('glow', { scaleX: 1.05, scaleY: 1.05 }));
slot('moon', 'moon'); put('moon', 'moon', att('moon'));
slot('ghost', 'ghost', null); put('ghost', 'ghost', gridMesh('ghost', 'ghost', [0, 0], 4, 6, ghostWeights));
slot('smoke1', 'smoke1', null); slot('smoke2', 'smoke2', null);
for (const s of ['l', 'r']) {
  for (const w of ['l', 'r']) {
    const sl = `bat_${s}_wing_${w}`;
    slot(sl, `${sl}1`, 'wing');
    const shoulder = toWorld(`${sl}1`, [0, 0]);
    const k = s === 'r' ? 0.9 : 1; // bat_r is scaled 0.9
    const c = [shoulder[0] + (w === 'l' ? -1 : 1) * size.wing[0] * 0.44 * k, shoulder[1] - size.wing[1] * 0.02 * k];
    put(sl, 'wing', gridMesh('wing', `${sl}1`, c, 6, 3, wingWeights(sl), { mirror: w === 'r', world: true, scale: k }));
  }
  slot(`bat_${s}`, `bat_${s}`, 'bat_body'); put(`bat_${s}`, 'bat_body', att('bat_body'));
}
slot('stem', 'stem1', null); // hidden: covered by the hat (the body image keeps the stem scar)
{
  const sw = toWorld('pumpkin', offs.pumpkin_stem);
  put('stem', 'pumpkin_stem', gridMesh('pumpkin_stem', 'stem1', sw, 4, 4, (x, y) => {
    const lp = toLocal('stem1', [x, y]);
    const t = smooth(lp[0] / (bones[BI.stem1].length * 1.6));
    return [['stem1', 1 - t], ['stem2', t]];
  }));
}
// clipping: the pumpkin is only drawn below the brim -> its top really is inside the hat
slot('head_clip', 'hat', 'head_clip');
{
  // straight line fitted on the brim bottom edge (convex quad = robust clipping), extended well past the pumpkin
  const e = hatGeo.edge.map(([x, y]) => [x + hatAtt[0], y + hatAtt[1]]);
  const n = e.length, mx = e.reduce((a, p) => a + p[0], 0) / n, my = e.reduce((a, p) => a + p[1], 0) / n;
  const k = e.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / e.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const yAt = (x) => my + k * (x - mx) + 9; // cut slightly inside the brim so no flat edge shows
  // follow the real bottom edge of the brim (sampled), extended outward at both ends
  const pts = e.map(([x, y]) => [x, y + 6]);
  const poly = [[-400, pts[0][1]], ...pts, [400, pts[pts.length - 1][1]], [400, -900], [-400, -900]];
  void yAt;
  put('head_clip', 'head_clip', { type: 'clipping', end: 'pumpkin_body', vertexCount: poly.length, vertices: poly.flat().map(R), color: 'ce3a3aff' });
}
slot('pumpkin_body', 'pumpkin'); put('pumpkin_body', 'pumpkin_body', gridMesh('pumpkin_body', 'pumpkin', offs.pumpkin_body, 8, 8, pumpkinWeights));
for (const f of ['eye_l', 'eye_r', 'nose', 'mouth']) {
  const o = offs[`face_${f}`];
  slot(`face_${f}`, f, `face_${f}`);
  put(`face_${f}`, `face_${f}`, att(`face_${f}`));
  const hk = `face_${f}_happy`;
  if (size[hk]) put(`face_${f}`, hk, att(hk, { x: offs[hk][0] - o[0], y: offs[hk][1] - o[1] }));
  slot(`face_${f}_light`, f, `face_${f}_light`, { blend: 'additive' });
  put(`face_${f}_light`, `face_${f}_light`, att(`face_${f}_light`));
}
slot('face_bloom', 'face', 'glow', { color: 'ff9a2a00', blend: 'additive' }); put('face_bloom', 'glow', att('glow', { y: -10, scaleX: 0.66, scaleY: 0.52 }));
slot('eye_l_glow', 'eye_l', 'glow', { color: 'ffb34a59', blend: 'additive' }); put('eye_l_glow', 'glow', att('glow', { scaleX: 0.2, scaleY: 0.2 }));
slot('eye_r_glow', 'eye_r', 'glow', { color: 'ffb34a59', blend: 'additive' }); put('eye_r_glow', 'glow', att('glow', { scaleX: 0.2, scaleY: 0.2 }));
slot('hat_shadow', 'hat', 'glow', { color: '1a0a0599' }); put('hat_shadow', 'glow', att('glow', { y: -6, scaleX: 0.5, scaleY: 0.14 }));
slot('hat', 'hat'); put('hat', 'hat', gridMesh('hat', 'hat', hatAtt, 8, 8, hatWeights));
slot('plaque_board', 'plaque'); put('plaque_board', 'plaque_board', att('plaque_board', { x: offs.plaque_board[0], y: offs.plaque_board[1] }));
for (let i = 1; i <= NL; i++) {
  const n = Object.keys(P2.pieces).find((k) => k.startsWith(`letter_${i}_`));
  slot(`letter${i}`, `letter${i}`, n); put(`letter${i}`, n, att(n));
}
slot('plaque_slime', 'slime');
put('plaque_slime', 'plaque_slime', gridMesh('plaque_slime', 'slime', [offs.plaque_slime[0], offs.plaque_slime[1] - bandY], 44, 12, slimeWeights));
slot('plaque_clip', 'plaque', 'plaque_clip');
const pw = size.plaque_board[0] * 0.47, ph = size.plaque_board[1] * 0.4;
put('plaque_clip', 'plaque_clip', { type: 'clipping', end: 'plaque_shine', vertexCount: 4, vertices: [-pw, -ph, pw, -ph, pw, ph, -pw, ph].map(R), color: 'ce3a3aff' });
slot('plaque_shine', 'plaque_shine', 'shine', { color: 'ffffff00', blend: 'additive' }); put('plaque_shine', 'shine', att('shine', { rotation: -18 }));
for (let i = 1; i <= 3; i++) { slot(`candy${i}`, `candy${i}`, null); put(`candy${i}`, `candy${i}`, att(`candy${i}`)); }
STARS.forEach((_, i) => { slot(`star${i + 1}`, `star${i + 1}`, 'star', { color: 'ffffff00' }); put(`star${i + 1}`, 'star', att('star', { scaleX: 0.75 + (i % 3) * 0.15, scaleY: 0.75 + (i % 3) * 0.15 })); });
for (const s of ['smoke1', 'smoke2', 'smoke3', 'smoke4']) { put(s, 'smoke_big', att('smoke_big')); put(s, 'smoke_small', att('smoke_small')); }
slot('smoke3', 'smoke3', null); slot('smoke4', 'smoke4', null);
slot('ring', 'ring', null, { blend: 'additive' }); put('ring', 'ring', att('ring'));
slot('flash', 'flash', null, { blend: 'additive' }); put('flash', 'flash', att('flash'));
void rel;

// ------------------------------------------------------------------ physics (secondary motion, Spine 4.2)
const physics = [
  { name: 'phys_hat1', bone: 'hat_cone1', rotate: 1, inertia: 0.5, strength: 160, damping: 0.85, mass: 1.6 },
  { name: 'phys_hat2', bone: 'hat_cone2', rotate: 1, inertia: 0.6, strength: 120, damping: 0.85, mass: 1.6 },
  { name: 'phys_hat3', bone: 'hat_cone3', rotate: 1, inertia: 0.7, strength: 90, damping: 0.8, mass: 1.8 },
  { name: 'phys_brim_l', bone: 'hat_brim_l', rotate: 1, inertia: 0.4, strength: 180, damping: 0.8, mass: 1.2 },
  { name: 'phys_brim_r', bone: 'hat_brim_r', rotate: 1, inertia: 0.4, strength: 180, damping: 0.8, mass: 1.2 },
  { name: 'phys_stem1', bone: 'stem1', rotate: 1, inertia: 0.5, strength: 150, damping: 0.8 },
  { name: 'phys_stem2', bone: 'stem2', rotate: 1, inertia: 0.7, strength: 100, damping: 0.75 },
  { name: 'phys_top', bone: 'pumpkin_top', y: 1, inertia: 0.6, strength: 220, damping: 0.75, mass: 1.5 },
  ...DRIPS.map((_, i) => ({ name: `phys_drip${i + 1}`, bone: `drip${i + 1}`, rotate: 1, scaleX: 0.6, inertia: 0.8, strength: 70 + i * 8, damping: 0.7, mass: 1.4, gravity: 40 })),
  { name: 'phys_ghost', bone: 'ghost_tail', rotate: 1, inertia: 0.7, strength: 60, damping: 0.7 },
];

// ------------------------------------------------------------------ animation builder (same as v1)
const EASE = {
  linear: null, in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1], sine: [0.37, 0, 0.63, 1],
  outBack: [0.34, 1.56, 0.64, 1], inBack: [0.36, 0, 0.66, -0.56], outQuad: [0.5, 1, 0.89, 1], inQuad: [0.11, 0, 0.5, 0],
  outExpo: [0.16, 1, 0.3, 1], inExpo: [0.7, 0, 0.84, 0], outCubic: [0.33, 1, 0.68, 1], inCubic: [0.32, 0, 0.67, 0],
};
const T = (t) => Math.round(t * 10000) / 10000;
function curve(t0, v0, t1, v1, ease) {
  if (ease === 'stepped') return 'stepped';
  const e = EASE[ease || 'linear'];
  if (!e) return null;
  const out = [];
  for (let i = 0; i < v0.length; i++) out.push(T(t0 + e[0] * (t1 - t0)), R(v0[i] + e[1] * (v1[i] - v0[i])), T(t0 + e[2] * (t1 - t0)), R(v0[i] + e[3] * (v1[i] - v0[i])));
  return out;
}
function timeline(keys, fields) {
  return keys.map((k, i) => {
    const vals = k.slice(1, 1 + fields.length);
    const o = {};
    if (k[0]) o.time = T(k[0]);
    fields.forEach((f, j) => (o[f] = R(vals[j])));
    const next = keys[i + 1];
    if (next) { const c = curve(k[0], vals.map(Number), next[0], next.slice(1, 1 + fields.length).map(Number), k[1 + fields.length]); if (c) o.curve = c; }
    return o;
  });
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
class Anim {
  constructor() { this.bones = {}; this.slots = {}; this.events = []; this.physics = {}; }
  /** physics constraint timeline (4.2): mix / inertia / strength... or reset */
  phys(name, tl, keys) {
    if (!physics.some((p) => p.name === name)) throw new Error('unknown physics ' + name);
    (this.physics[name] ||= {})[tl] = tl === 'reset' ? keys.map((t) => (t ? { time: T(t) } : {})) : timeline(keys, ['value']);
    return this;
  }
  b(n) { if (!(n in BI)) throw new Error('unknown bone ' + n); return (this.bones[n] ||= {}); }
  rot(n, k) { this.b(n).rotate = timeline(k, ['value']); return this; }
  move(n, k) { this.b(n).translate = timeline(k, ['x', 'y']); return this; }
  scale(n, k) { this.b(n).scale = timeline(k, ['x', 'y']); return this; }
  color(n, keys) {
    if (!slots.some((s) => s.name === n)) throw new Error('unknown slot ' + n);
    (this.slots[n] ||= {}).rgba = keys.map((k, i) => {
      const o = {}; if (k[0]) o.time = T(k[0]); o.color = k.slice(1, 5).map(hex2).join('');
      const nx = keys[i + 1]; if (nx) { const c = curve(k[0], k.slice(1, 5), nx[0], nx.slice(1, 5), k[5]); if (c) o.curve = c; }
      return o;
    });
    return this;
  }
  alpha(n, rgb, keys) { return this.color(n, keys.map(([t, a, e]) => [t, ...rgb, a, e])); }
  show(n, keys) { (this.slots[n] ||= {}).attachment = keys.map(([t, a]) => ({ ...(t ? { time: T(t) } : {}), name: a })); return this; }
  ev(t, name) { this.events.push({ ...(t ? { time: T(t) } : {}), name }); return this; }
  json() {
    const o = {};
    if (Object.keys(this.slots).length) o.slots = this.slots;
    if (Object.keys(this.bones).length) o.bones = this.bones;
    if (this.events.length) o.events = this.events.sort((a, b) => (a.time || 0) - (b.time || 0));
    if (Object.keys(this.physics).length) o.physics = this.physics;
    return o;
  }
}
const ORANGE = [1, 0.54, 0.16], GOLD = [1, 0.77, 0.35], WHITE = [1, 1, 1], EYE = [1, 0.7, 0.29], FACE = [1, 0.6, 0.16], MOONG = [1, 0.94, 0.69];
const FEAT = ['eye_l', 'eye_r', 'nose', 'mouth'];
const lightLevel = (a, keys) => FEAT.forEach((f) => a.alpha(`face_${f}_light`, WHITE, keys));
const flapKeys = (t0, t1, period, amp, base = 0, lag = 0) => {
  const k = [];
  for (let t = t0; t < t1 - 1e-6; t += period) { k.push([t + lag * (t > t0 ? 1 : 0), base, 'sine']); k.push([t + period / 2 + lag, base + amp, 'sine']); }
  k.push([t1, base]);
  return k.filter((x, i, arr) => i === 0 || x[0] > arr[i - 1][0]);
};
// wing flap with follow-through: the outer bone lags behind the inner one
const flapBat = (a, side, t0, t1, period, amp = 40) => {
  for (const [w, dir] of [['l', 1], ['r', -1]]) {
    a.rot(`bat_${side}_wing_${w}1`, flapKeys(t0, t1, period, dir * amp));
    a.rot(`bat_${side}_wing_${w}2`, flapKeys(t0, t1, period, dir * amp * 0.55, 0, period * 0.12));
  }
};
const twinkle = (a, i, t0, dur = 0.5) => {
  a.alpha(`star${i}`, WHITE, [[0, 0], [t0, 0, 'outQuad'], [t0 + dur * 0.35, 1, 'inQuad'], [t0 + dur, 0]]);
  a.scale(`star${i}`, [[0, 0.2, 0.2], [t0, 0.2, 0.2, 'outBack'], [t0 + dur * 0.35, 1.15, 1.15, 'inQuad'], [t0 + dur, 0.3, 0.3]]);
  a.rot(`star${i}`, [[0, 0], [t0, 0], [t0 + dur, 45]]);
};
const puff = (a, s, t0, dx, dy, img = 'smoke_big', dur = 0.7, tint = WHITE, peak = 0.9) => {
  a.show(s, [[0, null], [t0, img], [t0 + dur, null]]);
  a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + dur, dx, dy]]);
  a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outCubic'], [t0 + dur, 1.25, 1.1]]);
  a.alpha(s, tint, [[0, 0], [t0, peak, 'in'], [t0 + dur, 0]]);
};
/** a slime drop forms at the tip of drip i, falls and splashes */
const dropFall = (a, i, t0, fall = 70) => {
  const s = `drop${i}`;
  a.show(s, [[0, null], [t0, 'drop_small'], [t0 + 0.55, 'puddle'], [t0 + 0.8, null]]);
  a.move(s, [[0, 0, 0], [t0, 0, 4, 'inQuad'], [t0 + 0.2, 0, -2, 'inQuad'], [t0 + 0.55, 0, -fall, 'stepped'], [t0 + 0.8, 0, -fall]]);
  a.scale(s, [[0, 0, 0], [t0, 0.2, 0.2, 'outBack'], [t0 + 0.2, 1, 1.25, 'inOut'], [t0 + 0.55, 0.9, 1.3, 'stepped'], [t0 + 0.56, 0.3, 0.3, 'outCubic'], [t0 + 0.8, 1.2, 0.5]]);
  a.alpha(s, WHITE, [[0, 1], [t0 + 0.6, 1, 'in'], [t0 + 0.8, 0]]);
};
/** drip slowly stretches then snaps back (scaleX along the bone = downward) */
const dripStretch = (a, i, t0, t1, amount = 1.35) => a.scale(`drip${i}`, [[0, 1, 1], [t0, 1, 1, 'sine'], [t1 - 0.15, amount, 0.92, 'outBack'], [t1, 0.95, 1.05, 'outQuad'], [t1 + 0.25, 1, 1]]);
const letterWave = (a, t0, step, amp, dur = 0.35) => {
  for (let i = 1; i <= NL; i++) {
    const t = t0 + (i - 1) * step;
    a.move(`letter${i}`, [[0, 0, 0], [t, 0, 0, 'outQuad'], [t + dur * 0.45, 0, amp, 'inQuad'], [t + dur, 0, 0]]);
    a.scale(`letter${i}`, [[0, 1, 1], [t, 1, 1, 'outQuad'], [t + dur * 0.45, 1.12, 1.12, 'inOut'], [t + dur * 0.8, 0.95, 1.05, 'inOut'], [t + dur, 1, 1]]);
  }
};
const blink = (a, t) => {
  for (const e of ['eye_l', 'eye_r']) a.scale(e, [[0, 1, 1], [t, 1, 1, 'inQuad'], [t + 0.06, 1.06, 0.12, 'stepped'], [t + 0.1, 1.06, 0.12, 'outQuad'], [t + 0.2, 1, 1]]);
};
const happyFace = (a, t0, t1) => {
  for (const f of FEAT) {
    if (!size[`face_${f}_happy`]) continue;
    a.show(`face_${f}`, [[0, `face_${f}`], [t0, `face_${f}_happy`], ...(t1 ? [[t1, `face_${f}`]] : [])]);
    a.show(`face_${f}_light`, [[0, `face_${f}_light`], [t0, null], ...(t1 ? [[t1, `face_${f}_light`]] : [])]);
  }
  a.scale('mouth', [[0, 1, 1], [t0, 0.8, 1.2, 'outBack'], [t0 + 0.15, 1.08, 0.94, 'inOut'], [t0 + 0.3, 1, 1], ...(t1 ? [[t1 - 0.05, 1, 1, 'inOut'], [t1, 0.9, 1.1, 'outBack'], [t1 + 0.15, 1, 1]] : [])]);
};

const anims = {};
// ---- INTRO (1.8 s)
{
  const a = new Anim();
  a.scale('main', [[0, 0, 0, 'outBack'], [0.45, 1.06, 1.06, 'inOut'], [0.7, 1, 1]]);
  a.alpha('moon', WHITE, [[0, 0], [0.1, 0, 'out'], [0.45, 1]]);
  a.scale('moon', [[0, 0.4, 0.4], [0.1, 0.4, 0.4, 'outBack'], [0.55, 1, 1]]);
  a.rot('moon', [[0, -40, 'outCubic'], [0.6, 0]]);
  a.alpha('moon_glow', MOONG, [[0, 0], [0.3, 0, 'out'], [0.8, 0.4]]);
  a.alpha('aura', ORANGE, [[0, 0], [0.5, 0, 'out'], [0.9, 0.55]]);
  a.move('body', [[0, 0, -120, 'outBack'], [0.32, 0, 12, 'inOut'], [0.45, 0, 0]]);
  a.scale('body', [[0, 0.55, 1.45, 'out'], [0.3, 0.9, 1.15, 'out'], [0.42, 1.22, 0.78, 'outQuad'], [0.56, 0.93, 1.08, 'inOut'], [0.7, 1.03, 0.97, 'inOut'], [0.82, 1, 1]]);
  a.move('pumpkin_top', [[0, 0, 0], [0.42, 0, 0, 'outQuad'], [0.5, 0, -8, 'inOut'], [0.62, 0, 4, 'inOut'], [0.75, 0, 0]]);
  lightLevel(a, [[0, 0], [0.55, 0, 'outExpo'], [0.62, 1, 'inOut'], [0.68, 0.55, 'inOut'], [0.76, 1, 'inOut'], [0.84, 0.8, 'inOut'], [0.95, 1]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.55, 0, 'outExpo'], [0.63, 0.9, 'out'], [1.1, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0], [0.58, 0, 'outExpo'], [0.66, 1, 'out'], [1.1, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0], [0.6, 0, 'outExpo'], [0.68, 1, 'out'], [1.1, 0.35]]);
  blink(a, 1.25);
  a.move('hat', [[0, -40, 330], [0.22, -40, 330, 'inQuad'], [0.5, 0, 0, 'outQuad'], [0.6, 0, 16, 'inQuad'], [0.7, 0, 0]]);
  a.rot('hat', [[0, -35], [0.22, -35, 'inQuad'], [0.5, 10, 'outQuad'], [0.62, -6, 'inOut'], [0.76, 3, 'inOut'], [0.9, 0]]);
  a.scale('hat', [[0, 1, 1], [0.5, 1, 1, 'out'], [0.56, 1.12, 0.86, 'outBack'], [0.72, 1, 1]]);
  // plaque unrolls, slime oozes down, letters pop one by one
  a.scale('plaque', [[0, 0, 0.2], [0.45, 0, 0.2, 'outBack'], [0.75, 1, 1]]);
  a.move('plaque', [[0, 0, -30], [0.45, 0, -30, 'outBack'], [0.75, 0, 0]]);
  DRIPS.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 0.05, 1], [0.7 + i * 0.05, 0.05, 1, 'outBack'], [1.15 + i * 0.05, 1.15, 0.95, 'inOut'], [1.4 + i * 0.05, 1, 1]]));
  for (let i = 1; i <= NL; i++) {
    const t = 0.62 + i * 0.06;
    a.scale(`letter${i}`, [[0, 0, 0], [t, 0, 0, 'outBack'], [t + 0.22, 1.18, 1.18, 'inOut'], [t + 0.36, 1, 1]]);
    a.move(`letter${i}`, [[0, 0, -20], [t, 0, -20, 'outBack'], [t + 0.25, 0, 0]]);
  }
  a.move('plaque_shine', [[0, 0, 0], [1.2, 0, 0, 'inOut'], [1.6, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [1.2, 0.85], [1.6, 0.85, 'stepped'], [1.61, 0]]);
  a.move('bat_l', [[0, -260, 140], [0.35, -260, 140, 'outCubic'], [0.95, 0, 0]]);
  a.move('bat_r', [[0, 260, 120], [0.45, 260, 120, 'outCubic'], [1.05, 0, 0]]);
  a.scale('bat_l', [[0, 0.3, 0.3], [0.35, 0.3, 0.3, 'outCubic'], [0.95, 1, 1]]);
  a.scale('bat_r', [[0, 0.3, 0.3], [0.45, 0.3, 0.3, 'outCubic'], [1.05, 1, 1]]);
  flapBat(a, 'l', 0, 1.8, 0.14, 45); flapBat(a, 'r', 0, 1.8, 0.15, 45);
  puff(a, 'smoke1', 0.28, -30, 6, 'smoke_small', 0.6, WHITE, 0.7);
  puff(a, 'smoke2', 0.3, 30, 6, 'smoke_small', 0.6, WHITE, 0.7);
  a.show('ring', [[0, null], [0.55, 'ring'], [1.0, null]]);
  a.scale('ring', [[0, 0.2, 0.2], [0.55, 0.2, 0.2, 'outCubic'], [1.0, 1.6, 1.6]]);
  a.alpha('ring', GOLD, [[0, 0], [0.55, 0.9, 'in'], [1.0, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.95 + i * 0.07, 0.5));
  a.show('head_clip', [[0, null], [0.5, 'head_clip']]);
  a.ev(0.32, 'land').ev(0.5, 'hat').ev(0.55, 'ignite');
  anims.intro = a;
}
// ---- IDLE (4.8 s loop: two breaths, clouds drift, drips stretch and drop)
{
  const D = 4.8, a = new Anim();
  a.scale('body', [[0, 1, 1, 'sine'], [D / 4, 1.025, 0.975, 'sine'], [D / 2, 1, 1, 'sine'], [(3 * D) / 4, 1.025, 0.975, 'sine'], [D, 1, 1]]);
  a.move('pumpkin_l', [[0, 0, 0, 'sine'], [D / 4, -2, 0, 'sine'], [D / 2, 0, 0, 'sine'], [(3 * D) / 4, -2, 0, 'sine'], [D, 0, 0]]);
  a.move('pumpkin_r', [[0, 0, 0, 'sine'], [D / 4, 2, 0, 'sine'], [D / 2, 0, 0, 'sine'], [(3 * D) / 4, 2, 0, 'sine'], [D, 0, 0]]);
  a.rot('hat', [[0, 0, 'sine'], [D / 8, -3, 'sine'], [(3 * D) / 8, 3, 'sine'], [(5 * D) / 8, -3, 'sine'], [(7 * D) / 8, 3, 'sine'], [D, 0]]);
  a.move('hat', [[0, 0, 0, 'sine'], [D / 4, 0, 5, 'sine'], [D / 2, 0, 0, 'sine'], [(3 * D) / 4, 0, 5, 'sine'], [D, 0, 0]]);
  a.rot('hat_cone3', [[0, 0, 'sine'], [D / 4, 6, 'sine'], [D / 2, 0, 'sine'], [(3 * D) / 4, -5, 'sine'], [D, 0]]);
  a.rot('moon', [[0, 0, 'sine'], [D / 2, 4, 'sine'], [D, 0]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'sine'], [D / 4, 0.72, 'sine'], [D / 2, 0.5, 'sine'], [(3 * D) / 4, 0.72, 'sine'], [D, 0.5]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'sine'], [D / 2, 0.55, 'sine'], [D, 0.4]]);
  a.move('bat_l', [[0, 0, 0, 'sine'], [D / 4, 6, -12, 'sine'], [D / 2, 0, 0, 'sine'], [(3 * D) / 4, 4, -8, 'sine'], [D, 0, 0]]);
  a.move('bat_r', [[0, 0, 0, 'sine'], [D / 4, -5, 12, 'sine'], [D / 2, 0, 0, 'sine'], [(3 * D) / 4, -3, 9, 'sine'], [D, 0, 0]]);
  flapBat(a, 'l', 0, D, 0.3, 34); flapBat(a, 'r', 0, D, 0.4, 34);
  // slime life
  [[1, 0.3, 2.0], [2, 1.2, 2.9], [3, 2.1, 3.9], [4, 0.7, 2.4], [5, 2.6, 4.4], [6, 1.6, 3.3]].slice(0, DRIPS.length).forEach(([i, t0, t1]) => {
    dripStretch(a, i, t0, t1, 1.22 + (i % 2) * 0.1);
  });
  letterWave(a, 3.4, 0.07, 5, 0.4);
  WAVES.forEach((_, i) => {
    const ph = (i / WAVES.length) * D * 0.5;
    const k = [[0, 0, 0, 'sine']];
    for (let c = 0; c < 4; c++) { k.push([ph / 2 + c * (D / 4) + D / 8 - (ph / 2 + D / 8 > D ? D : 0), 0, -3.2, 'sine']); }
    a.move(`slime_wave${i + 1}`, [[0, 0, 0, 'sine'], [(D / 4) * 0.5 + i * 0.12, 0, -3.5, 'sine'], [(D / 4) * 1.5 + i * 0.12, 0, 1.5, 'sine'], [(D / 4) * 2.5 + i * 0.12, 0, -3.5, 'sine'], [(D / 4) * 3.5 + i * 0.12, 0, 1.5, 'sine'], [D, 0, 0]]);
    a.scale(`slime_wave${i + 1}`, [[0, 1, 1, 'sine'], [(D / 4) * 1 + i * 0.12, 1.03, 1.12, 'sine'], [(D / 4) * 2 + i * 0.12, 1, 1, 'sine'], [(D / 4) * 3 + i * 0.12, 1.03, 1.12, 'sine'], [D, 1, 1]]);
    void k;
  });
  a.move('plaque_shine', [[0, 0, 0], [1.6, 0, 0, 'inOut'], [2.2, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [1.6, 0.6], [2.2, 0.6, 'stepped'], [2.21, 0]]);
  [[1, 0.2], [2, 1.0], [3, 1.6], [4, 2.6], [5, 3.4], [6, 4.1]].forEach(([i, t]) => twinkle(a, i, t, 0.6));
  anims.idle = a;
}
// ---- IDLE_EYES (separate track: candle flicker + blinks)
{
  const D = 3.6, a = new Anim();
  lightLevel(a, [[0, 1, 'sine'], [0.3, 0.86, 'sine'], [0.55, 1, 'sine'], [0.9, 0.9, 'sine'], [1.3, 1, 'sine'], [2.0, 0.92, 'sine'], [2.9, 1, 'sine'], [3.2, 0.88, 'sine'], [D, 1]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35, 'sine'], [0.7, 0.55, 'sine'], [1.5, 0.3, 'sine'], [2.6, 0.5, 'sine'], [D, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35, 'sine'], [0.9, 0.5, 'sine'], [1.7, 0.3, 'sine'], [2.8, 0.5, 'sine'], [D, 0.35]]);
  blink(a, 2.35);
  anims.idle_eyes = a;
}
// ---- LAND (0.6 s)
{
  const a = new Anim();
  a.move('main', [[0, 0, 40, 'inQuad'], [0.08, 0, 0]]);
  a.scale('body', [[0, 0.92, 1.1, 'inQuad'], [0.08, 1.2, 0.8, 'outQuad'], [0.2, 0.94, 1.07, 'inOut'], [0.32, 1.03, 0.97, 'inOut'], [0.45, 1, 1]]);
  a.move('hat', [[0, 0, 0], [0.08, 0, 0, 'outQuad'], [0.2, 0, 28, 'inQuad'], [0.32, 0, 0, 'outQuad'], [0.38, 0, 5, 'inQuad'], [0.45, 0, 0]]);
  a.rot('hat', [[0, 0], [0.08, 0, 'outQuad'], [0.2, -9, 'inOut'], [0.34, 5, 'inOut'], [0.5, 0]]);
  a.scale('plaque', [[0, 1, 1], [0.08, 1, 1, 'outQuad'], [0.14, 1.06, 0.9, 'outBack'], [0.3, 1, 1]]);
  DRIPS.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 1, 1], [0.08, 1, 1, 'outQuad'], [0.18, 1.35, 0.9, 'inOut'], [0.36, 0.92, 1.05, 'inOut'], [0.5, 1, 1]]));
  for (const f of ['eye_l', 'eye_r']) a.scale(f, [[0, 1, 1], [0.08, 1, 1, 'outQuad'], [0.12, 1.1, 0.6, 'outBack'], [0.28, 1, 1]]);
  puff(a, 'smoke1', 0.06, -26, 4, 'smoke_small', 0.45, WHITE, 0.55);
  puff(a, 'smoke2', 0.06, 26, 4, 'smoke_small', 0.45, WHITE, 0.55);
  a.alpha('face_bloom', FACE, [[0, 0], [0.08, 0, 'out'], [0.14, 0.55, 'out'], [0.5, 0]]);
  a.ev(0.08, 'land');
  anims.land = a;
}
// ---- ANTICIPATION family
const antiPose = (a, t) => {
  a.scale('main', [[0, 1, 1, 'outBack'], [t, 1.1, 1.1]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'out'], [t, 0.95]]);
  a.alpha('rays', GOLD, [[0, 0, 'out'], [t, 0.55]]);
  a.alpha('face_bloom', FACE, [[0, 0, 'out'], [t, 0.6]]);
  a.move('bat_l', [[0, 0, 0, 'outCubic'], [t, 22, -14]]);
  a.move('bat_r', [[0, 0, 0, 'outCubic'], [t, -22, 14]]);
};
{
  const a = new Anim();
  antiPose(a, 0.35);
  a.move('hat', [[0, 0, 0, 'outQuad'], [0.15, 0, 20, 'inQuad'], [0.35, 0, 8]]);
  a.rot('rays', [[0, 0], [0.35, 20]]);
  for (const f of ['eye_l', 'eye_r']) a.scale(f, [[0, 1, 1, 'outBack'], [0.35, 1.15, 1.15]]);
  flapBat(a, 'l', 0, 0.35, 0.09, 45); flapBat(a, 'r', 0, 0.35, 0.09, 45);
  a.ev(0, 'tease');
  anims.anticipation = a;
}
{
  const D = 1.2, a = new Anim();
  a.scale('main', [[0, 1.1, 1.1, 'sine'], [D / 2, 1.13, 1.13, 'sine'], [D, 1.1, 1.1]]);
  const shake = [];
  for (let i = 0; i <= 12; i++) shake.push([(i * D) / 12, i === 0 || i === 12 ? 0 : (i % 2 ? 1 : -1) * (2.5 + (i % 3)), 'sine']);
  a.rot('body', shake);
  a.scale('body', [[0, 1, 1, 'sine'], [D / 4, 1.04, 0.96, 'sine'], [D / 2, 0.97, 1.03, 'sine'], [(3 * D) / 4, 1.04, 0.96, 'sine'], [D, 1, 1]]);
  a.move('hat', [[0, 0, 8, 'sine'], [D / 4, 0, 22, 'sine'], [D / 2, 0, 8, 'sine'], [(3 * D) / 4, 0, 22, 'sine'], [D, 0, 8]]);
  a.rot('hat', [[0, 0, 'sine'], [D / 4, -7, 'sine'], [(3 * D) / 4, 7, 'sine'], [D, 0]]);
  for (const f of ['eye_l', 'eye_r']) a.scale(f, [[0, 1.15, 1.15, 'sine'], [D / 2, 1.25, 1.25, 'sine'], [D, 1.15, 1.15]]);
  a.alpha('aura', ORANGE, [[0, 0.95, 'sine'], [D / 2, 0.7, 'sine'], [D, 0.95]]);
  a.alpha('rays', GOLD, [[0, 0.55, 'sine'], [D / 2, 0.75, 'sine'], [D, 0.55]]);
  a.rot('rays', [[0, 20], [D, 50]]);
  a.alpha('face_bloom', FACE, [[0, 0.6, 'sine'], [D / 2, 0.9, 'sine'], [D, 0.6]]);
  a.move('bat_l', [[0, 22, -14, 'sine'], [D / 2, 30, -4, 'sine'], [D, 22, -14]]);
  a.move('bat_r', [[0, -22, 14, 'sine'], [D / 2, -30, 4, 'sine'], [D, -22, 14]]);
  flapBat(a, 'l', 0, D, 0.1, 45); flapBat(a, 'r', 0, D, 0.12, 45);
  letterWave(a, 0, 0.06, 6, 0.3);
  [[1, 0.1], [2, 0.5], [3, 0.8], [4, 0.3], [5, 0.65], [6, 0.95]].forEach(([i, t]) => twinkle(a, i, t * D * 0.7, 0.4));
  anims.anticipation_idle = a;
}
{
  const a = new Anim();
  a.scale('main', [[0, 1.1, 1.1, 'inOut'], [0.5, 1, 1]]);
  a.alpha('aura', ORANGE, [[0, 0.95, 'out'], [0.5, 0.5]]);
  a.alpha('rays', GOLD, [[0, 0.55, 'out'], [0.4, 0]]);
  a.rot('rays', [[0, 20, 'out'], [0.4, 35]]);
  a.alpha('face_bloom', FACE, [[0, 0.6, 'out'], [0.4, 0]]);
  for (const f of ['eye_l', 'eye_r']) a.scale(f, [[0, 1.15, 1.15, 'inOut'], [0.4, 1, 1]]);
  a.move('hat', [[0, 0, 8, 'outQuad'], [0.25, 0, 0]]);
  a.move('bat_l', [[0, 22, -14, 'inOut'], [0.5, 0, 0]]);
  a.move('bat_r', [[0, -22, 14, 'inOut'], [0.5, 0, 0]]);
  flapBat(a, 'l', 0, 0.5, 0.25, 35); flapBat(a, 'r', 0, 0.5, 0.25, 35);
  anims.anticipation_end = a;
}
// ---- WIN (2.4 s): happy face, hat explosion, candy burst, letters wave, slime splashes
{
  const D = 2.4, a = new Anim();
  happyFace(a, 0.1, 1.9);
  a.scale('main', [[0, 1, 1, 'outBack'], [0.2, 1.22, 1.22, 'inOut'], [0.5, 1.12, 1.12, 'sine'], [1.7, 1.15, 1.15, 'inOut'], [D, 1, 1]]);
  a.scale('body', [[0, 1, 1, 'outQuad'], [0.1, 0.85, 1.18, 'outQuad'], [0.22, 1.15, 0.88, 'inOut'], [0.36, 0.97, 1.04, 'inOut'], [0.5, 1, 1, 'sine'], [1.05, 1, 1, 'outQuad'], [1.12, 1.16, 0.84, 'outBack'], [1.3, 1, 1]]);
  a.move('body', [[0, 0, 0, 'outQuad'], [0.1, 0, 0, 'outCubic'], [0.42, 0, 46, 'inQuad'], [0.7, 0, 0, 'sine'], [D, 0, 0]]);
  a.rot('body', [[0, 0], [0.42, 0, 'inOut'], [0.55, -6, 'inOut'], [0.7, 6, 'inOut'], [0.85, -3, 'inOut'], [1.0, 0]]);
  a.move('pumpkin_top', [[0, 0, 0], [0.7, 0, 0, 'outQuad'], [0.76, 0, -10, 'inOut'], [0.9, 0, 5, 'inOut'], [1.05, 0, 0]]);
  // hat explosion (the stem pops up when it leaves)
  a.move('hat', [[0, 0, 0, 'outCubic'], [0.5, 0, 150, 'inQuad'], [1.05, 0, 0, 'outQuad'], [1.15, 0, 14, 'inQuad'], [1.25, 0, 0]]);
  a.rot('hat', [[0, 0, 'inOut'], [1.0, -360, 'outBack'], [1.25, -360]]);
  a.scale('hat', [[0, 1, 1], [1.05, 1, 1, 'outQuad'], [1.1, 1.15, 0.85, 'outBack'], [1.3, 1, 1]]);
  a.rot('stem1', [[0, 0], [0.15, 0, 'outBack'], [0.3, 18, 'inOut'], [0.5, -12, 'inOut'], [0.75, 6, 'inOut'], [1.0, 0]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.12, 0, 'outExpo'], [0.2, 1, 'out'], [0.8, 0.45, 'sine'], [1.5, 0.6, 'out'], [D, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35], [0.15, 1, 'out'], [D, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35], [0.15, 1, 'out'], [D, 0.35]]);
  a.alpha('rays', GOLD, [[0, 0], [0.15, 0.9, 'sine'], [1.6, 0.7, 'out'], [D, 0]]);
  a.rot('rays', [[0, 0], [D, -90]]);
  a.scale('rays', [[0, 0.6, 0.6, 'outBack'], [0.3, 1.05, 1.05, 'sine'], [D, 1, 1]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'out'], [0.2, 1, 'sine'], [1.6, 0.8, 'out'], [D, 0.5]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'out'], [0.2, 0.9, 'out'], [D, 0.4]]);
  a.scale('moon', [[0, 1, 1, 'outBack'], [0.2, 1.08, 1.08, 'inOut'], [D, 1, 1]]);
  a.show('flash', [[0, null], [0.12, 'flash'], [0.6, null]]);
  a.alpha('flash', WHITE, [[0, 0], [0.12, 1, 'out'], [0.6, 0]]);
  a.scale('flash', [[0, 0.5, 0.5], [0.12, 0.6, 0.6, 'outCubic'], [0.6, 1.8, 1.8]]);
  a.show('ring', [[0, null], [0.14, 'ring'], [0.85, null]]);
  a.alpha('ring', GOLD, [[0, 0], [0.14, 1, 'in'], [0.85, 0]]);
  a.scale('ring', [[0, 0.3, 0.3], [0.14, 0.3, 0.3, 'outCubic'], [0.85, 2.3, 2.3]]);
  [[-190, 120, 420], [200, 160, -380], [30, 230, 300]].forEach(([dx, dy, spin], i) => {
    const s = `candy${i + 1}`, t0 = 0.14 + i * 0.03;
    a.show(s, [[0, null], [t0, s], [1.45, null]]);
    a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + 0.55, dx, dy, 'inQuad'], [1.45, dx * 1.25, dy - 260]]);
    a.rot(s, [[0, 0], [t0, 0], [1.45, spin]]);
    a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outBack'], [t0 + 0.3, 1.5, 1.5], [1.45, 1.1, 1.1]]);
    a.alpha(s, WHITE, [[0, 1], [1.2, 1, 'in'], [1.45, 0]]);
  });
  a.show('ghost', [[0, null], [0.3, 'ghost'], [D, null]]);
  a.move('ghost', [[0, 0, -40], [0.3, 0, -40, 'outBack'], [0.7, 120, 150, 'sine'], [1.5, 130, 165, 'inBack'], [1.95, 20, -30]]);
  a.rot('ghost', [[0, 0], [0.7, 0, 'sine'], [0.95, 12, 'sine'], [1.2, -8, 'sine'], [1.5, 0]]);
  a.rot('ghost_tail', [[0, 0, 'sine'], [0.5, 25, 'sine'], [0.8, -25, 'sine'], [1.1, 25, 'sine'], [1.4, -20, 'sine'], [1.7, 0]]);
  a.alpha('ghost', WHITE, [[0, 0], [0.3, 0, 'out'], [0.6, 0.95, 'sine'], [1.6, 0.95, 'in'], [1.95, 0]]);
  a.scale('ghost', [[0, 0.4, 0.4], [0.3, 0.4, 0.4, 'outBack'], [0.7, 1, 1, 'sine'], [1.5, 1.05, 0.95, 'in'], [1.95, 0.5, 0.5]]);
  a.move('bat_l', [[0, 0, 0, 'inOut'], [0.6, 60, 90, 'inOut'], [1.2, -30, 40, 'inOut'], [D, 0, 0]]);
  a.move('bat_r', [[0, 0, 0, 'inOut'], [0.6, -50, 110, 'inOut'], [1.2, 40, 30, 'inOut'], [D, 0, 0]]);
  flapBat(a, 'l', 0, D, 0.11, 48); flapBat(a, 'r', 0, D, 0.12, 48);
  a.scale('plaque', [[0, 1, 1, 'outBack'], [0.2, 1.12, 1.12, 'inOut'], [0.5, 1, 1, 'sine'], [D, 1, 1]]);
  letterWave(a, 0.25, 0.08, 16, 0.42);
  WAVES.forEach((_, i) => a.move(`slime_wave${i + 1}`, [[0, 0, 0], [0.12 + i * 0.05, 0, 0, 'outQuad'], [0.25 + i * 0.05, 0, 7, 'inOut'], [0.45 + i * 0.05, 0, -5, 'inOut'], [0.65 + i * 0.05, 0, 2, 'inOut'], [0.85 + i * 0.05, 0, 0]]));
  DRIPS.forEach((_, i) => dripStretch(a, i + 1, 0.15 + i * 0.05, 0.75 + i * 0.07, 1.3));
  a.move('plaque_shine', [[0, 0, 0], [0.25, 0, 0, 'inOut'], [0.75, 460, 0, 'stepped'], [1.2, 0, 0, 'inOut'], [1.7, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [0.25, 1], [1.7, 1, 'stepped'], [1.71, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.15 + i * 0.12, 0.55));
  puff(a, 'smoke3', 0.12, -90, 40, 'smoke_big', 0.8, [1, 0.85, 1], 0.6);
  puff(a, 'smoke4', 0.12, 90, 30, 'smoke_big', 0.8, [1, 0.85, 1], 0.6);
  for (const n of ['phys_hat1', 'phys_hat2', 'phys_hat3', 'phys_brim_l', 'phys_brim_r']) {
    a.phys(n, 'mix', [[0, 1, 'out'], [0.12, 0], [1.05, 0, 'in'], [1.35, 1]]);
    a.phys(n, 'reset', [1.05]);
  }
  a.show('head_clip', [[0, 'head_clip'], [0.02, null], [1.05, 'head_clip']]);
  a.ev(0.1, 'smile').ev(0.12, 'burst').ev(1.05, 'thump');
  anims.win = a;
}
// ---- TRIGGER (1.8 s)
{
  const D = 1.8, a = new Anim();
  happyFace(a, 0.9, null);
  const shake = [];
  for (let i = 0; i <= 18; i++) shake.push([(i * 0.9) / 18, i === 0 ? 0 : (i % 2 ? 1 : -1) * (1 + i * 0.35), 'sine']);
  shake.push([1.0, 0, 'outBack'], [D, 0]);
  a.rot('body', shake);
  a.scale('main', [[0, 1, 1, 'inCubic'], [0.9, 1.18, 1.18, 'outExpo'], [1.05, 1.42, 1.42, 'inOut'], [D, 1.32, 1.32]]);
  a.alpha('aura', [1, 0.45, 1], [[0, 0.5, 'in'], [0.9, 1, 'out'], [D, 0.9]]);
  a.scale('aura', [[0, 1, 1, 'in'], [0.9, 1.4, 1.4, 'out'], [D, 1.25, 1.25]]);
  a.alpha('rays', [0.85, 0.55, 1], [[0, 0, 'in'], [0.9, 1, 'out'], [D, 0.8]]);
  a.rot('rays', [[0, 0, 'in'], [D, -180]]);
  a.alpha('face_bloom', [1, 0.55, 0.9], [[0, 0, 'in'], [0.9, 0.55, 'out'], [D, 0.35]]);
  for (const f of ['eye_l', 'eye_r']) a.scale(f, [[0, 1, 1, 'in'], [0.85, 1.3, 1.3, 'outBack'], [1.0, 1, 1]]);
  a.move('hat', [[0, 0, 0, 'in'], [0.9, 0, 14, 'outBack'], [1.1, 0, 40, 'inOut'], [D, 0, 30]]);
  a.rot('hat', [[0, 0, 'in'], [0.9, -6, 'outBack'], [1.2, 8, 'inOut'], [D, 4]]);
  a.show('flash', [[0, null], [0.9, 'flash'], [1.5, null]]);
  a.alpha('flash', [1, 0.85, 1], [[0, 0], [0.9, 0.85, 'out'], [1.5, 0]]);
  a.scale('flash', [[0, 1, 1], [0.9, 1, 1, 'outCubic'], [1.5, 3.2, 3.2]]);
  a.show('ring', [[0, null], [0.9, 'ring'], [1.6, null]]);
  a.alpha('ring', [0.9, 0.6, 1], [[0, 0], [0.9, 1, 'in'], [1.6, 0]]);
  a.scale('ring', [[0, 0.3, 0.3], [0.9, 0.3, 0.3, 'outCubic'], [1.6, 3, 3]]);
  a.move('bat_l', [[0, 0, 0, 'inBack'], [0.9, -120, 60, 'outCubic'], [D, -70, 40]]);
  a.move('bat_r', [[0, 0, 0, 'inBack'], [0.9, 120, 60, 'outCubic'], [D, 70, 40]]);
  flapBat(a, 'l', 0, D, 0.08, 50); flapBat(a, 'r', 0, D, 0.08, 50);
  a.color('moon', [[0, 1, 1, 1, 1, 'in'], [0.9, 1, 0.8, 1, 1], [D, 1, 0.85, 1, 1]]);
  a.alpha('moon_glow', [0.9, 0.7, 1], [[0, 0.4, 'in'], [0.9, 1, 'out'], [D, 0.8]]);
  for (let i = 1; i <= NL; i++) a.move(`letter${i}`, [[0, 0, 0, 'in'], [0.9, (i % 2 ? 1 : -1) * 2, 0, 'outBack'], [1.05, 0, 18, 'inOut'], [1.3 + i * 0.03, 0, 6, 'inOut'], [D, 0, 8]]);
  DRIPS.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 1, 1, 'in'], [0.9, 1.5, 0.9, 'outBack'], [1.2, 1.2, 1, 'inOut'], [D, 1.3, 0.95]]));
  a.move('plaque_shine', [[0, 0, 0], [0.9, 0, 0, 'inOut'], [1.4, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [0.9, 1], [1.4, 1, 'stepped'], [1.41, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.9 + (i % 3) * 0.1, 0.6));
  a.ev(0, 'charge').ev(0.9, 'trigger');
  anims.trigger = a;
}
// ---- OUTRO (1.0 s)
{
  const a = new Anim();
  a.move('hat', [[0, 0, 0, 'outQuad'], [0.15, 0, -8, 'outCubic'], [0.7, 220, 330]]);
  a.rot('hat', [[0, 0], [0.15, 0, 'outCubic'], [0.7, -200]]);
  a.color('hat', [[0, 1, 1, 1, 1], [0.45, 1, 1, 1, 1, 'in'], [0.7, 1, 1, 1, 0]]);
  a.scale('body', [[0, 1, 1, 'outQuad'], [0.15, 1.18, 0.82, 'outQuad'], [0.25, 0.92, 1.08, 'inOut'], [0.3, 1, 1]]);
  a.scale('pumpkin', [[0, 1, 1], [0.25, 1, 1, 'inBack'], [0.55, 0.02, 0.02]]);
  a.rot('pumpkin', [[0, 0], [0.25, 0, 'in'], [0.55, 200]]);
  lightLevel(a, [[0, 1], [0.2, 1, 'in'], [0.4, 0]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.1, 0.8, 'in'], [0.4, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35], [0.3, 0]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35], [0.3, 0]]);
  for (let i = 1; i <= NL; i++) {
    const t = 0.05 + i * 0.03;
    a.move(`letter${i}`, [[0, 0, 0], [t, 0, 0, 'outQuad'], [t + 0.12, 0, 14, 'inBack'], [t + 0.35, 0, -80]]);
    a.scale(`letter${i}`, [[0, 1, 1], [t + 0.12, 1, 1, 'in'], [t + 0.35, 0.2, 0.2]]);
  }
  DRIPS.forEach((_, i) => a.scale(`drip${i + 1}`, [[0, 1, 1, 'inBack'], [0.4, 0.05, 1]]));
  a.scale('plaque', [[0, 1, 1, 'outQuad'], [0.25, 1.06, 1.06, 'inBack'], [0.6, 1.1, 0]]);
  a.move('bat_l', [[0, 0, 0, 'inCubic'], [0.7, -280, 160]]);
  a.move('bat_r', [[0, 0, 0, 'inCubic'], [0.75, 280, 170]]);
  a.scale('bat_l', [[0, 1, 1, 'in'], [0.7, 0.4, 0.4]]);
  a.scale('bat_r', [[0, 1, 1, 'in'], [0.75, 0.4, 0.4]]);
  for (const s of ['bat_l', 'bat_r']) a.color(s, [[0, 1, 1, 1, 1], [0.5, 1, 1, 1, 1, 'in'], [0.72, 1, 1, 1, 0]]);
  for (const s of ['l', 'r']) for (const w of ['l', 'r']) a.color(`bat_${s}_wing_${w}`, [[0, 1, 1, 1, 1], [0.5, 1, 1, 1, 1, 'in'], [0.72, 1, 1, 1, 0]]);
  flapBat(a, 'l', 0, 0.8, 0.08, 50); flapBat(a, 'r', 0, 0.8, 0.08, 50);
  a.alpha('moon', WHITE, [[0, 1], [0.3, 1, 'in'], [0.62, 0]]);
  a.scale('moon', [[0, 1, 1], [0.3, 1, 1, 'inBack'], [0.62, 0.2, 0.2]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'in'], [0.5, 0]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'outQuad'], [0.25, 0.9, 'in'], [0.8, 0]]);
  puff(a, 'smoke3', 0.38, -40, 50, 'smoke_big', 0.6, WHITE, 0.95);
  puff(a, 'smoke4', 0.42, 45, 30, 'smoke_big', 0.55, WHITE, 0.95);
  puff(a, 'smoke1', 0.1, -35, 0, 'smoke_small', 0.5, WHITE, 0.6);
  puff(a, 'smoke2', 0.1, 35, 0, 'smoke_small', 0.5, WHITE, 0.6);
  a.show('flash', [[0, null], [0.5, 'flash'], [0.85, null]]);
  a.alpha('flash', [1, 0.8, 1], [[0, 0], [0.5, 0.8, 'out'], [0.85, 0]]);
  for (const n of ['phys_hat1', 'phys_hat2', 'phys_hat3', 'phys_brim_l', 'phys_brim_r']) a.phys(n, 'mix', [[0, 1, 'out'], [0.15, 0]]);
  a.show('head_clip', [[0, 'head_clip'], [0.15, null]]);
  a.ev(0.15, 'hat').ev(0.5, 'vanish');
  anims.outro = a;
}

// ------------------------------------------------------------------ write
const skeleton = {
  skeleton: { hash: '', spine: '4.2.43', x: -300, y: -260, width: 600, height: 560, images: './images/', audio: '' },
  bones, slots,
  physics,
  skins: [{ name: 'default', attachments: A }],
  events: { land: {}, ignite: {}, hat: {}, tease: {}, smile: {}, burst: {}, thump: {}, charge: {}, trigger: {}, vanish: {} },
  animations: Object.fromEntries(Object.entries(anims).map(([k, v]) => [k, v.json()])),
};
skeleton.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skeleton)).digest('base64').slice(0, 11);
fs.writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(skeleton));
const meshes = Object.values(A).flatMap((o) => Object.values(o)).filter((x) => x.type === 'mesh');
const pageFiles = pages.map((_, i) => (pages.length > 1 ? `${NAME}${i ? '_' + (i + 1) : ''}.png` : `${NAME}.png`));
fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
  id: `creations/halloween/scatter`, package: NAME, name: NAME, game: 'Halloween (créations)', game_slug: 'halloween', provider: 'Scrap (création originale)',
  format: 'spine', skeleton_format: 'json', skeleton_file: `${NAME}.json`, skeleton_version: '4.2.43', version: 2,
  category: 'symbol', subtypes: ['scatter', 'entrance', 'idle', 'land', 'anticipation', 'win', 'exit'], tags: ['halloween', 'scatter', 'pumpkin', 'witch', 'bat', 'ghost', 'moon', 'candy', 'slime'],
  animations: Object.keys(anims), events: Object.keys(skeleton.events), bones_count: bones.length, slots_count: slots.length,
  meshes: meshes.length, physics_constraints: physics.length, skins: ['default'],
  atlases: [{ file: `${NAME}.atlas`, pages: pageFiles }], textures: pageFiles.map((f, i) => ({ file: f, page: f, width: pages[i].w, height: pages[i].h, pma: false })),
  complete: true, warnings: [],
  usage: { tracks: { 0: 'intro -> idle (loop) | land | anticipation -> anticipation_idle (loop) -> anticipation_end | win | trigger | outro', 1: 'idle_eyes (loop) together with idle' } },
}, null, 1));
console.log(`bones ${bones.length}, slots ${slots.length}, meshes ${meshes.length}, physics ${physics.length}, drips ${DRIPS.length}, pages ${pages.length}`);
console.log('animations:', Object.keys(anims).join(', '));
