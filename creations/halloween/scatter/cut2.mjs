// V2 cutting: separated pumpkin parts (body, stem, face features + expressions + light), plaque layers
// (board / slime / letters), fx sheet. Everything aligned on the HD pumpkin / original plaque frames.
import fs from 'node:fs';
import { load, chromaKey, components, alphaBox, crop, toPng, largestBlob } from '../../tools/imagekit.js';
function mainBlob(mask, w, h, box) {
  const img = { w, h, px: new Uint8ClampedArray(w * h * 4) };
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (mask[y * w + x]) img.px[(y * w + x) * 4 + 3] = 255;
  largestBlob(img, 100);
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (img.px[i * 4 + 3] > 100) m[i] = 1;
  return m;
}

const S = (f) => `source/${f}`;
const OUT = 'parts2';
fs.mkdirSync(OUT, { recursive: true });
const meta = { pieces: {} };
async function save(name, img, extra = {}) {
  fs.writeFileSync(`${OUT}/${name}.png`, await toPng(img));
  meta.pieces[name] = { w: img.w, h: img.h, ...extra };
}
const blank = (w, h) => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });

/** Aligns `img` onto `ref` using the left / right / bottom extents (the top may differ: stem). */
function alignTo(img, ref) {
  if (img.w === ref.w && img.h === ref.h) return { img, scale: 1, dx: 0, dy: 0 };
  const a = alphaBox(img, 128), b = alphaBox(ref, 128);
  const s = b.w / a.w;
  const out = blank(ref.w, ref.h);
  const ax = a.x, ay = a.y + a.h, bx = b.x, by = b.y + b.h;
  for (let y = 0; y < ref.h; y++) for (let x = 0; x < ref.w; x++) {
    const sx = Math.round(ax + (x - bx) / s), sy = Math.round(ay + (y - by) / s);
    if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    const i = (y * ref.w + x) * 4, j = (sy * img.w + sx) * 4;
    out.px[i] = img.px[j]; out.px[i + 1] = img.px[j + 1]; out.px[i + 2] = img.px[j + 2]; out.px[i + 3] = img.px[j + 3];
  }
  return { img: out, scale: s, dx: bx - ax * s, dy: by - ay * s };
}
const diff = (A, B, i) => Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]);
function dilate(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && dx * dx + dy * dy <= r * r) out[yy * w + xx] = 1;
    }
  }
  return out;
}
function erode(mask, w, h, r) {
  const inv = mask.map((v) => (v ? 0 : 1));
  return dilate(inv, w, h, r).map((v) => (v ? 0 : 1));
}
/** Copy of `src` keeping only pixels where mask=1 (soft 2px feather at the mask border). */
function masked(src, mask, w, h) {
  const out = blank(w, h);
  const inner = erode(mask, w, h, 2);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    out.px.set(src.px.subarray(i * 4, i * 4 + 4), i * 4);
    if (!inner[i]) out.px[i * 4 + 3] = Math.round(out.px[i * 4 + 3] * 0.55);
  }
  return out;
}
function labelMask(mask, w, h, minArea = 200) {
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) if (mask[i]) img.px[i * 4 + 3] = 255;
  return components(img, { minArea, gap: 4 });
}

// ------------------------------------------------------------------ pumpkin
const lit = chromaKey(await load(S('10_pumpkin_hd.png')), { minArea: 20000 });
const W = lit.w, H = lit.h;
const unlit = alignTo(chromaKey(await load(S('11_pumpkin_hd_unlit.png')), { minArea: 20000 }), lit).img;
const bodyFace = alignTo(chromaKey(await load(S('12_pumpkin_hd_blank.png')), { minArea: 20000 }), lit).img;
const happy = alignTo(chromaKey(await load(S('13_pumpkin_hd_happy.png')), { minArea: 20000 }), lit).img;
const nostem = alignTo(chromaKey(await load(S('19_pumpkin_hd_nostem.png')), { minArea: 20000 }), lit).img;

