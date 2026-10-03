// Halloween V2 symbols — V3 rig, built like the pumpkin scatter:
//  - every moving part is a COMPLETE AI-generated piece (sjinn edits aligned on the source: body without part / part alone)
//  - body = jelly grid mesh weighted between 'body' and 'top' bones (squash & stretch, top lags behind)
//  - tails / wings / wrappers / hats = weighted meshes on 2-3 bone chains + Spine 4.2 physics on the chain tips
//  - additive copies (win flash), tinted backglow + rays + sparks, shine sweep clipped to the silhouette, blinks, glows
// Animations: intro / idle / connexion / outro.     node symbols/build_symbols3.mjs [id]   (from creations/halloween-v2)
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { load, chromaKey, alphaBox, crop, resize, procedural, pack, composePage } from '../../tools/imagekit.js';

const R = (v) => Math.round(v * 100) / 100;
const T = (t) => Math.round(t * 10000) / 10000;
const SRC = 'symbols/source/', P3 = SRC + 'parts3k/';

// part: { n, file | derive, pivot [u,v], tip [u,v], chain (bones), z: back|front, phys, kind }
const SYMBOLS = [
  { id: 'bat', tier: 'high', width: 195, tint: [0.75, 0.4, 1], blink: 'bat_blink_raw.png', body: 'bat_body', topV: 0.25,
    parts: [
      { n: 'wing_l', file: 'bat_wing_l', pivot: [0.36, 0.5], tip: [0.02, 0.62], chain: 2, z: 'back', phys: true, kind: 'wing', dir: 1 },
      { n: 'wing_r', derive: 'mirror:wing_l', pivot: [0.64, 0.5], tip: [0.98, 0.62], chain: 2, z: 'back', phys: true, kind: 'wing', dir: -1 } ] },
  { id: 'cat', tier: 'high', width: 175, tint: [1, 0.72, 0.2], blink: 'cat_blink_raw.png', body: 'cat_body', topV: 0.3,
    parts: [{ n: 'tail', file: 'cat_tail', pivot: [0.22, 0.86], tip: [0.04, 0.5], chain: 3, z: 'back', phys: true, kind: 'tail' }] },
  { id: 'pumpkin', tier: 'high', width: 180, tint: [1, 0.55, 0.15], body: 'pumpkin_body', topV: 0.45,
    parts: [{ n: 'hat', file: 'pumpkin_hat', pivot: [0.48, 0.42], tip: [0.86, 0.05], chain: 2, z: 'front', phys: true, kind: 'hat' }],
    glows: [[0.3, 0.6, 0.15], [0.68, 0.6, 0.15], [0.5, 0.78, 0.28]] },
  { id: 'skull', tier: 'high', width: 165, tint: [1, 0.85, 0.6], topV: 0.25, meshJaw: 0.76, parts: [],
    glows: [[0.32, 0.47, 0.17], [0.72, 0.43, 0.17]] },
  { id: 'cauldron', tier: 'high', width: 180, tint: [0.6, 1, 0.3], body: 'cauldron_pot', topV: 0.3, bubbles: 'b8f060', bubbleArea: [0.5, 0.22, 0.32] },
  { id: 'potion', tier: 'high', width: 140, tint: [0.35, 0.95, 0.85], body: 'potion_bottle', topV: 0.25,
    parts: [{ n: 'cork', file: 'potion_cork', clipV: 0.185, pivot: [0.5, 0.17], tip: [0.5, 0.02], chain: 1, z: 'front', kind: 'cork' }],
    bubbles: 'b6fff0', bubbleArea: [0.5, 0.72, 0.28], glows: [[0.5, 0.72, 0.38]] },
  { id: 'moon', tier: 'high', width: 160, tint: [1, 0.85, 0.4], topV: 0.2, glows: [[0.4, 0.2, 0.09], [0.31, 0.53, 0.1], [0.58, 0.75, 0.1]] },
  { id: 'candy_orange', tier: 'low', width: 185, tint: [1, 0.55, 0.15], body: 'candy_orange_body', topV: 0.3, ball: true,
    parts: [
      { n: 'wrap_l', derive: 'split:candy_orange_wraps:L', band: 4, pivot: [0.35, 0.56], tip: [0.02, 0.75], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: 1 },
      { n: 'wrap_r', derive: 'split:candy_orange_wraps:R', band: 4, pivot: [0.69, 0.36], tip: [0.98, 0.15], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: -1 } ] },
  { id: 'candy_purple', tier: 'low', width: 185, tint: [0.7, 0.4, 1], body: 'candy_purple_body', topV: 0.3, ball: true,
    parts: [
      { n: 'wrap_l', derive: 'split:candy_purple_wraps:L', band: 4, pivot: [0.31, 0.6], tip: [0.02, 0.8], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: 1 },
      { n: 'wrap_r', derive: 'split:candy_purple_wraps:R', band: 4, pivot: [0.69, 0.36], tip: [0.98, 0.12], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: -1 } ] },
  { id: 'candy_teal', tier: 'low', width: 185, tint: [0.3, 0.9, 0.85], body: 'candy_teal_body', topV: 0.3, ball: true,
    parts: [
      { n: 'wrap_l', derive: 'split:candy_teal_wraps:L', band: 4, pivot: [0.32, 0.56], tip: [0.02, 0.75], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: 1 },
      { n: 'wrap_r', derive: 'split:candy_teal_wraps:R', band: 4, pivot: [0.69, 0.34], tip: [0.98, 0.12], chain: 2, z: 'back', phys: true, kind: 'wrap', dir: -1 } ] },
  { id: 'candycorn', tier: 'low', width: 135, tint: [1, 0.75, 0.25], topV: 0.2 },
];

