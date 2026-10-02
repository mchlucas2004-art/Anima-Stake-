// Image helpers for building Spine assets from AI-generated pictures (sharp + raw RGBA buffers).
import sharp from 'sharp';

export async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export const toPng = (img) => sharp(Buffer.from(img.px.buffer, img.px.byteOffset, img.px.length), { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();

/**
 * Chroma-key on pure green. alpha from "greenness" (g - max(r,b)), then despill,
 * then keep only the connected opaque regions that are big enough (removes faint ghosts/noise).
 */
export function chromaKey(img, { lo = 45, hi = 115, minArea = 400 } = {}) {
  const { w, h, px } = img;
  const n = w * h;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const k = g - Math.max(r, b);
    a[i] = k <= lo ? 1 : k >= hi ? 0 : 1 - (k - lo) / (hi - lo);
    // despill: green cannot exceed the other channels on the object's edges
    // full despill: the objects never contain green, so green can never exceed the other channels
    const m = Math.max(r, b);
    if (g > m) px[i * 4 + 1] = m;
  }
  // connected components on solid pixels; small islands are dropped
  const label = new Int32Array(n).fill(-1);
  const keep = new Uint8Array(n);
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || a[s] < 0.5) continue;
    const members = [];
    stack.push(s);
    label[s] = s;
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && label[q] === -1 && a[q] >= 0.5) { label[q] = s; stack.push(q); }
      }
    }
    if (members.length >= minArea) for (const p of members) keep[p] = 1;
  }
  // soft edge pixels survive only next to kept solid pixels
  for (let i = 0; i < n; i++) {
    if (keep[i]) continue;
    if (a[i] >= 0.5) { a[i] = 0; continue; }
    const x = i % w, y = (i / w) | 0;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && keep[yy * w + xx]) near = true;
    }
    if (!near) a[i] = 0;
  }
  for (let i = 0; i < n; i++) px[i * 4 + 3] = Math.round(a[i] * 255);
  return img;
}

/** Bounding boxes of separate objects (for sprite sheets), sorted top-to-bottom, left-to-right. */
export function components(img, { minArea = 2000, gap = 12 } = {}) {
  const { w, h, px } = img;
  // coarse grid labelling (merges pieces closer than `gap` pixels)
  const cw = Math.ceil(w / gap), ch = Math.ceil(h / gap);
  const occ = new Uint8Array(cw * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) occ[((y / gap) | 0) * cw + ((x / gap) | 0)] = 1;
  const lab = new Int32Array(cw * ch).fill(-1);
  const boxes = [];
  for (let s = 0; s < cw * ch; s++) {
    if (!occ[s] || lab[s] !== -1) continue;
    const st = [s];
    lab[s] = boxes.length;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0;
    while (st.length) {
      const p = st.pop();
      const x = p % cw, y = (p / cw) | 0;
      cnt++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        const q = yy * cw + xx;
        if (occ[q] && lab[q] === -1) { lab[q] = lab[s]; st.push(q); }
      }
    }
    if (cnt * gap * gap >= minArea) boxes.push({ x: x0 * gap, y: y0 * gap, w: Math.min(w, (x1 + 1) * gap) - x0 * gap, h: Math.min(h, (y1 + 1) * gap) - y0 * gap });
  }
  return boxes.sort((a, b) => (Math.abs(a.y - b.y) > 150 ? a.y - b.y : a.x - b.x));
}

/** Tight bbox of alpha > t. */
export function alphaBox(img, t = 8, area = null) {
  const { w, px } = img;
  const ax = area || { x: 0, y: 0, w: img.w, h: img.h };
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = ax.y; y < ax.y + ax.h; y++) for (let x = ax.x; x < ax.x + ax.w; x++) {
    if (px[(y * w + x) * 4 + 3] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function crop(img, box, pad = 2) {
  const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(img.w, box.x + box.w + pad), y1 = Math.min(img.h, box.y + box.h + pad);
  const w = x1 - x0, h = y1 - y0;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) px.set(img.px.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4), y * w * 4);
  return { w, h, px, x0, y0 };
}