const A = (img, i) => img.px[i * 4 + 3] > 127;
// stem = what the lit pumpkin has above the stem-less silhouette
const stemMask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (A(lit, i) && !A(nostem, i)) stemMask[i] = 1;
const stemBlob = labelMask(stemMask, W, H, 500).sort((a, b) => b.w * b.h - a.w * a.h)[0];
const stemOnly = new Uint8Array(W * H);
for (let y = stemBlob.y; y < stemBlob.y + stemBlob.h; y++) for (let x = stemBlob.x; x < stemBlob.x + stemBlob.w; x++) if (stemMask[y * W + x]) stemOnly[y * W + x] = 1;
const stemFull = dilate(stemOnly, W, H, 3);
const stemImg = masked(lit, stemFull, W, H);
// body = blank face, cut to the stem-less silhouette
const body = blank(W, H);
for (let i = 0; i < W * H; i++) {
  if (!A(bodyFace, i) && !A(nostem, i)) continue;
  body.px.set(bodyFace.px.subarray(i * 4, i * 4 + 3), i * 4);
  body.px[i * 4 + 3] = Math.min(bodyFace.px[i * 4 + 3], nostem.px[i * 4 + 3]);
}
// face = where the lit pumpkin differs from the blank one
const faceRaw = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (A(lit, i) && A(bodyFace, i) && diff(lit, bodyFace, i * 4) > 70) faceRaw[i] = 1;
const faceMask = dilate(erode(faceRaw, W, H, 2), W, H, 9);
const happyRaw = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (A(happy, i) && A(bodyFace, i) && diff(happy, bodyFace, i * 4) > 70) happyRaw[i] = 1;
const happyMask = dilate(erode(happyRaw, W, H, 2), W, H, 9);

const pbox = alphaBox(body, 128); // reference frame for every pumpkin piece: centre of the body
const centre = [pbox.x + pbox.w / 2, pbox.y + pbox.h / 2];
meta.pumpkin = { w: pbox.w, h: pbox.h, centre };
async function savePiece(name, img, box, extra = {}) {
  const c = crop(img, box, 2);
  const cx = c.x0 + c.w / 2, cy = c.y0 + c.h / 2;
  await save(name, c, { cx: cx - centre[0], cy: centre[1] - cy, ...extra }); // offset from body centre, y up (pixels)
}
await savePiece('pumpkin_body', body, pbox);
await savePiece('pumpkin_stem', stemImg, alphaBox(stemImg, 8), { base: [stemBlob.x + stemBlob.w / 2 - centre[0], centre[1] - (stemBlob.y + stemBlob.h)] });

// face features: label each hole, name them by position
function features(mask) {
  const boxes = labelMask(mask, W, H, 800).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 4);
  const named = {};
  const byWidth = [...boxes].sort((a, b) => b.w - a.w);
  named.mouth = byWidth[0];
  const rest = boxes.filter((b) => b !== named.mouth).sort((a, b) => a.y - b.y);
  const eyes = rest.slice(0, 2).sort((a, b) => a.x - b.x);
  [named.eye_l, named.eye_r] = eyes;
  if (rest[2]) named.nose = rest[2];
  return named;
}
const F = features(faceMask);
const FH = features(happyMask);
console.log('face features:', Object.keys(F).join(','), '| happy:', Object.keys(FH).join(','));
for (const [k, b] of Object.entries(F)) {
  const m = mainBlob(faceMask, W, H, b);
  await savePiece(`face_${k}`, masked(unlit, m, W, H), b);
  await savePiece(`face_${k}_lit`, masked(lit, m, W, H), b);
  // additive light: what the candle adds on this feature
  const light = blank(W, H);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = y * W + x;
    if (!m[i]) continue;
    const dr = Math.max(0, lit.px[i * 4] - unlit.px[i * 4]), dg = Math.min(dr, Math.max(0, lit.px[i * 4 + 1] - unlit.px[i * 4 + 1])), db = Math.max(0, lit.px[i * 4 + 2] - unlit.px[i * 4 + 2]);
    if (Math.max(dr, dg, db) < 16) continue;
    light.px.set([dr, dg, db, 255], i * 4);
  }
  await savePiece(`face_${k}_light`, light, b);
}
for (const [k, b] of Object.entries(FH)) {
  const m = mainBlob(happyMask, W, H, b);
  await savePiece(`face_${k}_happy`, masked(happy, m, W, H), b);
}