// ------------------------------------------------------------------ image helpers
const blank = (w, h) => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
let HAT_LINE = null; // brim bottom per column (set by the hatcol derive)
// dark outline everywhere in this art style: light fringe pixels on the silhouette edge -> outline colour
function defringe(img) {
  const { w, h, px } = img;
  const edge = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || px[(Y * w + X) * 4 + 3] < 40) return true; } return false; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (px[i + 3] === 0) continue;
    const lum = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
    if (px[i + 3] < 220 || (lum > 70 && edge(x, y))) { px[i] = 22; px[i + 1] = 17; px[i + 2] = 36; }
    if (px[i + 3] < 60) px[i + 3] = 0; // no faint halo
  }
  return img;
}
/** back part limited to what shows outside the front piece + an overlap band hidden under it */
function limitBehind(part, front, band = 10) {
  const { w, h } = part;
  const out = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (part.px[i + 3] < 8) continue;
    let keep = front.px[i + 3] < 128;
    if (!keep) for (let r = 1; r <= band && !keep; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && front.px[(Y * w + X) * 4 + 3] < 128) { keep = true; break; }
    }
    if (keep) out.px.set(part.px.subarray(i, i + 4), i);
  }
  return out;
}
const loadPart = async (f) => defringe(await load(P3 + f + '.png'));
async function derive(spec, src, w, h, partsDone) {
  const [kind, a, b] = spec.split(':');
  if (kind === 'mirror') {
    const p = partsDone[a];
    const o = blank(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4; o.px.set(p.px.subarray(j, j + 4), i); }
    return o;
  }
  if (kind === 'split') {
    const p = await loadPart(a);
    const o = blank(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if ((b === 'L') !== (x < w / 2)) continue; const i = (y * w + x) * 4; o.px.set(p.px.subarray(i, i + 4), i); }
    return o;
  }
  if (kind === 'hatcol') { // per column: everything from the top down to the last hat-coloured pixel before the pumpkin starts
    const lim = Number(b) * h, o = blank(w, h), LH = [];
    HAT_LINE = new Array(w).fill(-1);
    const isOrange = (i) => { const r = src.px[i], g = src.px[i + 1], bb = src.px[i + 2]; return r > 180 && g > 55 && g < 140 && bb < 80 && r - g > 70; };
    const isTeal = (i) => { const r = src.px[i], g = src.px[i + 1], bb = src.px[i + 2]; return g > 70 && bb > 70 && r < 90 && Math.abs(g - bb) < 50; };
    for (let x = 0; x < w; x++) {
      let lastHat = -1, orangeRun = 0, seenTeal = false;
      for (let y = 0; y < lim; y++) {
        const i = (y * w + x) * 4;
        if (src.px[i + 3] < 128) continue;
        if (isTeal(i)) seenTeal = true;
        if (isOrange(i)) { if (++orangeRun >= 6) break; } else { orangeRun = 0; if (seenTeal) lastHat = y; }
      }
      if (!seenTeal) lastHat = -1;
      LH[x] = lastHat;
    }
    // smooth the brim line: a column can't go much lower than its neighbours' median (removes streaks)
    for (let x = 0; x < w; x++) {
      const win = []; for (let d = -8; d <= 8; d++) if (LH[x + d] !== undefined && LH[x + d] >= 0) win.push(LH[x + d]);
      if (win.length < 5) continue;
      win.sort((a, c) => a - c);
      const med = win[win.length >> 1];
      const yEnd = LH[x] < 0 ? med : Math.max(med - 3, Math.min(LH[x], med + 3));
      HAT_LINE[x] = yEnd;
      for (let y = 0; y <= yEnd; y++) { const i = (y * w + x) * 4; if (src.px[i + 3] > 0 && !(y > yEnd - 14 && isOrange(i))) o.px.set(src.px.subarray(i, i + 4), i); }
    }
    return o;
  }
  if (kind === 'diff' || kind === 'diffbelow') { // part = source minus the "without part" image, above (or below) v limit
    const body = await loadPart(a), lim = Number(b) * h;
    const o = blank(w, h);
    for (let y = kind === 'diff' ? 0 : Math.round(lim); y < (kind === 'diff' ? lim : h); y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src.px[i + 3] < 128) continue;
      const r = src.px[i], g = src.px[i + 1], bb = src.px[i + 2];
      if (kind === 'diffbelow') { o.px.set(src.px.subarray(i, i + 4), i); continue; } // original band, its top edge hides behind the closed part
      const orange = r > 190 && g > 60 && g < 150 && bb < 70 && r - g > 75; // pumpkin skin never belongs to the hat
      const d = body.px[i + 3] < 128 ? 999 : Math.abs(r - body.px[i]) + Math.abs(g - body.px[i + 1]) + Math.abs(bb - body.px[i + 2]);
      if (d > 50 && !orange) o.px.set(src.px.subarray(i, i + 4), i);
    }
    if (kind === 'diff') { // close small holes (buckle, band): a pixel enclosed on 4 sides within 8px is part of the hat
      const has = (x, y) => x >= 0 && y >= 0 && x < w && y < h && o.px[(y * w + x) * 4 + 3] > 0;
      const fill = [];
      for (let y = 0; y < lim; y++) for (let x = 0; x < w; x++) {
        if (has(x, y) || src.px[(y * w + x) * 4 + 3] < 128) continue;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let r = 1; r <= 8; r++) if (has(x + dx * r, y + dy * r)) { n++; break; }
        if (n === 4) fill.push((y * w + x) * 4);
      }
      for (const i of fill) o.px.set(src.px.subarray(i, i + 4), i);
    }
    return o;
  }
  throw new Error(spec);
}