export async function resize(img, w, h) {
  const { data, info } = await sharp(Buffer.from(img.px.buffer, img.px.byteOffset, img.px.length), { raw: { width: img.w, height: img.h, channels: 4 } })
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Procedural white textures, tinted later by slot colours. */
export function procedural(kind, size) {
  const w = size, h = size;
  const px = new Uint8ClampedArray(w * h * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const r = Math.hypot(dx, dy);
    let a = 0;
    if (kind === 'glow') a = Math.max(0, 1 - r) ** 2.2;
    else if (kind === 'flash') a = Math.max(0, 1 - r) ** 1.4 + (r < 0.18 ? (0.18 - r) * 3 : 0);
    else if (kind === 'ring') a = Math.max(0, 1 - Math.abs(r - 0.82) / 0.1) ** 1.5 * (r < 1 ? 1 : 0) + Math.max(0, 1 - Math.abs(r - 0.82) / 0.35) ** 3 * 0.35;
    else if (kind === 'dot') a = Math.max(0, 1 - r) ** 3;
    else if (kind === 'rays') {
      const ang = Math.atan2(dy, dx);
      const spokes = 0.5 + 0.5 * Math.cos(ang * 12);
      a = spokes ** 6 * Math.max(0, 1 - r) ** 0.9 * Math.min(1, r * 4);
    } else if (kind === 'shine') {
      const band = Math.max(0, 1 - Math.abs(dx) / 0.45);
      a = band ** 2 * (1 - Math.abs(dy) ** 8);
    }
    a = Math.min(1, a);
    const i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = Math.round(a * 255);
  }
  return { w, h, px };
}

/** Additive "light" layer = what the candle adds: max(lit - unlit, 0), with alpha = brightness. */
export function lightLayer(lit, unlit, { threshold = 18 } = {}) {
  const { w, h } = lit;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const dr = Math.max(0, lit.px[i * 4] - unlit.px[i * 4]);
    const dg = Math.min(Math.max(0, lit.px[i * 4 + 1] - unlit.px[i * 4 + 1]), Math.max(0, lit.px[i * 4] - unlit.px[i * 4])); // candle light is warm: never greener than red
    const db = Math.max(0, lit.px[i * 4 + 2] - unlit.px[i * 4 + 2]);
    const m = Math.max(dr, dg, db);
    const inside = Math.min(lit.px[i * 4 + 3], unlit.px[i * 4 + 3]) / 255;
    if (m < threshold || inside < 0.5) continue;
    // additive blending: colour carries the light, store it at full alpha
    px[i * 4] = dr; px[i * 4 + 1] = dg; px[i * 4 + 2] = db; px[i * 4 + 3] = 255;
  }
  return { w, h, px };
}

/** Simple MaxRects-ish shelf packer. items: [{name, img}] -> {pages:[{w,h,rects}]} */
export function pack(items, { maxSize = 2048, padding = 4 } = {}) {
  const sorted = [...items].sort((a, b) => b.img.h - a.img.h || b.img.w - a.img.w);
  const pages = [];
  let page = null;
  const newPage = () => { page = { w: maxSize, h: maxSize, rects: [], shelves: [] }; pages.push(page); };
  newPage();
  for (const it of sorted) {
    const w = it.img.w + padding, h = it.img.h + padding;
    let placed = false;
    for (const sh of page.shelves) {
      if (h <= sh.h && sh.x + w <= page.w) { page.rects.push({ ...it, x: sh.x, y: sh.y }); sh.x += w; placed = true; break; }
    }
    if (!placed) {
      const y = page.shelves.reduce((m, s) => Math.max(m, s.y + s.h), 0);
      if (y + h > page.h) { newPage(); }
      const yy = page.shelves.reduce((m, s) => Math.max(m, s.y + s.h), 0);
      page.shelves.push({ x: w, y: yy, h });
      page.rects.push({ ...it, x: 0, y: yy });
    }
  }
  for (const p of pages) {
    const used = p.rects.reduce((m, r) => Math.max(m, r.y + r.img.h), 0);
    p.h = 2 ** Math.ceil(Math.log2(Math.max(64, used)));
  }
  return pages;
}

export async function composePage(page) {
  const base = sharp({ create: { width: page.w, height: page.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const layers = await Promise.all(page.rects.map(async (r) => ({ input: await toPng(r.img), left: r.x, top: r.y })));
  return base.composite(layers).png().toBuffer();
}

/** Keeps only the largest connected blob (alpha > t) of an image; everything else becomes transparent. */
export function largestBlob(img, t = 20) {
  const { w, h, px } = img;
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0;
  for (let s = 0; s < w * h; s++) {
    if (lab[s] !== -1 || px[s * 4 + 3] <= t) continue;
    const st = [s]; lab[s] = s; let n = 0;
    while (st.length) {
      const p = st.pop(); n++;
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && lab[q] === -1 && px[q * 4 + 3] > t) { lab[q] = s; st.push(q); }
    }
    if (n > bestN) { bestN = n; best = s; }
  }
  for (let i = 0; i < w * h; i++) {
    if (lab[i] === best) continue;
    // keep the soft fringe touching the blob
    const x = i % w, y = (i / w) | 0;
    let near = false;
    if (lab[i] === -1) for (const q of [i - 1, i + 1, i - w, i + w]) if (q >= 0 && q < w * h && lab[q] === best && Math.abs((q % w) - x) <= 1) near = true;
    if (!near) px[i * 4 + 3] = 0;
  }
  return img;
}
