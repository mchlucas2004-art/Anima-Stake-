// Halloween V2 — animated background: client's backdrop (bg_clean = without lantern / cat) + lantern and cat cut
// from the original, + candle / window / moon glows.   node background/build.mjs -> background/package/*
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { load, components, alphaBox, crop, resize, procedural, pack, composePage } from '../../tools/imagekit.js';

const NAME = 'background';
const OUT = 'background/package';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const R = (v) => Math.round(v * 100) / 100;
const T = (t) => Math.round(t * 10000) / 10000;

const ref = await load('source/ref_background.png');
const RW = ref.w, RH = ref.h; // 2306 x 1300
const K = 1600 / RW; // ref px -> units
const U = (x, y) => [(x - RW / 2) * K, (RH / 2 - y) * K];

// clean plate, resized onto the reference frame
const { data } = await sharp('source/bg_clean.png').resize(RW, RH, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const plate = { w: RW, h: RH, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };

// lantern / cat: pixels of the original that differ from the night sky (lantern) or are near-black (cat), inside their zone
function cut(box, test) {
  const o = { w: RW, h: RH, px: new Uint8ClampedArray(RW * RH * 4) };
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = (y * RW + x) * 4;
    if (test(ref.px[i], ref.px[i + 1], ref.px[i + 2], x, y)) { o.px.set(ref.px.subarray(i, i + 3), i); o.px[i + 3] = 255; }
  }
  const b = components(o, { minArea: 400, gap: 3 }).sort((a, c) => c.w * c.h - a.w * a.h)[0];
  return crop(o, b, 2);
}
const skyAt = (x, y) => { const i = (y * RW + x) * 4; return [ref.px[i], ref.px[i + 1], ref.px[i + 2]]; };
const sky = skyAt(1880, 330);
const lantern = cut({ x: 1930, y: 228, w: 190, h: 290 }, (r, g, b) => Math.abs(r - sky[0]) + Math.abs(g - sky[1]) + Math.abs(b - sky[2]) > 55);
const cat = cut({ x: 1700, y: 900, w: 185, h: 300 }, (r, g, b) => r + g + b < 95);
console.log('lantern', lantern.w, lantern.h, 'cat', cat.w, cat.h);

const items = [];
const size = {}, pos = {};
async function add(name, img, w, h, at) { size[name] = [w, h]; if (at) pos[name] = at; items.push({ name, img: await resize(img, Math.round(w * 1.25), Math.round(h * 1.25)) }); }
await add('plate', plate, RW * K, RH * K, [0, 0]);
await add('lantern', lantern, lantern.w * K, lantern.h * K, U(lantern.x0 + lantern.w / 2, lantern.y0 + lantern.h / 2));
await add('cat', cat, cat.w * K, cat.h * K, U(cat.x0 + cat.w / 2, cat.y0 + cat.h / 2));
const lanternTop = U(lantern.x0 + lantern.w / 2, lantern.y0);
const catBase = U(cat.x0 + cat.w * 0.55, cat.y0 + cat.h * 0.92);
for (const [n, t] of [['glow', 256], ['rays', 512]]) { size[n] = [100, 100]; items.push({ name: n, img: procedural(n, t) }); }
const pages = pack(items, { maxSize: 2048, padding: 4 });
let atlas = '';
for (let i = 0; i < pages.length; i++) {
  const f = `${NAME}${i ? '_' + (i + 1) : ''}.png`;
  fs.writeFileSync(`${OUT}/${f}`, await composePage(pages[i]));
  atlas += `${i ? '\n' : ''}${f}\nsize:${pages[i].w},${pages[i].h}\nfilter:Linear,Linear\n` + pages[i].rects.map((r) => `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`).join('');
}
fs.writeFileSync(`${OUT}/${NAME}.atlas`, atlas);

// ------------------------------------------------------------------ rig
const P = {
  moon: U(297, 136), window: U(2144, 816), pumpkin1: U(421, 1032), pumpkin2: U(594, 1062), lanternGlow: U(lantern.x0 + lantern.w / 2, lantern.y0 + lantern.h * 0.62),
};
const bones = [{ name: 'root' }];
const bone = (name, parent, x, y, o = {}) => bones.push({ name, parent, x: R(x), y: R(y), ...o });
bone('moon', 'root', ...P.moon);
bone('window', 'root', ...P.window);
bone('pumpkin1', 'root', ...P.pumpkin1);
bone('pumpkin2', 'root', ...P.pumpkin2);
bone('lantern', 'root', ...lanternTop);
bone('cat', 'root', ...catBase);
const slots = [], A = {};
const slot = (name, b, att, o = {}) => { slots.push({ name, bone: b, attachment: att, ...o }); };
const put = (s, k, v) => ((A[s] ||= {})[k] = v);
slot('plate', 'root', 'plate'); put('plate', 'plate', { width: R(size.plate[0]), height: R(size.plate[1]) });
slot('moon_glow', 'moon', 'glow', { color: 'fff3c066', blend: 'additive' }); put('moon_glow', 'glow', { width: 230, height: 230 });
slot('window_glow', 'window', 'glow', { color: 'ffd27a73', blend: 'additive' }); put('window_glow', 'glow', { width: 260, height: 300 });
slot('pumpkin1_glow', 'pumpkin1', 'glow', { color: 'ff8a2a73', blend: 'additive' }); put('pumpkin1_glow', 'glow', { width: 210, height: 180 });
slot('pumpkin2_glow', 'pumpkin2', 'glow', { color: 'ff8a2a66', blend: 'additive' }); put('pumpkin2_glow', 'glow', { width: 150, height: 130 });
slot('cat', 'cat', 'cat'); put('cat', 'cat', { x: R(pos.cat[0] - catBase[0]), y: R(pos.cat[1] - catBase[1]), width: R(size.cat[0]), height: R(size.cat[1]) });
slot('lantern', 'lantern', 'lantern'); put('lantern', 'lantern', { x: R(pos.lantern[0] - lanternTop[0]), y: R(pos.lantern[1] - lanternTop[1]), width: R(size.lantern[0]), height: R(size.lantern[1]) });
slot('lantern_glow', 'lantern', 'glow', { color: 'ff9a3a80', blend: 'additive' }); put('lantern_glow', 'glow', { y: R(P.lanternGlow[1] - lanternTop[1]), width: 220, height: 220 });