// ------------------------------------------------------------------ animation helpers
const EASE = { in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1], sine: [0.37, 0, 0.63, 1], outBack: [0.34, 1.56, 0.64, 1], inBack: [0.36, 0, 0.66, -0.56], outQuad: [0.5, 1, 0.89, 1], inQuad: [0.11, 0, 0.5, 0], outCubic: [0.33, 1, 0.68, 1], outExpo: [0.16, 1, 0.3, 1] };
const curve = (t0, v0, t1, v1, e) => { if (e === 'stepped') return 'stepped'; const c = EASE[e]; if (!c) return null; return v0.flatMap((_, i) => [T(t0 + c[0] * (t1 - t0)), R(v0[i] + c[1] * (v1[i] - v0[i])), T(t0 + c[2] * (t1 - t0)), R(v0[i] + c[3] * (v1[i] - v0[i]))]); };
const tl = (keys, f) => keys.map((k, i) => { const o = {}; if (k[0]) o.time = T(k[0]); f.forEach((n, j) => (o[n] = R(k[1 + j]))); const nx = keys[i + 1]; if (nx) { const c = curve(k[0], k.slice(1, 1 + f.length), nx[0], nx.slice(1, 1 + f.length), k[1 + f.length]); if (c) o.curve = c; } return o; });
const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
class Anim {
  constructor(B, S, PH) { this.bones = {}; this.slots = {}; this.events = []; this.physics = {}; this.B = B; this.S = S; this.PH = PH; }
  b(n) { if (!this.B.has(n)) throw new Error('bone ' + n); return (this.bones[n] ||= {}); }
  rot(n, k) { this.b(n).rotate = tl(k, ['value']); return this; }
  move(n, k) { this.b(n).translate = tl(k, ['x', 'y']); return this; }
  scale(n, k) { this.b(n).scale = tl(k, ['x', 'y']); return this; }
  alpha(s, rgb, keys) { if (!this.S.has(s)) throw new Error('slot ' + s); (this.slots[s] ||= {}).rgba = keys.map(([t, a, e], i) => { const o = {}; if (t) o.time = T(t); o.color = [...rgb, a].map(hex).join(''); const nx = keys[i + 1]; if (nx) { const c = curve(t, [...rgb, a], nx[0], [...rgb, nx[1]], e); if (c) o.curve = c; } return o; }); return this; }
  show(s, keys) { (this.slots[s] ||= {}).attachment = keys.map(([t, n]) => ({ ...(t ? { time: T(t) } : {}), name: n })); return this; }
  reset(t) { for (const n of this.PH) (this.physics[n] ||= {}).reset = [t ? { time: T(t) } : {}]; return this; }
  ev(t, n) { this.events.push({ ...(t ? { time: T(t) } : {}), name: n }); return this; }
  json() { const o = {}; for (const k of ['slots', 'bones', 'physics']) if (Object.keys(this[k]).length) o[k] = this[k]; if (this.events.length) o.events = this.events; return o; }
}

