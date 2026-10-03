// Removes the dark UNDERSIDE of the hat brim, so the pumpkin shows through and looks like it is inside the hat.
// Per column of the brim zone: walk up from the bottom while pixels are dark (underside + outline),
// erase them, then redraw a thin outline under the light top surface of the brim.
import fs from 'node:fs';
import { load, toPng } from '../../tools/imagekit.js';
const img = await load('parts/hat.png');
const { w, h, px } = img;
const lum = (i) => 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
const OUTLINE = [42, 20, 58];
let erased = 0;
for (let x = 0; x < w; x++) {
  let y = h - 1;
  while (y > 0 && px[(y * w + x) * 4 + 3] < 40) y--;
  if (y < h * 0.55) continue; // not the brim (cone / tip)
  const bottom = y;
  // dark run = underside (+ its outline): stop at the first light purple pixel of the top surface
  let top = bottom;
  while (top > h * 0.5 && px[(top * w + x) * 4 + 3] > 40 && lum(top * w + x) < 78) top--;
  const run = bottom - top;
  if (run < 6 || run > h * 0.3) continue;
  for (let yy = top + 5; yy <= bottom; yy++) { px[(yy * w + x) * 4 + 3] = 0; erased++; }
  for (let yy = top + 1; yy <= top + 4; yy++) { const i = (yy * w + x) * 4; px.set([...OUTLINE, 255], i); }
}
fs.writeFileSync('parts/hat.png', await toPng(img));
console.log('erased pixels:', erased);