// ------------------------------------------------------------------ animations
const EASE = { sine: [0.37, 0, 0.63, 1], inOut: [0.42, 0, 0.58, 1], out: [0, 0, 0.58, 1] };
const curve = (t0, v0, t1, v1, e) => { const c = EASE[e]; if (!c) return null; return v0.flatMap((_, i) => [T(t0 + c[0] * (t1 - t0)), R(v0[i] + c[1] * (v1[i] - v0[i])), T(t0 + c[2] * (t1 - t0)), R(v0[i] + c[3] * (v1[i] - v0[i]))]); };
const tl = (keys, f) => keys.map((k, i) => { const o = {}; if (k[0]) o.time = T(k[0]); f.forEach((n, j) => (o[n] = R(k[1 + j]))); const nx = keys[i + 1]; if (nx) { const c = curve(k[0], k.slice(1, 1 + f.length), nx[0], nx.slice(1, 1 + f.length), k[1 + f.length]); if (c) o.curve = c; } return o; });
const hex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
function flicker(slotName, rgb, D, base, amp, seed, steps = 10) {
  const keys = [];
  for (let i = 0; i <= steps; i++) { const t = (i * D) / steps; const v = i === steps ? base : base + amp * Math.sin(seed * 12.9 + i * 2.7) * Math.cos(i * 1.3 + seed); keys.push([t, v]); }
  return { rgba: keys.map(([t, a], i) => { const o = {}; if (t) o.time = T(t); o.color = [...rgb, a].map(hex).join(''); const nx = keys[i + 1]; if (nx) { const c = curve(t, [...rgb, a], nx[0], [...rgb, nx[1]], 'sine'); if (c) o.curve = c; } return o; }) };
}
function anim(D, k) {
  const b = {}, s = {};
  b.lantern = { rotate: tl([[0, 0, 'sine'], [D / 4, 5 * k, 'sine'], [(3 * D) / 4, -5 * k, 'sine'], [D, 0]], ['value']) };
  b.cat = { scale: tl([[0, 1, 1, 'sine'], [D / 4, 1.015, 1.03, 'sine'], [D / 2, 1, 1, 'sine'], [(3 * D) / 4, 1.015, 1.03, 'sine'], [D, 1, 1]], ['x', 'y']) };
  b.moon = { scale: tl([[0, 1, 1, 'sine'], [D / 2, 1.08 * k, 1.08 * k, 'sine'], [D, 1, 1]], ['x', 'y']) };
  s.moon_glow = flicker('moon_glow', [1, 0.95, 0.75], D, 0.4 * k, 0.08, 1, 4);
  s.window_glow = flicker('window_glow', [1, 0.82, 0.48], D, 0.42 * k, 0.12, 2);
  s.pumpkin1_glow = flicker('pumpkin1_glow', [1, 0.54, 0.16], D, 0.42 * k, 0.16, 3, 16);
  s.pumpkin2_glow = flicker('pumpkin2_glow', [1, 0.54, 0.16], D, 0.38 * k, 0.16, 4, 16);
  s.lantern_glow = flicker('lantern_glow', [1, 0.6, 0.23], D, 0.5 * k, 0.15, 5, 12);
  return { bones: b, slots: s };
}
const anims = { idle: anim(4, 1), free_spins: anim(2.4, 1.6) };
// free spins: everything washes to a purple night
anims.free_spins.slots.plate = { rgba: [{ color: 'e0c8ffff' }] };

const skel = {
  skeleton: { hash: '', spine: '4.2.43', x: R(-size.plate[0] / 2), y: R(-size.plate[1] / 2), width: R(size.plate[0]), height: R(size.plate[1]), images: './images/', audio: '' },
  bones, slots, skins: [{ name: 'default', attachments: A }], animations: anims,
};
skel.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skel)).digest('base64').slice(0, 11);
fs.writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(skel));
fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
  id: 'creations/halloween-v2/background', package: NAME, name: NAME, label: 'Décor animé', game: 'Halloween V2', game_slug: 'halloween-v2',
  format: 'spine', skeleton_format: 'json', skeleton_file: `${NAME}.json`, skeleton_version: '4.2.43', category: 'background', subtypes: ['background_loop'],
  animations: Object.keys(anims), events: [], bones_count: bones.length, slots_count: slots.length, skins: ['default'],
  atlases: [{ file: `${NAME}.atlas`, pages: pages.map((_, i) => `${NAME}${i ? '_' + (i + 1) : ''}.png`) }], textures: [], complete: true, warnings: [],
}, null, 1));
console.log(`background: ${bones.length} os, anims ${Object.keys(anims).join(', ')}, pages ${pages.length}`);