// ------------------------------------------------------------------ plaque layers
const plaque = chromaKey(await load(S(process.env.PLAQUE || '04_plaque.png')), { minArea: 20000 });
const board = alignTo(chromaKey(await load(S('15_plaque_board.png')), { minArea: 20000 }), plaque).img;
const PW = plaque.w, PH = plaque.h;
// slime = what the plaque has on top of the empty board and is bright purple (the AI "slime only" edit was not aligned)
const slimeMask0 = new Uint8Array(PW * PH);
for (let i = 0; i < PW * PH; i++) {
  if (!A(plaque, i)) continue;
  const r = plaque.px[i * 4], g = plaque.px[i * 4 + 1], b = plaque.px[i * 4 + 2];
  const onBoard = A(board, i);
  const purple = b > 110 && b > g + 35 && r > 70 && r + g + b > 260;
  const brightPurple = purple && b > 150 && r > 105;
  if (brightPurple || ((!onBoard || diff(plaque, board, i * 4) > 60) && purple)) slimeMask0[i] = 1;
  if (!onBoard && !purple) slimeMask0[i] = 1; // slime outline outside the board
}
// keep the slime blobs connected to the top band, close small holes (highlights / outline)
const slimeMask = (() => {
  const closed = erode(dilate(slimeMask0, PW, PH, 4), PW, PH, 4);
  const img = blank(PW, PH);
  for (let i = 0; i < PW * PH; i++) if (closed[i]) img.px[i * 4 + 3] = 255;
  const bx = components(img, { minArea: 5000, gap: 3 });
  const top = Math.min(...bx.map((b) => b.y));
  const keep = new Uint8Array(PW * PH);
  for (const b of bx.filter((b) => b.y < top + 60)) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (closed[y * PW + x]) keep[y * PW + x] = 1;
  return dilate(keep, PW, PH, 2);
})();
const slime = masked(plaque, slimeMask, PW, PH);
const lettersMask = new Uint8Array(PW * PH);
for (let i = 0; i < PW * PH; i++) {
  if (!A(plaque, i) || slimeMask[i] || !A(board, i)) continue;
  const j = i * 4;
  // letters: saturated orange / yellow fill or their thick dark purple outline next to it, and different from the board
  if (diff(plaque, board, j) > 90) lettersMask[i] = 1;
}
const lettersClean = dilate(erode(lettersMask, PW, PH, 2), PW, PH, 3);
const letters = masked(plaque, lettersClean, PW, PH);
const qbox = alphaBox(board, 128);
const qc = [qbox.x + qbox.w / 2, qbox.y + qbox.h / 2];
meta.plaque = { w: qbox.w, h: qbox.h, centre: qc };
// short word (e.g. "FS"): cut a vertical band out of the middle of the board and slime, so the sign fits the word
const NARROW = Number(process.env.NARROW || 0);
function narrow(img) {
  if (!NARROW) return img;
  const cut = Math.round(qbox.w * NARROW), cx = Math.round(qc[0]);
  const x0 = cx - Math.floor(cut / 2), x1 = x0 + cut;
  const out = blank(PW, PH);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    let sx;
    if (x < cx) sx = x - Math.floor(cut / 2) < 0 ? -1 : x - Math.floor(cut / 2); // left part moves right
    else sx = x + Math.ceil(cut / 2) >= PW ? -1 : x + Math.ceil(cut / 2);
    // left part: pixels from [0, x0) shifted by +cut/2 ; right part: pixels from [x1, PW) shifted by -cut/2
    if (x < cx) sx = x - (cx - x0) >= 0 && x - (cx - x0) < x0 ? x - (cx - x0) : -1;
    else sx = x + (x1 - cx) < PW && x + (x1 - cx) >= x1 ? x + (x1 - cx) : -1;
    if (sx < 0) continue;
    out.px.set(img.px.subarray((y * PW + sx) * 4, (y * PW + sx) * 4 + 4), (y * PW + x) * 4);
  }
  return out;
}
const boardN = narrow(board), slimeN = narrow(slime);
const qboxN = alphaBox(boardN, 128);
async function savePlaque(name, img, box, extra = {}) {
  const c = crop(img, box, 2);
  await save(name, c, { cx: c.x0 + c.w / 2 - qc[0], cy: qc[1] - (c.y0 + c.h / 2), ...extra });
}
await savePlaque('plaque_board', boardN, qboxN);
const sbox = alphaBox(slimeN, 40);
// drips: columns where the slime hangs well below the band
const lowest = [];
for (let x = sbox.x; x < sbox.x + sbox.w; x++) {
  let ly = -1;
  for (let y = sbox.y + sbox.h - 1; y >= sbox.y; y--) if (slimeN.px[(y * PW + x) * 4 + 3] > 127) { ly = y; break; }
  lowest.push(ly);
}
const sorted = lowest.filter((v) => v > 0).sort((a, b) => a - b);
const band = sorted[Math.floor(sorted.length * 0.35)];
const drips = [];
let run = null;
lowest.forEach((ly, i) => {
  const x = sbox.x + i;
  if (ly > band + 25) {
    if (!run) run = { x0: x, x1: x, tip: ly };
    run.x1 = x; run.tip = Math.max(run.tip, ly);
  } else if (run) { drips.push(run); run = null; }
});
if (run) drips.push(run);
await savePlaque('plaque_slime', slimeN, sbox, {
  band: qc[1] - band,
  drips: drips.filter((d) => d.x1 - d.x0 > 6).map((d) => ({ x: (d.x0 + d.x1) / 2 - qc[0], tipY: qc[1] - d.tip, w: d.x1 - d.x0 })),
});
// single letters: label the eroded cores, then give every letter pixel to the core column it belongs to
const fill = new Uint8Array(PW * PH);
for (let i = 0; i < PW * PH; i++) { const r = plaque.px[i * 4], b = plaque.px[i * 4 + 2]; if (lettersClean[i] && r > 170 && r - b > 90) fill[i] = 1; }
// letters: label the orange fills (one per letter), then give every letter pixel to the nearest fill (multi-source BFS)
const word = process.env.WORD || 'SCATTER';
const lab = new Int32Array(PW * PH).fill(-1);
const fillImg = blank(PW, PH);
for (let i = 0; i < PW * PH; i++) if (fill[i]) fillImg.px[i * 4 + 3] = 255;
const fillBoxes = components(fillImg, { minArea: 4000, gap: 2 }).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, word.length).sort((a, b) => a.x - b.x);
console.log('letter fills:', fillBoxes.length, '| drips:', drips.length);
let queue = [];
fillBoxes.forEach((b, k) => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = y * PW + x; if (fill[i] && lab[i] < 0) { lab[i] = k; queue.push(i); } }
});
while (queue.length) {
  const next = [];
  for (const i of queue) {
    const x = i % PW;
    for (const j of [x > 0 ? i - 1 : -1, x < PW - 1 ? i + 1 : -1, i - PW, i + PW]) {
      if (j < 0 || j >= PW * PH || lab[j] >= 0 || !lettersClean[j]) continue;
      lab[j] = lab[i]; next.push(j);
    }
  }
  queue = next;
}
for (let k = 0; k < fillBoxes.length; k++) {
  const m = new Uint8Array(PW * PH);
  for (let i = 0; i < PW * PH; i++) if (lab[i] === k) m[i] = 1;
  const img = masked(plaque, m, PW, PH);
  await savePlaque(`letter_${k + 1}_${word[k] || k}`, img, alphaBox(img, 8));
}
void letters;

// ------------------------------------------------------------------ fx sheet 2 (clouds, drops, puddle)
const fx = chromaKey(await load(S('18_fx_sheet.png')), { minArea: 1500 });
const fb = components(fx, { minArea: 3000, gap: 10 });
console.log('fx sheet:', fb.map((b) => `${b.x},${b.y} ${b.w}x${b.h}`).join(' | '));
const fxNames = JSON.parse(process.env.FX_NAMES || '[]');
for (let i = 0; i < fb.length; i++) { const c = largestBlob(crop(fx, fb[i], 2)); await save(fxNames[i] || `fx_${i}`, crop(c, alphaBox(c), 2)); }

fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(Object.entries(meta.pieces).map(([k, v]) => `${k} ${v.w}x${v.h}${v.cx !== undefined ? ` @(${Math.round(v.cx)},${Math.round(v.cy)})` : ''}`).join('\n'));
