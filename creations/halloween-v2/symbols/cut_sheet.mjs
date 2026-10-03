// Cuts the client's 12-icon sheet (light grey background) into transparent PNGs: symbols/source/<id>.png
import fs from 'node:fs';
import { load, toPng, components, alphaBox, crop } from '../../tools/imagekit.js';
const img = await load('source/ref_symbols.png');
const { w, h, px } = img;
const bg = [px[0], px[1], px[2]];
const dist = (i) => Math.abs(px[i * 4] - bg[0]) + Math.abs(px[i * 4 + 1] - bg[1]) + Math.abs(px[i * 4 + 2] - bg[2]);
// flood fill the background from the borders (stops at the dark outlines)
const isBg = new Uint8Array(w * h);
const st = [];
for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
while (st.length) {
  const i = st.pop();
  if (isBg[i] || dist(i) > 60) continue;
  isBg[i] = 1;
  const x = i % w;
  if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (i >= w) st.push(i - w); if (i < w * (h - 1)) st.push(i + w);
}
for (let i = 0; i < w * h; i++) {
  if (isBg[i]) {
    const a = dist(i) < 40 ? 0 : Math.min(1, (dist(i) - 40) / 20);
    px[i * 4 + 3] = Math.round(a * 255);
    // remove the grey background mixed into the anti-aliased edge (un-blend), then darken toward the outline
    if (a > 0) for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, (px[i * 4 + c] - bg[c] * (1 - a)) / a * 0.6));
  }
}
const boxes = components(img, { minArea: 20000, gap: 8 });
const ids = ['candy_orange', 'candy_purple', 'candy_teal', 'candycorn', 'moon', 'bat', 'skull', 'potion', 'cat', 'cauldron', 'ghost', 'pumpkin'];
console.log('pieces:', boxes.length);
boxes.forEach(async (b, k) => {
  const c = crop(img, b, 2);
  fs.writeFileSync(`symbols/source/${ids[k] || 'x' + k}.png`, await toPng(crop(c, alphaBox(c, 20), 3)));
});
