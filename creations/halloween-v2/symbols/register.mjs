import fs from 'node:fs';
import sharp from 'sharp';
import { load, toPng, alphaBox } from '../../tools/imagekit.js';
export async function register(srcFile, partFile, { region = null } = {}) {
  const src = await load(srcFile), part = await load(partFile);
  const { w, h } = src;
  const pb = alphaBox(part, 100);
  const step = 2;
  const pts = [];
  for (let y = pb.y; y < pb.y + pb.h; y += step) for (let x = pb.x; x < pb.x + pb.w; x += step) if (part.px[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
  // target = source pixels inside the region where this part lives
  const tgt = new Uint8Array(w * h); let tgtN = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (src.px[(y * w + x) * 4 + 3] > 128 && (!region || region(x / w, y / h))) { tgt[y * w + x] = 1; tgtN++; }
  const cx = pb.x + pb.w / 2, cy = pb.y + pb.h / 2;
  let best = { score: -1e9 };
  const search = (s0, s1, ss, d, ds, base) => {
    for (let s = s0; s <= s1 + 1e-9; s += ss) for (let dy = -d; dy <= d; dy += ds) for (let dx = -d; dx <= d; dx += ds) {
      const tx = base.tx + dx, ty = base.ty + dy;
      const seen = new Set(); let inter = 0;
      for (const [x, y] of pts) {
        let X = Math.round(cx + (x - cx) * s + tx), Y = Math.round(cy + (y - cy) * s + ty);
        X -= X % step; Y -= Y % step;
        const key = Y * w + X; if (seen.has(key)) continue; seen.add(key);
        if (X >= 0 && Y >= 0 && X < w && Y < h && tgt[key]) inter++;
      }
      const sc = inter / (seen.size + tgtN - inter);
      if (sc > best.score) best = { score: sc, s, tx, ty };
    }
  };
  search(0.5, 1.4, 0.05, 80, 8, { tx: 0, ty: 0 });
  const b1 = { ...best };
  search(b1.s - 0.05, b1.s + 0.05, 0.01, 10, 2, b1);
  const { s, tx, ty } = best;
  const out = { w, h, px: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.round(cx + (x - cx - tx) / s), sy = Math.round(cy + (y - cy - ty) / s);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    out.px.set(part.px.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
  }
  fs.writeFileSync(partFile, await toPng(out));
  return best;
}
if (process.argv[1].endsWith('register.mjs') && process.argv[2] === 'bat') {
  const R = { body: (u) => u > 0.27 && u < 0.73, wl: (u, v) => u < 0.4 && v > 0.22, wr: (u, v) => u > 0.6 && v > 0.22 };
  for (const [f, r] of [['bat_body', R.body], ['bat_bodyblink', R.body], ['bat_wing_l', R.wl], ['bat_wing_r', R.wr]]) console.log(f, await register('source/bat.png', `source/parts3k/${f}.png`, { region: r }));
}
