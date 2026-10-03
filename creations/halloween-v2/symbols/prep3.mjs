// parts3/*.png (AI edits, ~4x bigger) -> same size as the source symbol, chroma-keyed: parts3k/*.png
import fs from 'node:fs';
import sharp from 'sharp';
import { chromaKey, toPng, largestBlob } from '../../tools/imagekit.js';
fs.mkdirSync('source/parts3k', { recursive: true });
for (const f of fs.readdirSync('source/parts3')) {
  const src = f.replace(/_(bodyblink|body|wing_l|wing_r|tail|pot|top|jaw|hat|bottle|cork|plain|wraps)\.png$/, '.png');
  const m = await sharp('source/' + src).metadata();
  const { data } = await sharp('source/parts3/' + f).resize(m.width, m.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let img = chromaKey({ w: m.width, h: m.height, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }, { minArea: 300 });
  if (!/wraps/.test(f)) img = largestBlob(img, 100);
  fs.writeFileSync('source/parts3k/' + f, await toPng(img));
}
console.log(fs.readdirSync('source/parts3k').length, 'parts');
