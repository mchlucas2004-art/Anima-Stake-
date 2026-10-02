// Step 1: cut the AI images into clean transparent parts (parts/*.png) + parts.json (sizes)
import fs from 'node:fs';
import { load, chromaKey, components, alphaBox, crop, toPng, lightLayer, largestBlob } from '../../tools/imagekit.js';

const S = (f) => `source/${f}`;
const out = {};
async function save(name, img) {
  fs.writeFileSync(`parts/${name}.png`, await toPng(img));
  out[name] = { w: img.w, h: img.h };
}

// pumpkin: lit + unlit cropped with the SAME rectangle so they stay aligned
const lit = chromaKey(await load(S('02_pumpkin.png')));
const unlit = chromaKey(await load(S('06_pumpkin_unlit.png')));
const b1 = alphaBox(lit), b2 = alphaBox(unlit);
const box = { x: Math.min(b1.x, b2.x), y: Math.min(b1.y, b2.y) };
box.w = Math.max(b1.x + b1.w, b2.x + b2.w) - box.x; box.h = Math.max(b1.y + b1.h, b2.y + b2.h) - box.y;
const litC = crop(lit, box, 4), unlitC = crop(unlit, box, 4);
await save('pumpkin_lit', litC);
await save('pumpkin', unlitC);
await save('pumpkin_light', lightLayer(litC, unlitC));

for (const [name, file] of [['hat', '03c_hat.png'], ['plaque', '04_plaque.png']]) {
  const img = chromaKey(await load(S(file)), { minArea: 20000 });
  await save(name, crop(img, alphaBox(img), 3));
}

const sheet = chromaKey(await load(S('05_sheet.png')), { minArea: 1500 });
const boxes = components(sheet, { minArea: 3000, gap: 10 });
console.log('sheet components:', boxes.map((b) => `${b.x},${b.y} ${b.w}x${b.h}`).join(' | '));
const names = JSON.parse(process.env.SHEET_NAMES || '[]');
for (let i = 0; i < boxes.length; i++) {
  const c = crop(sheet, boxes[i], 2);
  await save(names[i] || `sheet_${i}`, crop(c, alphaBox(c), 2));
}
fs.writeFileSync('parts/parts.json', JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([k, v]) => `${k} ${v.w}x${v.h}`).join('\n'));

// candies: split the group into single pieces
{
  const g = await load('parts/candies.png');
  const bx = components(g, { minArea: 2000, gap: 3 });
  console.log('candies:', bx.length);
  for (let i = 0; i < bx.length; i++) { const c = largestBlob(crop(g, bx[i], 2)); await save(`candy${i + 1}`, crop(c, alphaBox(c), 2)); }
  fs.writeFileSync('parts/parts.json', JSON.stringify(out, null, 1));
}