async function build(S) {
  const OUT = `symbols/${S.id}/package`;
  fs.rmSync(`symbols/${S.id}`, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const src = defringe(await load(SRC + S.id + '.png'));
  const { w, h } = src;
  const k = S.width / w, Wd = S.width, H = h * k;
  const U = (u, v) => [(u - 0.5) * Wd, (0.5 - v) * H];
  const high = S.tier === 'high';

  // ---- images
  let bodyImg = S.body ? await loadPart(S.body) : src;
  const partImgs = {};
  const { largestBlob } = await import('../../tools/imagekit.js');
  for (const p of S.parts || []) {
    let im = p.file ? await loadPart(p.file) : await derive(p.derive, src, w, h, partImgs);
    if (p.derive && p.derive.startsWith('diff:')) im = largestBlob(im, 60);
    if (p.clipV) for (let y = Math.round(p.clipV * h); y < h; y++) for (let x = 0; x < w; x++) im.px[(y * w + x) * 4 + 3] = 0;
    partImgs[p.n] = im;
  }
  if (false) { // original drawing below the brim, AI-completed top only under the hat
    const comp = blank(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, useSrc = HAT_LINE[x] < 0 || y > HAT_LINE[x] - 4;
      const from = useSrc ? src : bodyImg;
      comp.px.set(from.px.subarray(i, i + 4), i);
    }
    bodyImg = comp;
  }
  HAT_LINE = null;
  for (const p of S.parts || []) if (p.z === 'back') partImgs[p.n] = limitBehind(partImgs[p.n], bodyImg, p.band || 10);
  // moon stars: source minus plain moon
  const starPieces = [];
  if (S.starsFrom) { // star = pixels differing from the plain moon, inside a disc around each known star
    const plain = await loadPart(S.starsFrom);
    for (const [su, sv, sr] of S.starPos) {
      const cx = su * w, cy = sv * h, rad = sr * w, m = blank(w, h);
      for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(h, cy + rad); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, cx + rad); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
        const i = (y * w + x) * 4;
        const d = Math.abs(src.px[i] - plain.px[i]) + Math.abs(src.px[i + 1] - plain.px[i + 1]) + Math.abs(src.px[i + 2] - plain.px[i + 2]);
        if (src.px[i + 3] > 200 && d > 60) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = ((y + dy) * w + x + dx) * 4; if (j >= 0 && j < w * h * 4) { m.px.set(src.px.subarray(j, j + 4), j); } }
      }
      const bb = alphaBox(m, 8); if (!bb) continue;
      const c = crop(m, bb, 1);
      starPieces.push({ img: c, at: U((c.x0 + c.w / 2) / w, (c.y0 + c.h / 2) / h), size: [c.w * k, c.h * k] });
    }
  }
  let blinkPiece = null; // (legacy eye patch, unused)
  if (S.blink) {
    const { data } = await sharp(SRC + S.blink).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bl = chromaKey({ w, h, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }, { minArea: 2000 });
    // eyes only: strong differences with the ORIGINAL drawing, 2 biggest blobs, slightly grown
    const { components } = await import('../../tools/imagekit.js');
    const diffM = blank(w, h);
    for (let y = Math.round(h * 0.15); y < h * 0.7; y++) for (let x = Math.round(w * 0.2); x < w * 0.85; x++) {
      const i = (y * w + x) * 4;
      if (src.px[i + 3] < 200 || bl.px[i + 3] < 200) continue;
      const d = Math.abs(src.px[i] - bl.px[i]) + Math.abs(src.px[i + 1] - bl.px[i + 1]) + Math.abs(src.px[i + 2] - bl.px[i + 2]);
      if (d > 90) diffM.px[i + 3] = 255;
    }
    const eyes = components(diffM, { minArea: 60, gap: 3 }).sort((p, q) => q.w * q.h - p.w * p.h).slice(0, 2);
    const m = blank(w, h);
    for (const e of eyes) for (let y = e.y - 4; y < e.y + e.h + 4; y++) for (let x = e.x - 4; x < e.x + e.w + 4; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2, rx = e.w / 2 + 4, ry = e.h / 2 + 4;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      const j = (y * w + x) * 4; if (bodyImg.px[j + 3] < 200) continue;
      m.px.set(bl.px.subarray(j, j + 3), j); m.px[j + 3] = 255;
    }
    const bb = alphaBox(m, 8);
    if (bb) { const c = crop(m, bb, 1); blinkPiece = { img: c, at: U((c.x0 + c.w / 2) / w, (c.y0 + c.h / 2) / h), size: [c.w * k, c.h * k] }; }
  }
  const pieceOf = (img, box) => { const bb = box || alphaBox(img, 8); const c = crop(img, bb, 2); return { img: c, at: U((c.x0 + c.w / 2) / w, (c.y0 + c.h / 2) / h), size: [c.w * k, c.h * k], box: bb }; };
  const bodyP = pieceOf(bodyImg);
  let bodyBlink = null;
  if (S.blink) { try { bodyBlink = pieceOf(await loadPart(S.id + '_bodyblink'), bodyP.box); } catch { bodyBlink = null; } }
  blinkPiece = null; // eye patches replaced by the whole-body swap
  const parts = (S.parts || []).map((p) => ({ ...p, ...pieceOf(partImgs[p.n]) }));

  // ---- atlas
  const items = [{ name: 'body', img: bodyP.img }];
  for (const p of parts) items.push({ name: p.n, img: p.img });
  starPieces.forEach((s, i) => items.push({ name: `star_m${i + 1}`, img: s.img }));
  if (bodyBlink) items.push({ name: 'body_blink', img: bodyBlink.img });
  for (const [n, t] of [['glow', 128], ['rays', 512], ['flash', 256], ['ring', 256], ['dot', 64], ['shine', 128]]) items.push({ name: n, img: procedural(n, t) });
  const star = await load('../halloween/scatter/parts/star.png'); items.push({ name: 'star', img: await resize(star, 64, Math.round((64 * star.h) / star.w)) });
  const smoke = await load('../halloween/scatter/parts/smoke_small.png'); items.push({ name: 'smoke', img: await resize(smoke, 120, Math.round((120 * smoke.h) / smoke.w)) });
  const [page] = pack(items, { maxSize: 2048, padding: 4 });
  fs.writeFileSync(`${OUT}/${S.id}.png`, await composePage(page));
  fs.writeFileSync(`${OUT}/${S.id}.atlas`, `${S.id}.png\nsize:${page.w},${page.h}\nfilter:Linear,Linear\n` + page.rects.map((r) => `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`).join(''));

  // ---- bones (+ world matrices for mesh weights)
  const bones = [], BN = new Set(), BI = {};
  const bone = (name, parent, o = {}) => { BN.add(name); BI[name] = bones.length; bones.push({ name, ...(parent ? { parent } : {}), ...Object.fromEntries(Object.entries(o).map(([a, v]) => [a, typeof v === 'number' ? R(v) : v])) }); };
  bone('root'); bone('main', 'root');
  bone('shadow', 'main', { y: -H / 2 - 3 }); bone('backglow', 'main'); bone('rays', 'main');
  bone('tilt', 'main');
  bone('base', 'tilt', { y: -H / 2 }); bone('body', 'base', { y: H / 2 });
  const topY = (0.5 - S.topV) * H;
  bone('top', 'body', { y: topY });
  if (S.meshJaw) bone('mjaw', 'body', { y: (0.5 - S.meshJaw) * H });
  const chains = {};
  for (const p of parts) {
    const pv = U(...p.pivot), tp = U(...p.tip);
    const ang = (Math.atan2(tp[1] - pv[1], tp[0] - pv[0]) * 180) / Math.PI, len = Math.hypot(tp[0] - pv[0], tp[1] - pv[1]) / p.chain;
    const parent = p.kind === 'hat' || p.kind === 'cork' ? 'top' : 'body';
    const par = parent === 'top' ? [pv[0], pv[1] - topY] : pv;
    bone(`${p.n}1`, parent, { x: par[0], y: par[1], rotation: ang, length: len });
    for (let i = 2; i <= p.chain; i++) bone(`${p.n}${i}`, `${p.n}${i - 1}`, { x: len, length: len });
    chains[p.n] = { pv, tp, len };
  }
  if (blinkPiece) bone('eyes', 'top', { x: blinkPiece.at[0], y: blinkPiece.at[1] - topY });
  (S.glows || []).forEach(([u, v], i) => { const [x, y] = U(u, v); bone(`eglow${i + 1}`, 'body', { x, y }); });
  starPieces.forEach((s, i) => bone(`mstar${i + 1}`, 'body', { x: s.at[0], y: s.at[1] }));
  const BUB = S.bubbles ? [0, 1, 2, 3] : [];
  BUB.forEach((i) => { const [bx, by] = U(S.bubbleArea[0] + (i - 1.5) * S.bubbleArea[2] * 0.45, S.bubbleArea[1]); bone(`bub${i + 1}`, 'body', { x: bx, y: by }); });
  bone('shine', 'body', { x: -Wd * 0.75 });
  const SP = [[-0.62, 0.42], [0.6, 0.36], [-0.5, -0.36], [0.55, -0.42], [0.05, 0.62], [-0.1, -0.6]];
  SP.forEach(([x, y], i) => bone(`spark${i + 1}`, 'main', { x: x * Wd, y: y * H }));
  bone('smoke1', 'main', { x: -Wd * 0.3, y: -H * 0.45 }); bone('smoke2', 'main', { x: Wd * 0.3, y: -H * 0.45 });
  bone('flash', 'main'); bone('ring', 'main');
  const world = {};
  for (const b of bones) {
    const r = ((b.rotation || 0) * Math.PI) / 180, l = [Math.cos(r), -Math.sin(r), b.x || 0, Math.sin(r), Math.cos(r), b.y || 0];
    const p = b.parent ? world[b.parent] : [1, 0, 0, 0, 1, 0];
    world[b.name] = [p[0] * l[0] + p[1] * l[3], p[0] * l[1] + p[1] * l[4], p[0] * l[2] + p[1] * l[5] + p[2], p[3] * l[0] + p[4] * l[3], p[3] * l[1] + p[4] * l[4], p[3] * l[2] + p[4] * l[5] + p[5]];
  }
  // body space == world here (main/tilt/base/body have no rotation and base+body cancel out)
  const toLocal = (b, [x, y]) => { const m = world[b]; const d = m[0] * m[4] - m[1] * m[3]; const dx = x - m[2], dy = y - m[5]; return [(m[4] * dx - m[1] * dy) / d, (-m[3] * dx + m[0] * dy) / d]; };
  const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
  function gridMesh(region, centre, size, cols, rows, weights) {
    const [mw, mh] = size, uvs = [], verts = [], tris = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = j / rows;
      uvs.push(R(u), R(v));
      const wp = [centre[0] + (u - 0.5) * mw, centre[1] + (0.5 - v) * mh];
      let ws = weights(wp).filter(([, x]) => x > 0.001);
      const s = ws.reduce((a, [, x]) => a + x, 0);
      ws = ws.map(([b, x]) => [b, x / s]).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const s2 = ws.reduce((a, [, x]) => a + x, 0);
      verts.push(ws.length);
      for (const [b, x] of ws) { const lp = toLocal(b, wp); verts.push(BI[b], R(lp[0]), R(lp[1]), R(x / s2)); }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; tris.push(a, c, b, b, c, d); }
    return { type: 'mesh', path: region, uvs, triangles: tris, vertices: verts, hull: 0, width: R(mw * 2), height: R(mh * 2) };
  }
  const bodyWeights = ([x, y]) => {
    const t = smooth((y - (-H / 2)) / H * 1.25 - 0.15);
    const out = [['body', 1 - t], ['top', t]];
    if (S.meshJaw) { const j = smooth(((0.5 - S.meshJaw) * H - y) / (H * 0.08)); if (j > 0) { out.length = 0; out.push(['top', t * (1 - j)], ['body', (1 - t) * (1 - j)], ['mjaw', j]); } }
    return out;
  };
  const chainWeights = (p) => ([x, y]) => {
    const c = chains[p.n], ax = c.tp[0] - c.pv[0], ay = c.tp[1] - c.pv[1], L2 = ax * ax + ay * ay;
    const t = Math.max(0, Math.min(1, ((x - c.pv[0]) * ax + (y - c.pv[1]) * ay) / L2)) * p.chain;
    const out = [];
    for (let i = 1; i <= p.chain; i++) out.push([`${p.n}${i}`, Math.max(0, 1 - Math.abs(t - (i - 0.5)) * 0.9)]);
    if (t < 0.25) out.push([p.kind === 'hat' || p.kind === 'cork' ? 'top' : 'body', (0.25 - t) * 3]);
    return out;
  };

  // ---- slots
  const slots = [], SN = new Set(), A = {}, ADD = [];
  const slot = (n, b, att, o = {}) => { SN.add(n); slots.push({ name: n, bone: b, ...(att ? { attachment: att } : {}), ...o }); };
  const put = (s, key, v) => ((A[s] ||= {})[key] = v);
  const reg = (wu, hu, o = {}) => ({ width: R(wu), height: R(hu), ...Object.fromEntries(Object.entries(o).map(([a, v]) => [a, typeof v === 'number' ? R(v) : v])) });
  const tintHex = (a) => S.tint.map(hex).join('') + hex(a);
  const withAdd = (name, bn, att, meshOrReg) => { slot(name, bn, att); put(name, att, meshOrReg); slot(`${name}_add`, bn, att, { color: 'ffffff00', blend: 'additive' }); put(`${name}_add`, att, meshOrReg); ADD.push(`${name}_add`); };
  slot('shadow', 'shadow', 'glow', { color: '00000070' }); put('shadow', 'glow', reg(Wd * 0.8, H * 0.15));
  slot('backglow', 'backglow', 'glow', { color: tintHex(high ? 0.32 : 0), blend: 'additive' }); put('backglow', 'glow', reg(Wd * 1.7, H * 1.7));
  slot('rays', 'rays', 'rays', { color: tintHex(0), blend: 'additive' }); put('rays', 'rays', reg(Wd * 1.9, Wd * 1.9));
  const partMesh = (p) => gridMesh(p.n, p.at, p.size, p.kind === 'jaw' || p.kind === 'cork' ? 2 : 8, p.kind === 'jaw' || p.kind === 'cork' ? 2 : 8, chainWeights(p));
  for (const p of parts.filter((p) => p.z === 'back')) withAdd(p.n, `${p.n}1`, p.n, partMesh(p));
  withAdd('body', 'body', 'body', gridMesh('body', bodyP.at, bodyP.size, 10, 10, bodyWeights));
  if (bodyBlink) { const mb = gridMesh('body_blink', bodyP.at, bodyP.size, 10, 10, bodyWeights); put('body', 'body_blink', mb); put('body_add', 'body_blink', mb); }
  starPieces.forEach((s, i) => withAdd(`star_m${i + 1}`, `mstar${i + 1}`, `star_m${i + 1}`, reg(s.size[0], s.size[1])));
  BUB.forEach((i) => { slot(`bub${i + 1}`, `bub${i + 1}`, null, { color: S.bubbles + 'ff' }); put(`bub${i + 1}`, 'dot', reg(Wd * 0.09, Wd * 0.09)); });
  if (blinkPiece) { slot('eyes', 'eyes', null); put('eyes', 'blink', reg(blinkPiece.size[0], blinkPiece.size[1])); }
  for (const p of parts.filter((p) => p.z === 'front')) withAdd(p.n, `${p.n}1`, p.n, partMesh(p));
  (S.glows || []).forEach(([, , r], i) => { slot(`eglow${i + 1}`, `eglow${i + 1}`, 'glow', { color: tintHex(0), blend: 'additive' }); put(`eglow${i + 1}`, 'glow', reg(Wd * r * 1.6, Wd * r * 1.6)); });
  { // shine sweep clipped to the full silhouette
    const top = [], bot = [], N = 28;
    for (let i = 0; i <= N; i++) {
      const x = Math.min(w - 1, Math.round((w - 1) * (i / N)));
      let y0 = -1, y1 = -1;
      for (let y = 0; y < h; y++) if (bodyImg.px[(y * w + x) * 4 + 3] > 200) { if (y0 < 0) y0 = y; y1 = y; }
      if (y0 < 0) continue;
      top.push(U(x / w, (y0 + 3) / h)); bot.push(U(x / w, (y1 - 3) / h));
    }
    const poly = [...top, ...bot.reverse()];
    slot('clip', 'body', 'clip'); put('clip', 'clip', { type: 'clipping', end: 'shine', vertexCount: poly.length, vertices: poly.flat().map(R) });
    slot('shine', 'shine', 'shine', { color: 'ffffff00', blend: 'additive' }); put('shine', 'shine', reg(Wd * 0.35, H * 1.6, { rotation: -20 }));
  }
  SP.forEach((_, i) => { slot(`spark${i + 1}`, `spark${i + 1}`, 'star', { color: 'ffffff00' }); put(`spark${i + 1}`, 'star', reg(26 + (i % 3) * 6, 26 + (i % 3) * 6)); });
  for (const s of ['smoke1', 'smoke2']) { slot(s, s, null); put(s, 'smoke', reg(60, 54)); }
  slot('ring', 'ring', null, { blend: 'additive' }); put('ring', 'ring', reg(Wd * 1.3, Wd * 1.3));
  slot('flash', 'flash', null, { blend: 'additive' }); put('flash', 'flash', reg(Wd * 1.4, Wd * 1.4));

  // ---- physics on chain tips (secondary motion), like the scatter's hat / stem
  const physics = [];
  for (const p of parts.filter((p) => p.phys)) for (let i = 1; i <= p.chain; i++) physics.push({ name: `ph_${p.n}${i}`, bone: `${p.n}${i}`, rotate: 1, inertia: 0.5 + i * 0.1, strength: 170 - i * 30, damping: 0.85, mass: 1.2 + i * 0.2 });
  physics.push({ name: 'ph_top', bone: 'top', x: 0.6, y: 1, inertia: 0.5, strength: 200, damping: 0.8 });
  const PH = physics.map((p) => p.name);

  // ---- animations
  const WHITE = [1, 1, 1];
  const A_ = () => new Anim(BN, SN, PH);
  const loopK = (D, vals, cyc = 1) => { const n = vals.length, out = []; for (let c = 0; c < cyc; c++) vals.forEach((v, j) => out.push([(c * n + j) * (D / (n * cyc)), ...(Array.isArray(v) ? v : [v]), 'sine'])); out.push([D, ...(Array.isArray(vals[0]) ? vals[0] : [vals[0]])]); return out; };
  const flashAll = (a, keys) => ADD.forEach((n) => a.alpha(n, WHITE, keys));
  const sparks = (a, t0, step, d = 0.5) => SP.forEach((_, i) => { const t = t0 + i * step, sn = `spark${i + 1}`; a.alpha(sn, WHITE, [[0, 0], [t, 0, 'outQuad'], [t + d * 0.35, 1, 'inQuad'], [t + d, 0]]); a.scale(sn, [[0, 0.2, 0.2], [t, 0.2, 0.2, 'outBack'], [t + d * 0.35, 1.2, 1.2, 'inQuad'], [t + d, 0.3, 0.3]]); a.rot(sn, [[0, 0], [t, 0], [t + d, 60]]); });
  const puff = (a, s, t0, dx, d = 0.55, peak = 0.75) => { a.show(s, [[0, null], [t0, 'smoke'], [t0 + d, null]]); a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + d, dx, 10]]); a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outCubic'], [t0 + d, 1.25, 1]]); a.alpha(s, WHITE, [[0, 0], [t0, peak, 'in'], [t0 + d, 0]]); };
  const shine = () => {}; // light sweep removed (client feedback)
  const blinkAt = (a, ts) => { if (!bodyBlink) return; const kk = [[0, 'body']]; for (const t of ts) kk.push([t, 'body_blink'], [t + 0.13, 'body']); a.show('body', kk); a.show('body_add', kk); };
  const eyeGlow = (a, keys) => (S.glows || []).forEach((_, i) => a.alpha(`eglow${i + 1}`, S.tint, keys));
  const bubbles = (a, D, speed = 1) => BUB.forEach((i) => {
    const t0 = ((i * 0.37) % 1) * D * 0.8, d = 0.9 / speed, rise = H * (S.id === 'cauldron' ? 0.55 : 0.28);
    const kk = [[0, null]]; for (let t = t0; t + d <= D + 1e-6; t += d * 1.4) kk.push([t, 'dot'], [t + d, null]);
    a.show(`bub${i + 1}`, kk);
    const mv = [[0, 0, 0]], sc = [[0, 0.2, 0.2]];
    for (let t = t0; t + d <= D + 1e-6; t += d * 1.4) { mv.push([t, 0, 0, 'out'], [t + d, (i % 2 ? 4 : -4), rise, 'stepped']); sc.push([t, 0.2, 0.2, 'outBack'], [t + d * 0.3, 1, 1], [t + d * 0.85, 1.15, 1.15, 'outQuad'], [t + d, 1.8, 1.8, 'stepped']); }
    a.move(`bub${i + 1}`, mv); a.scale(`bub${i + 1}`, sc);
  });
  // part life: amp scales motion, cyc cycles per D
  function partsLife(a, D, amp, cyc = 1) {
    for (const p of parts) {
      const d = p.dir || 1;
      if (p.kind === 'wing') { a.rot(`${p.n}1`, loopK(D, [0, 24 * amp * d, 0, -8 * amp * d], cyc * 2)); a.scale(`${p.n}1`, loopK(D, [[1, 1], [0.86, 1], [1, 1], [1.03, 1]], cyc * 2)); }
      if (p.kind === 'tail') { a.rot(`${p.n}1`, loopK(D, [0, 10 * amp, 0, -7 * amp], cyc)); a.rot(`${p.n}2`, loopK(D, [0, 8 * amp, 0, -8 * amp], cyc)); }
      if (p.kind === 'wrap') { const am = Math.min(amp, 1.3); a.rot(`${p.n}1`, loopK(D, [0, 8 * am * d, 0, -5 * am * d], cyc)); a.scale(`${p.n}1`, loopK(D, [[1, 1], [1.04, 0.96], [1, 1], [0.97, 1.03]], cyc)); }
      if (p.kind === 'hat') { a.rot(`${p.n}1`, loopK(D, [0, 3 * amp, 0, -3 * amp], cyc)); a.rot(`${p.n}2`, loopK(D, [0, 6 * amp, 0, -5 * amp], cyc)); }
      if (p.kind === 'jaw') a.move(`${p.n}1`, loopK(D, [[0, 0], [-1.5 * amp, 0], [0, 0], [-0.6 * amp, 0]], cyc)); // along the bone (points down)
      if (p.kind === 'cork') { a.move(`${p.n}1`, loopK(D, [[0, 0], [1.5 * amp, 0], [0, 0], [0.4 * amp, 0]], cyc)); a.rot(`${p.n}1`, loopK(D, [0, 4 * amp, 0, -4 * amp], cyc)); }
    }
  }
  const anims = {};
  { // INTRO: drops into place, squash, top lags (jelly), parts whip and settle by physics
    const a = A_();
    a.move('main', [[0, 0, H * 0.85, 'inQuad'], [0.22, 0, 0, 'outQuad'], [0.33, 0, H * 0.06, 'inQuad'], [0.43, 0, 0]]);
    a.scale('main', [[0, 0.55, 0.55, 'outBack'], [0.22, 1, 1]]);
    a.alpha('body', WHITE, [[0, 0], [0.07, 1]]); for (const p of parts) a.alpha(p.n, WHITE, [[0, 0], [0.07, 1]]); starPieces.forEach((_, i) => a.alpha(`star_m${i + 1}`, WHITE, [[0, 0], [0.07, 1]]));
    a.scale('base', [[0, 0.86, 1.16, 'inQuad'], [0.22, 1.2, 0.82, 'outQuad'], [0.34, 0.95, 1.06, 'inOut'], [0.46, 1.03, 0.97, 'inOut'], [0.58, 1, 1]]);
    a.move('top', [[0, 0, 0], [0.22, 0, 0, 'outQuad'], [0.3, 0, -H * 0.06, 'inOut'], [0.42, 0, H * 0.03, 'inOut'], [0.54, 0, 0]]);
    for (const p of parts) {
      if (p.kind === 'cork') a.move(`${p.n}1`, [[0, 0, 0], [0.22, 0, 0, 'outQuad'], [0.3, 12, 0, 'inQuad'], [0.4, 0, 0]]);
      if (p.kind === 'jaw') a.move(`${p.n}1`, [[0, 0, 0], [0.22, 0, 0, 'outQuad'], [0.3, 6, 0, 'inOut'], [0.44, 0, 0]]);
    }
    flashAll(a, [[0, 0.85], [0.22, 0.55, 'out'], [0.5, 0]]);
    a.alpha('backglow', S.tint, [[0, 0], [0.18, 0.8, 'out'], [0.6, high ? 0.32 : 0]]);
    a.show('ring', [[0, null], [0.22, 'ring'], [0.6, null]]); a.alpha('ring', S.tint, [[0, 0], [0.22, 0.6, 'in'], [0.6, 0]]); a.scale('ring', [[0, 0.3, 0.3], [0.22, 0.3, 0.3, 'outCubic'], [0.6, 1.3, 1.3]]);
    puff(a, 'smoke1', 0.2, -22); puff(a, 'smoke2', 0.2, 22);
    a.alpha('shadow', [0, 0, 0], [[0, 0], [0.22, 0.44]]); a.scale('shadow', [[0, 0.3, 0.3], [0.22, 1.1, 1, 'outQuad'], [0.4, 1, 1]]);
    eyeGlow(a, [[0, 0], [0.25, 0, 'outExpo'], [0.32, 0.9, 'out'], [0.7, 0.35]]);
    a.reset(0); a.ev(0.22, 'land');
    anims.intro = a;
  }
  { // IDLE: breathing jelly, top sways, parts alive, blinks, bubbles, glows, shine
    const D = 3.2, a = A_();
    a.scale('base', loopK(D, [[1, 1], [1.025, 0.975], [1, 1], [1.02, 0.98]], 1));
    a.move('top', loopK(D, [[0, 0], [1.2, 1.5], [0, 0], [-1.2, 1]], 1));
    a.rot('top', loopK(D, [0, 2, 0, -2], 1));
    a.scale('shadow', loopK(D, [[1, 1], [0.95, 1], [1, 1], [0.97, 1]], 1));
    partsLife(a, D, 1, 2);
    if (S.meshJaw) a.move('mjaw', loopK(D, [[0, 0], [0, -2.5], [0, 0], [0, -1]], 2));
    if (S.ball) a.rot('body', loopK(D, [0, 4, 0, -4], 1));
    blinkAt(a, [1.4, 2.95]);
    shine(a, 2.0, 0.6, high ? 0.55 : 0.4);
    if (high) a.alpha('backglow', S.tint, loopK(D, [0.28, 0.45, 0.28, 0.4], 1));
    eyeGlow(a, loopK(D, [0.35, 0.7, 0.4, 0.75], 2));
    starPieces.forEach((_, i) => { const t = 0.4 + i * 0.9; a.scale(`mstar${i + 1}`, [[0, 1, 1], [t, 1, 1, 'outBack'], [t + 0.25, 1.35, 1.35, 'inOut'], [t + 0.5, 1, 1]]); a.rot(`mstar${i + 1}`, [[0, 0], [t, 0, 'inOut'], [t + 0.5, 72]]); });
    bubbles(a, D, 1);
    anims.idle = a;
  }
  { // CONNEXION: anticipation squash, pop, 3D turn, white flash, rays/sparks, parts go wild, settle
    const D = high ? 1.9 : 1.45, a = A_();
    a.scale('main', [[0, 1, 1, 'outQuad'], [0.1, 0.92, 0.92, 'outBack'], [0.28, 1.22, 1.22, 'inOut'], [D * 0.6, 1.12, 1.12, 'inOut'], [D, 1, 1]]);
    a.scale('base', [[0, 1, 1, 'outQuad'], [0.1, 1.12, 0.88, 'outQuad'], [0.24, 0.9, 1.12, 'inOut'], [0.38, 1.04, 0.96, 'inOut'], [0.52, 1, 1]]);
    a.move('top', [[0, 0, 0], [0.1, 0, -H * 0.04, 'outQuad'], [0.24, 0, H * 0.06, 'inOut'], [0.4, 0, -H * 0.02, 'inOut'], [0.55, 0, 0]]);
    a.rot('tilt', [[0, 0], [0.3, 0, 'inOut'], [0.42, 5, 'inOut'], [0.54, -4, 'inOut'], [0.66, 0]]); // little wiggle (no 3D flip)
    a.rot('body', [[0, 0], [0.58, 0, 'inOut'], [0.72, -6, 'inOut'], [0.86, 6, 'inOut'], [1.0, -3, 'inOut'], [1.14, 0]]);
    partsLife(a, D, high ? 2.4 : 2, high ? 3 : 2);
    if (S.meshJaw) a.move('mjaw', [[0, 0, 0], [0.24, 0, -9, 'inOut'], [0.36, 0, -2, 'inOut'], [0.48, 0, -9, 'inOut'], [0.6, 0, -2, 'inOut'], [0.72, 0, -9, 'inOut'], [0.95, 0, 0]]);
    for (const p of parts) {
      if (p.kind === 'cork') a.move(`${p.n}1`, [[0, 0, 0], [0.24, 0, 0, 'outQuad'], [0.42, 34, 0, 'inQuad'], [0.62, 0, 0, 'outQuad'], [0.7, 6, 0, 'inQuad'], [0.78, 0, 0]]);
      if (p.kind === 'jaw') a.move(`${p.n}1`, [[0, 0, 0], [0.24, 12, 0, 'inOut'], [0.36, 2, 0, 'inOut'], [0.48, 12, 0, 'inOut'], [0.6, 2, 0, 'inOut'], [0.72, 12, 0, 'inOut'], [0.95, 0, 0]]);
      if (p.kind === 'hat') a.move(`${p.n}1`, [[0, 0, 0], [0.24, 0, 0, 'outQuad'], [0.4, 0, 0, 'inOut'], [0.6, 0, 0]]);
    }
    blinkAt(a, [0.1]);
    flashAll(a, [[0, 0], [0.26, 1, 'out'], [0.5, 0.2, 'sine'], [0.7, 0.55, 'sine'], [D, 0]]);
    a.alpha('backglow', S.tint, [[0, high ? 0.32 : 0], [0.26, 1, 'out'], [D, high ? 0.32 : 0]]); a.scale('backglow', [[0, 1, 1, 'outBack'], [0.3, 1.25, 1.25, 'inOut'], [D, 1, 1]]);
    a.alpha('rays', S.tint, [[0, 0], [0.26, 0.6, 'sine'], [D * 0.7, 0.35, 'out'], [D, 0]]); a.rot('rays', [[0, 0], [D, -70]]);
    a.show('flash', [[0, null], [0.26, 'flash'], [0.6, null]]); a.alpha('flash', WHITE, [[0, 0], [0.26, 0.85, 'out'], [0.6, 0]]); a.scale('flash', [[0, 0.5, 0.5], [0.26, 0.6, 0.6, 'outCubic'], [0.6, 1.6, 1.6]]);
    a.show('ring', [[0, null], [0.28, 'ring'], [0.75, null]]); a.alpha('ring', S.tint, [[0, 0], [0.28, 0.55, 'in'], [0.75, 0]]); a.scale('ring', [[0, 0.3, 0.3], [0.28, 0.3, 0.3, 'outCubic'], [0.75, 1.6, 1.6]]);
    shine(a, 0.45, 0.5, 1);
    sparks(a, 0.28, high ? 0.11 : 0.08, 0.55);
    eyeGlow(a, [[0, 0.35], [0.26, 1, 'out'], [D, 0.35]]);
    starPieces.forEach((_, i) => { const t = 0.3 + i * 0.12; a.scale(`mstar${i + 1}`, [[0, 1, 1], [t, 1, 1, 'outBack'], [t + 0.25, 1.6, 1.6, 'inOut'], [t + 0.55, 1, 1]]); a.rot(`mstar${i + 1}`, [[0, 0], [t, 0, 'inOut'], [t + 0.55, 144]]); });
    bubbles(a, D, 2);
    a.ev(0.26, 'connect');
    anims.connexion = a;
  }
  { // OUTRO: anticipation, spin-out shrink, flash + smoke
    const a = A_();
    a.scale('base', [[0, 1, 1, 'outQuad'], [0.1, 1.12, 0.88, 'outQuad'], [0.2, 0.95, 1.06]]);
    a.scale('main', [[0, 1, 1], [0.12, 1, 1, 'outQuad'], [0.2, 1.15, 1.15, 'inBack'], [0.48, 0, 0]]);
    a.rot('main', [[0, 0], [0.2, 0, 'in'], [0.48, high ? -50 : 40]]);
    flashAll(a, [[0, 0], [0.2, 0.8, 'in'], [0.48, 0]]);
    a.alpha('shadow', [0, 0, 0], [[0, 0.44], [0.45, 0]]);
    a.show('flash', [[0, null], [0.36, 'flash'], [0.66, null]]); a.alpha('flash', WHITE, [[0, 0], [0.36, 0.8, 'out'], [0.66, 0]]); a.scale('flash', [[0, 0.3, 0.3], [0.36, 0.3, 0.3, 'outCubic'], [0.66, 1.3, 1.3]]);
    puff(a, 'smoke1', 0.34, -42, 0.45, 0.85); puff(a, 'smoke2', 0.34, 42, 0.45, 0.85);
    sparks(a, 0.34, 0.03, 0.35);
    a.ev(0.4, 'pop');
    anims.outro = a;
  }

  const skel = {
    skeleton: { hash: '', spine: '4.2.43', x: R(-Wd), y: R(-H), width: R(Wd * 2), height: R(H * 2), images: './images/', audio: '' },
    bones, slots, physics, skins: [{ name: 'default', attachments: A }],
    events: { land: {}, connect: {}, pop: {} },
    animations: Object.fromEntries(Object.entries(anims).map(([n, v]) => [n, v.json()])),
  };
  skel.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skel)).digest('base64').slice(0, 11);
  fs.writeFileSync(`${OUT}/${S.id}.json`, JSON.stringify(skel));
  fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
    id: `creations/halloween-v2/${S.id}`, package: S.id, name: S.id, game: 'Halloween V2', game_slug: 'halloween-v2',
    format: 'spine', skeleton_format: 'json', skeleton_file: `${S.id}.json`, skeleton_version: '4.2.43', category: 'symbol',
    subtypes: [high ? 'high_pay' : 'low_pay', 'entrance', 'idle', 'win', 'exit'], tier: S.tier,
    animations: Object.keys(anims), events: Object.keys(skel.events), bones_count: bones.length, slots_count: slots.length, physics_constraints: physics.length,
    parts: parts.map((p) => p.n), skins: ['default'],
    atlases: [{ file: `${S.id}.atlas`, pages: [`${S.id}.png`] }], textures: [{ file: `${S.id}.png`, page: `${S.id}.png`, width: page.w, height: page.h, pma: false }],
    complete: true, warnings: [], source_image: `symbols/source/${S.id}.png`,
  }, null, 1));
  return `${S.id}: ${bones.length} os, ${slots.length} slots, ${physics.length} physiques, pièces [${parts.map((p) => p.n).join(', ')}]${blinkPiece ? ' + clignement' : ''}${starPieces.length ? ` + ${starPieces.length} étoiles` : ''}`;
}

const only = process.argv[2];
for (const S of SYMBOLS) if (!only || S.id === only) console.log(await build(S));
