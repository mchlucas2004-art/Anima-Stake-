// Removes the dark underside of the brim (keeps the outline under the top surface) so the pumpkin looks inside the hat.
import { load, toPng } from '../../tools/imagekit.js';
import fs from 'node:fs';
const img = await load('parts/hat_full.png');
const { w, h, px } = img;
const KEEP = Math.round(w * 0.006); // outline thickness to keep
const dark = (i) => px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] < 235;
let removed = 0;
const light = (i) => px[i * 4 + 3] >= 40 && px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] >= 290;
for (let x = 0; x < w; x++) {
  // lowest clearly-lit pixel of the brim top surface in this column
  let top = -1;
  for (let y = h - 1; y > h * 0.5; y--) if (light(y * w + x) && light((y - 1) * w + x) && light((y - 2) * w + x)) { top = y; break; }
  if (top < 0) continue;
  for (let yy = top + KEEP + 1; yy < h; yy++) { if (px[(yy * w + x) * 4 + 3]) removed++; px[(yy * w + x) * 4 + 3] = 0; }
}
// thin leftovers (streaks) below the brim
for (let y = Math.floor(h * 0.6); y < h; y++) {
  let x = 0;
  while (x < w) {
    if (px[(y * w + x) * 4 + 3] < 40) { x++; continue; }
    let e = x; while (e < w && px[(y * w + e) * 4 + 3] >= 40) e++;
    if (e - x < 30) for (let k = x; k < e; k++) px[(y * w + k) * 4 + 3] = 0;
    x = e;
  }
}
// brim tips: remove the curled "return" at both ends (dark hook beyond / under the lit top surface)
{
  const lit1 = (i) => px[i * 4 + 3] >= 40 && px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] >= 290;
  let xl = w, xr = -1;
  for (let x = 0; x < w; x++) for (let y = Math.floor(h * 0.5); y < h; y++) if (lit1(y * w + x)) { if (x < xl) xl = x; if (x > xr) xr = x; break; }
  for (let x = 0; x < w; x++) {
    const outer = x < xl + w * 0.12 || x > xr - w * 0.12;
    if (!outer) continue;
    let low = -1; // lowest lit pixel in this column (lower half)
    for (let y = h - 1; y > h * 0.5; y--) if (lit1(y * w + x)) { low = y; break; }
    for (let y = Math.floor(h * 0.5); y < h; y++) {
      const i = y * w + x;
      if (low < 0 || y > low + KEEP) px[i * 4 + 3] = 0;
    }
  }
}
fs.writeFileSync('parts/hat.png', await toPng(img));
console.log('removed px', removed);
