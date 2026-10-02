// Step 2: atlas + Spine 4.2 skeleton + animations for the Halloween scatter.
//   node build.mjs   ->  package/halloween_scatter.{json,atlas,png} + metadata.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { load, resize, procedural, pack, composePage, components } from '../../tools/imagekit.js';

const NAME = 'halloween_scatter';
const OUT = 'package';
fs.mkdirSync(OUT, { recursive: true });
const RES = 2; // textures are exported at 2x the attachment size (crisp on retina / zoom)

// ------------------------------------------------------------------ textures
// name -> [width in skeleton units, source]
const ART = {
  pumpkin: [200, 'parts/pumpkin.png'], pumpkin_light: [200, 'parts/pumpkin_light.png'], hat: [236, 'parts/hat.png'],
  plaque: [330, 'parts/plaque.png'], moon: [300, 'parts/moon.png'], bat_body: [40, 'parts/bat_body.png'], wing: [84, 'parts/wing.png'],
  ghost: [84, 'parts/ghost.png'], smoke_big: [120, 'parts/smoke_big.png'], smoke_small: [80, 'parts/smoke_small.png'],
  star: [46, 'parts/star.png'], candy1: [30, 'parts/candy1.png'], candy2: [30, 'parts/candy2.png'], candy3: [30, 'parts/candy3.png'],
};
const FX = { glow: [420, 256], rays: [600, 512], flash: [320, 256], ring: [320, 256], dot: [26, 64], shine: [120, 128] };

const size = {}; // attachment width/height in units
const items = [];
for (const [name, [wu, file]] of Object.entries(ART)) {
  const img = await load(file);
  const hu = (wu * img.h) / img.w;
  size[name] = [wu, hu];
  items.push({ name, img: await resize(img, wu * RES, hu * RES) });
}
for (const [name, [wu, tex]] of Object.entries(FX)) {
  const img = procedural(name, tex);
  size[name] = name === 'shine' ? [wu, 170] : [wu, wu];
  items.push({ name, img });
}
// glow centres of the candle light (eyes / nose / mouth), measured on the light layer itself
const light = await load('parts/pumpkin_light.png');
const lb = components(light, { minArea: 400, gap: 6 }).sort((a, b) => b.w * b.h - a.w * a.h);
const toUnit = (px, py) => [((px - light.w / 2) * size.pumpkin[0]) / light.w, ((light.h / 2 - py) * size.pumpkin[1]) / light.h];
const blobs = lb.slice(0, 4).map((b) => toUnit(b.x + b.w / 2, b.y + b.h / 2));
const mouth = blobs[0];
const eyes = blobs.slice(1).filter((p) => p[1] > 0).sort((a, b) => a[0] - b[0]).slice(0, 2);
const eyeL = eyes[0] || [-48, 20], eyeR = eyes[1] || [48, 20];

const pages = pack(items, { maxSize: 2048, padding: 4 });
if (pages.length > 1) throw new Error('atlas does not fit on one 2048 page');
const page = pages[0];
fs.writeFileSync(`${OUT}/${NAME}.png`, await composePage(page));
let atlas = `${NAME}.png\nsize:${page.w},${page.h}\nfilter:Linear,Linear\n`;
for (const r of page.rects.sort((a, b) => a.name.localeCompare(b.name))) atlas += `${r.name}\nbounds:${r.x},${r.y},${r.img.w},${r.img.h}\n`;
fs.writeFileSync(`${OUT}/${NAME}.atlas`, atlas);

// ------------------------------------------------------------------ rig
const R = (v) => Math.round(v * 100) / 100;
const PUMPKIN_H = size.pumpkin[1];
const bones = [];
const bone = (name, parent, o = {}) => bones.push({ name, ...(parent ? { parent } : {}), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? R(v) : v])) });
bone('root');
bone('main', 'root');
bone('aura', 'main', { y: 40 });
bone('rays', 'main', { y: 40 });
bone('moon', 'main', { y: 78 });
bone('ghost', 'main', { x: 40, y: 20 });
bone('body', 'main', { y: 30 - PUMPKIN_H / 2 }); // pivot at the bottom of the pumpkin: squash & stretch
bone('pumpkin', 'body', { y: PUMPKIN_H / 2 });
bone('eye_l', 'pumpkin', { x: eyeL[0], y: eyeL[1] });
bone('eye_r', 'pumpkin', { x: eyeR[0], y: eyeR[1] });
bone('mouth', 'pumpkin', { x: mouth[0], y: mouth[1] });
bone('hat', 'body', { x: 6, y: PUMPKIN_H * 0.81, rotation: -4 });
bone('plaque', 'main', { y: -100 });
bone('plaque_shine', 'plaque', { x: -230 });
for (const [side, x, y, s] of [['l', -168, 128, 1], ['r', 168, 46, 0.9]]) {
  bone(`bat_${side}`, 'main', { x, y, scaleX: s, scaleY: s });
  bone(`bat_${side}_wing_l`, `bat_${side}`, { x: -9, y: 10 });
  bone(`bat_${side}_wing_r`, `bat_${side}`, { x: 9, y: 10 });
}
for (let i = 1; i <= 3; i++) bone(`candy${i}`, 'main', { y: 40 });
const SMOKE = [[-120, -168], [125, -168], [-30, 40], [40, 60]];
SMOKE.forEach(([x, y], i) => bone(`smoke${i + 1}`, 'main', { x, y }));
const STARS = [[-150, 200], [160, 180], [-205, 20], [200, -40], [-120, -195], [125, 235]];
STARS.forEach(([x, y], i) => bone(`star${i + 1}`, 'main', { x, y }));
bone('ring', 'main', { y: 40 });
bone('flash', 'main', { y: 40 });

const slots = [];
const slot = (name, b, attachment = name, o = {}) => slots.push({ name, bone: b, ...(attachment ? { attachment } : {}), ...o });
slot('aura', 'aura', 'glow', { color: 'ff8a2a8c', blend: 'additive' });
slot('rays', 'rays', 'rays', { color: 'ffc35a00', blend: 'additive' });
slot('moon_glow', 'moon', 'glow', { color: 'fff1b066', blend: 'additive' });
slot('moon', 'moon');
slot('ghost', 'ghost', null);
slot('smoke1', 'smoke1', null); slot('smoke2', 'smoke2', null);
for (const s of ['l', 'r']) {
  slot(`bat_${s}_wing_l`, `bat_${s}_wing_l`, 'wing');
  slot(`bat_${s}_wing_r`, `bat_${s}_wing_r`, 'wing');
  slot(`bat_${s}`, `bat_${s}`, 'bat_body');
}
slot('pumpkin', 'pumpkin');
slot('pumpkin_light', 'pumpkin', 'pumpkin_light', { blend: 'additive' });
slot('face_bloom', 'pumpkin', 'glow', { color: 'ff9a2a00', blend: 'additive' });
slot('eye_l_glow', 'eye_l', 'glow', { color: 'ffb34a59', blend: 'additive' });
slot('eye_r_glow', 'eye_r', 'glow', { color: 'ffb34a59', blend: 'additive' });
slot('hat', 'hat');
slot('plaque', 'plaque');
slot('plaque_clip', 'plaque', 'plaque_clip');
slot('plaque_shine', 'plaque_shine', 'shine', { color: 'ffffff00', blend: 'additive' });
for (let i = 1; i <= 3; i++) slot(`candy${i}`, `candy${i}`, null);
STARS.forEach((_, i) => slot(`star${i + 1}`, `star${i + 1}`, 'star', { color: 'ffffff00' }));
slot('smoke3', 'smoke3', null); slot('smoke4', 'smoke4', null);
slot('ring', 'ring', null, { blend: 'additive' });
slot('flash', 'flash', null, { blend: 'additive' });

const att = (name, o = {}) => ({ width: R(size[name][0]), height: R(size[name][1]), ...o });
const A = {};
const put = (s, key, value) => ((A[s] ||= {})[key] = value);
put('aura', 'glow', att('glow', { scaleX: 1.15, scaleY: 1.15 }));
put('rays', 'rays', att('rays'));
put('moon_glow', 'glow', att('glow', { scaleX: 1.05, scaleY: 1.05 }));
put('moon', 'moon', att('moon'));
put('ghost', 'ghost', att('ghost'));
for (const s of ['smoke1', 'smoke2', 'smoke3', 'smoke4']) { put(s, 'smoke_big', att('smoke_big')); put(s, 'smoke_small', att('smoke_small')); }
// wing image: shoulder at the right edge, the wing spreads to the left
const [ww, wh] = size.wing;
for (const s of ['l', 'r']) {
  put(`bat_${s}_wing_l`, 'wing', att('wing', { x: -ww * 0.44, y: wh * 0.12, rotation: 6 }));
  put(`bat_${s}_wing_r`, 'wing', att('wing', { x: ww * 0.44, y: wh * 0.12, scaleX: -1, rotation: -6 }));
  put(`bat_${s}`, 'bat_body', att('bat_body'));
}
put('pumpkin', 'pumpkin', att('pumpkin'));
put('pumpkin_light', 'pumpkin_light', att('pumpkin_light'));
put('face_bloom', 'glow', att('glow', { y: -6, scaleX: 0.62, scaleY: 0.5 }));
put('eye_l_glow', 'glow', att('glow', { scaleX: 0.2, scaleY: 0.2 }));
put('eye_r_glow', 'glow', att('glow', { scaleX: 0.2, scaleY: 0.2 }));
put('hat', 'hat', att('hat', { x: 2, y: size.hat[1] * 0.36 }));
put('plaque', 'plaque', att('plaque'));
const pw = size.plaque[0] * 0.47, ph = size.plaque[1] * 0.4;
put('plaque_clip', 'plaque_clip', { type: 'clipping', end: 'plaque_shine', vertexCount: 4, vertices: [-pw, -ph, pw, -ph, pw, ph, -pw, ph].map(R), color: 'ce3a3aff' });
put('plaque_shine', 'shine', att('shine', { rotation: -18 }));
for (let i = 1; i <= 3; i++) put(`candy${i}`, `candy${i}`, att(`candy${i}`));
STARS.forEach((_, i) => put(`star${i + 1}`, 'star', att('star', { scaleX: 0.75 + (i % 3) * 0.15, scaleY: 0.75 + (i % 3) * 0.15 })));
put('ring', 'ring', att('ring'));
put('flash', 'flash', att('flash'));

// ------------------------------------------------------------------ animation builder
const EASE = {
  linear: null, in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1], sine: [0.37, 0, 0.63, 1],
  outBack: [0.34, 1.56, 0.64, 1], inBack: [0.36, 0, 0.66, -0.56], outQuad: [0.5, 1, 0.89, 1], inQuad: [0.11, 0, 0.5, 0],
  outExpo: [0.16, 1, 0.3, 1], inExpo: [0.7, 0, 0.84, 0], outCubic: [0.33, 1, 0.68, 1], inCubic: [0.32, 0, 0.67, 0],
};
const T = (t) => Math.round(t * 10000) / 10000;
function curve(t0, v0, t1, v1, ease) {
  if (ease === 'stepped') return 'stepped';
  const e = EASE[ease || 'linear'];
  if (!e) return null;
  const out = [];
  for (let i = 0; i < v0.length; i++) out.push(T(t0 + e[0] * (t1 - t0)), R(v0[i] + e[1] * (v1[i] - v0[i])), T(t0 + e[2] * (t1 - t0)), R(v0[i] + e[3] * (v1[i] - v0[i])));
  return out;
}
function timeline(keys, fields, mapValues) {
  // keys: [time, ...values, ease?]
  return keys.map((k, i) => {
    const vals = k.slice(1, 1 + fields.length);
    const ease = k[1 + fields.length];
    const o = {};
    if (k[0]) o.time = T(k[0]);
    fields.forEach((f, j) => (o[f] = mapValues ? mapValues(vals[j], j) : R(vals[j])));
    const next = keys[i + 1];
    if (next) {
      const c = curve(k[0], vals.map(Number), next[0], next.slice(1, 1 + fields.length).map(Number), ease);
      if (c) o.curve = c;
    }
    return o;
  });
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
class Anim {
  constructor() { this.bones = {}; this.slots = {}; this.events = []; }
  b(name) { return (this.bones[name] ||= {}); }
  rot(name, keys) { this.b(name).rotate = timeline(keys, ['value']); return this; }
  move(name, keys) { this.b(name).translate = timeline(keys, ['x', 'y']); return this; }
  scale(name, keys) { this.b(name).scale = timeline(keys, ['x', 'y']); return this; }
  /** keys: [time, r, g, b, a, ease] with 0..1 channels */
  color(name, keys) {
    const tl = keys.map((k, i) => {
      const o = {};
      if (k[0]) o.time = T(k[0]);
      o.color = k.slice(1, 5).map(hex2).join('');
      const next = keys[i + 1];
      if (next) { const c = curve(k[0], k.slice(1, 5), next[0], next.slice(1, 5), k[5]); if (c) o.curve = c; }
      return o;
    });
    (this.slots[name] ||= {}).rgba = tl;
    return this;
  }
  /** alpha only, keeping an rgb tint */
  alpha(name, rgb, keys) { return this.color(name, keys.map(([t, a, e]) => [t, ...rgb, a, e])); }
  show(name, keys) { (this.slots[name] ||= {}).attachment = keys.map(([t, n]) => ({ ...(t ? { time: T(t) } : {}), name: n })); return this; }
  ev(t, name) { this.events.push({ ...(t ? { time: T(t) } : {}), name }); return this; }
  json() {
    const o = {};
    if (Object.keys(this.slots).length) o.slots = this.slots;
    if (Object.keys(this.bones).length) o.bones = this.bones;
    if (this.events.length) o.events = this.events.sort((a, b) => (a.time || 0) - (b.time || 0));
    return o;
  }
}
const ORANGE = [1, 0.54, 0.16], GOLD = [1, 0.77, 0.35], WHITE = [1, 1, 1], EYE = [1, 0.7, 0.29], FACE = [1, 0.6, 0.16], MOONG = [1, 0.94, 0.69];
const flapKeys = (t0, t1, period, amp, base = 0) => {
  const k = [];
  for (let t = t0; t < t1 - 1e-6; t += period) { k.push([t, base, 'sine']); k.push([t + period / 2, base + amp, 'sine']); }
  k.push([t1, base]);
  return k;
};
const flapBat = (a, side, t0, t1, period, amp = 38) => {
  a.rot(`bat_${side}_wing_l`, flapKeys(t0, t1, period, -amp));
  a.rot(`bat_${side}_wing_r`, flapKeys(t0, t1, period, amp));
};
const twinkle = (a, i, t0, dur = 0.5) => {
  a.alpha(`star${i}`, WHITE, [[0, 0], [t0, 0, 'outQuad'], [t0 + dur * 0.35, 1, 'inQuad'], [t0 + dur, 0]]);
  a.scale(`star${i}`, [[0, 0.2, 0.2], [t0, 0.2, 0.2, 'outBack'], [t0 + dur * 0.35, 1.15, 1.15, 'inQuad'], [t0 + dur, 0.3, 0.3]]);
  a.rot(`star${i}`, [[0, 0], [t0, 0], [t0 + dur, 45]]);
};
const puff = (a, s, t0, dx, dy, img = 'smoke_big', dur = 0.7, tint = WHITE, peak = 0.9) => {
  a.show(s, [[0, null], [t0, img], [t0 + dur, null]]);
  const [x0, y0] = SMOKE[Number(s.slice(-1)) - 1];
  a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + dur, dx, dy]]);
  a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outCubic'], [t0 + dur, 1.25, 1.1]]);
  a.alpha(s, tint, [[0, 0], [t0, peak, 'in'], [t0 + dur, 0]]);
  void x0; void y0;
};
const lightLevel = (a, keys) => a.alpha('pumpkin_light', WHITE, keys);

const anims = {};

// ---- INTRO: arrival (1.5 s)
{
  const a = new Anim();
  a.scale('main', [[0, 0, 0, 'outBack'], [0.45, 1.06, 1.06, 'inOut'], [0.7, 1, 1]]);
  a.alpha('moon', WHITE, [[0, 0], [0.1, 0, 'out'], [0.45, 1]]);
  a.scale('moon', [[0, 0.4, 0.4], [0.1, 0.4, 0.4, 'outBack'], [0.55, 1, 1]]);
  a.rot('moon', [[0, -40, 'outCubic'], [0.6, 0]]);
  a.alpha('moon_glow', MOONG, [[0, 0], [0.3, 0, 'out'], [0.8, 0.4]]);
  a.alpha('aura', ORANGE, [[0, 0], [0.5, 0, 'out'], [0.9, 0.55]]);
  // pumpkin pops out of the ground
  a.move('body', [[0, 0, -120, 'outBack'], [0.32, 0, 12, 'inOut'], [0.45, 0, 0]]);
  a.scale('body', [[0, 0.55, 1.45, 'out'], [0.3, 0.9, 1.15, 'out'], [0.42, 1.22, 0.78, 'outQuad'], [0.56, 0.93, 1.08, 'inOut'], [0.7, 1.03, 0.97, 'inOut'], [0.82, 1, 1]]);
  // candle ignites at 0.55
  lightLevel(a, [[0, 0], [0.55, 0, 'outExpo'], [0.62, 1, 'inOut'], [0.68, 0.55, 'inOut'], [0.76, 1, 'inOut'], [0.84, 0.8, 'inOut'], [0.95, 1]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.55, 0, 'outExpo'], [0.63, 0.9, 'out'], [1.1, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0], [0.58, 0, 'outExpo'], [0.66, 1, 'out'], [1.1, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0], [0.6, 0, 'outExpo'], [0.68, 1, 'out'], [1.1, 0.35]]);
  // hat drops from the sky and lands with a wobble
  a.move('hat', [[0, -40, 330], [0.22, -40, 330, 'inQuad'], [0.5, 0, 0, 'outQuad'], [0.6, 0, 16, 'inQuad'], [0.7, 0, 0]]);
  a.rot('hat', [[0, -35], [0.22, -35, 'inQuad'], [0.5, 10, 'outQuad'], [0.62, -6, 'inOut'], [0.76, 3, 'inOut'], [0.9, 0]]);
  a.scale('hat', [[0, 1, 1], [0.5, 1, 1, 'out'], [0.56, 1.12, 0.86, 'outBack'], [0.72, 1, 1]]);
  // plaque unrolls
  a.scale('plaque', [[0, 0, 0.2], [0.45, 0, 0.2, 'outBack'], [0.75, 1, 1]]);
  a.move('plaque', [[0, 0, -30], [0.45, 0, -30, 'outBack'], [0.75, 0, 0]]);
  a.move('plaque_shine', [[0, 0, 0], [0.95, 0, 0, 'inOut'], [1.35, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [0.95, 0.85], [1.35, 0.85, 'stepped'], [1.36, 0]]);
  // bats fly in from the sides
  a.move('bat_l', [[0, -260, 140], [0.35, -260, 140, 'outCubic'], [0.95, 0, 0]]);
  a.move('bat_r', [[0, 260, 120], [0.45, 260, 120, 'outCubic'], [1.05, 0, 0]]);
  a.scale('bat_l', [[0, 0.3, 0.3], [0.35, 0.3, 0.3, 'outCubic'], [0.95, 1, 1]]);
  a.scale('bat_r', [[0, 0.3, 0.3], [0.45, 0.3, 0.3, 'outCubic'], [1.05, 1, 1]]);
  flapBat(a, 'l', 0, 1.5, 0.14, 45); flapBat(a, 'r', 0, 1.5, 0.15, 45);
  puff(a, 'smoke1', 0.28, -70, 10, 'smoke_big', 0.7, WHITE, 0.85);
  puff(a, 'smoke2', 0.3, 75, 10, 'smoke_small', 0.65, WHITE, 0.85);
  a.show('ring', [[0, null], [0.55, 'ring'], [1.0, null]]);
  a.scale('ring', [[0, 0.2, 0.2], [0.55, 0.2, 0.2, 'outCubic'], [1.0, 1.6, 1.6]]);
  a.alpha('ring', GOLD, [[0, 0], [0.55, 0.9, 'in'], [1.0, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.85 + i * 0.07, 0.5));
  a.ev(0.32, 'land').ev(0.55, 'ignite').ev(0.5, 'hat');
  anims.intro = a;
}

// ---- IDLE: loop (2.4 s)
{
  const D = 2.4, a = new Anim();
  a.scale('body', [[0, 1, 1, 'sine'], [D / 2, 1.025, 0.975, 'sine'], [D, 1, 1]]);
  a.rot('hat', [[0, 0, 'sine'], [D / 4, -3, 'sine'], [(3 * D) / 4, 3, 'sine'], [D, 0]]);
  a.move('hat', [[0, 0, 0, 'sine'], [D / 2, 0, 5, 'sine'], [D, 0, 0]]);
  a.rot('moon', [[0, 0, 'sine'], [D / 2, 4, 'sine'], [D, 0]]);
  a.scale('moon', [[0, 1, 1, 'sine'], [D / 2, 1.015, 1.015, 'sine'], [D, 1, 1]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'sine'], [D / 2, 0.72, 'sine'], [D, 0.5]]);
  a.scale('aura', [[0, 1, 1, 'sine'], [D / 2, 1.08, 1.08, 'sine'], [D, 1, 1]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'sine'], [D / 2, 0.55, 'sine'], [D, 0.4]]);
  a.move('bat_l', [[0, 0, 0, 'sine'], [D / 2, 6, -12, 'sine'], [D, 0, 0]]);
  a.move('bat_r', [[0, 0, 0, 'sine'], [D / 2, -5, 12, 'sine'], [D, 0, 0]]);
  a.rot('bat_l', [[0, 0, 'sine'], [D / 2, 6, 'sine'], [D, 0]]);
  a.rot('bat_r', [[0, 0, 'sine'], [D / 2, -6, 'sine'], [D, 0]]);
  flapBat(a, 'l', 0, D, 0.3, 32); flapBat(a, 'r', 0, D, 0.4, 32);
  a.scale('plaque', [[0, 1, 1, 'sine'], [D / 2, 1.015, 1.015, 'sine'], [D, 1, 1]]);
  a.move('plaque_shine', [[0, 0, 0], [1.4, 0, 0, 'inOut'], [2.0, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [1.4, 0.6], [2.0, 0.6, 'stepped'], [2.01, 0]]);
  [[1, 0.2], [2, 1.0], [3, 1.6], [4, 0.6], [5, 1.9], [6, 1.25]].forEach(([i, t]) => twinkle(a, i, t, 0.55));
  anims.idle = a;
}

// ---- IDLE_EYES: separate track (like the croc): candle flicker + quick "blink"
{
  const D = 3.6, a = new Anim();
  lightLevel(a, [[0, 1, 'sine'], [0.3, 0.86, 'sine'], [0.55, 1, 'sine'], [0.9, 0.9, 'sine'], [1.3, 1, 'sine'], [2.35, 1, 'inQuad'], [2.42, 0.15, 'stepped'], [2.5, 0.15, 'outQuad'], [2.62, 1, 'sine'], [2.9, 0.88, 'sine'], [3.2, 1, 'sine'], [D, 1]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35, 'sine'], [0.7, 0.55, 'sine'], [1.5, 0.3, 'sine'], [2.35, 0.4], [2.42, 0], [2.62, 0.6, 'sine'], [D, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35, 'sine'], [0.9, 0.5, 'sine'], [1.7, 0.3, 'sine'], [2.35, 0.4], [2.42, 0], [2.62, 0.6, 'sine'], [D, 0.35]]);
  anims.idle_eyes = a;
}

// ---- LAND: symbol stops on the reel (0.6 s)
{
  const a = new Anim();
  a.move('main', [[0, 0, 40, 'inQuad'], [0.08, 0, 0]]);
  a.scale('body', [[0, 0.92, 1.1, 'inQuad'], [0.08, 1.2, 0.8, 'outQuad'], [0.2, 0.94, 1.07, 'inOut'], [0.32, 1.03, 0.97, 'inOut'], [0.45, 1, 1]]);
  a.move('hat', [[0, 0, 0], [0.08, 0, 0, 'outQuad'], [0.2, 0, 28, 'inQuad'], [0.32, 0, 0, 'outQuad'], [0.38, 0, 5, 'inQuad'], [0.45, 0, 0]]);
  a.rot('hat', [[0, 0], [0.08, 0, 'outQuad'], [0.2, -9, 'inOut'], [0.34, 5, 'inOut'], [0.5, 0]]);
  a.scale('plaque', [[0, 1, 1], [0.08, 1, 1, 'outQuad'], [0.14, 1.06, 0.9, 'outBack'], [0.3, 1, 1]]);
  puff(a, 'smoke1', 0.06, -60, 6, 'smoke_small', 0.5, WHITE, 0.7);
  puff(a, 'smoke2', 0.06, 60, 6, 'smoke_small', 0.5, WHITE, 0.7);
  a.alpha('face_bloom', FACE, [[0, 0], [0.08, 0, 'out'], [0.14, 0.55, 'out'], [0.5, 0]]);
  a.ev(0.08, 'land');
  anims.land = a;
}

// ---- ANTICIPATION (0.35 s) -> ANTICIPATION_IDLE (loop 1.2 s) -> ANTICIPATION_END (0.5 s)
const antiPose = (a, t) => {
  a.scale('main', [[0, 1, 1, 'outBack'], [t, 1.1, 1.1]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'out'], [t, 0.95]]);
  a.alpha('rays', GOLD, [[0, 0, 'out'], [t, 0.55]]);
  a.alpha('face_bloom', FACE, [[0, 0, 'out'], [t, 0.6]]);
  a.move('bat_l', [[0, 0, 0, 'outCubic'], [t, 22, -14]]);
  a.move('bat_r', [[0, 0, 0, 'outCubic'], [t, -22, 14]]);
};
{
  const a = new Anim();
  antiPose(a, 0.35);
  a.move('hat', [[0, 0, 0, 'outQuad'], [0.15, 0, 20, 'inQuad'], [0.35, 0, 8]]);
  a.rot('rays', [[0, 0], [0.35, 20]]);
  flapBat(a, 'l', 0, 0.35, 0.09, 45); flapBat(a, 'r', 0, 0.35, 0.09, 45);
  a.ev(0, 'tease');
  anims.anticipation = a;
}
{
  const D = 1.2, a = new Anim();
  a.scale('main', [[0, 1.1, 1.1, 'sine'], [D / 2, 1.13, 1.13, 'sine'], [D, 1.1, 1.1]]);
  const shake = [];
  for (let i = 0; i <= 12; i++) shake.push([(i * D) / 12, i === 0 || i === 12 ? 0 : (i % 2 ? 1 : -1) * (2.5 + (i % 3)), 'sine']);
  a.rot('body', shake);
  a.scale('body', [[0, 1, 1, 'sine'], [D / 4, 1.04, 0.96, 'sine'], [D / 2, 0.97, 1.03, 'sine'], [(3 * D) / 4, 1.04, 0.96, 'sine'], [D, 1, 1]]);
  a.move('hat', [[0, 0, 8, 'sine'], [D / 4, 0, 22, 'sine'], [D / 2, 0, 8, 'sine'], [(3 * D) / 4, 0, 22, 'sine'], [D, 0, 8]]);
  a.rot('hat', [[0, 0, 'sine'], [D / 4, -7, 'sine'], [(3 * D) / 4, 7, 'sine'], [D, 0]]);
  a.alpha('aura', ORANGE, [[0, 0.95, 'sine'], [D / 2, 0.7, 'sine'], [D, 0.95]]);
  a.alpha('rays', GOLD, [[0, 0.55, 'sine'], [D / 2, 0.75, 'sine'], [D, 0.55]]);
  a.rot('rays', [[0, 20], [D, 50]]); // 12 spokes: 30° per period loops seamlessly
  a.alpha('face_bloom', FACE, [[0, 0.6, 'sine'], [D / 2, 0.9, 'sine'], [D, 0.6]]);
  lightLevel(a, [[0, 1], [D, 1]]);
  a.move('bat_l', [[0, 22, -14, 'sine'], [D / 2, 30, -4, 'sine'], [D, 22, -14]]);
  a.move('bat_r', [[0, -22, 14, 'sine'], [D / 2, -30, 4, 'sine'], [D, -22, 14]]);
  flapBat(a, 'l', 0, D, 0.1, 45); flapBat(a, 'r', 0, D, 0.12, 45);
  [[1, 0.1], [2, 0.5], [3, 0.8], [4, 0.3], [5, 0.65], [6, 0.95]].forEach(([i, t]) => twinkle(a, i, t * D * 0.7, 0.4));
  anims.anticipation_idle = a;
}
{
  const a = new Anim();
  a.scale('main', [[0, 1.1, 1.1, 'inOut'], [0.5, 1, 1]]);
  a.alpha('aura', ORANGE, [[0, 0.95, 'out'], [0.5, 0.5]]);
  a.alpha('rays', GOLD, [[0, 0.55, 'out'], [0.4, 0]]);
  a.rot('rays', [[0, 20, 'out'], [0.4, 35]]);
  a.alpha('face_bloom', FACE, [[0, 0.6, 'out'], [0.4, 0]]);
  a.move('hat', [[0, 0, 8, 'outQuad'], [0.25, 0, 0]]);
  a.move('bat_l', [[0, 22, -14, 'inOut'], [0.5, 0, 0]]);
  a.move('bat_r', [[0, -22, 14, 'inOut'], [0.5, 0, 0]]);
  flapBat(a, 'l', 0, 0.5, 0.25, 35); flapBat(a, 'r', 0, 0.5, 0.25, 35);
  anims.anticipation_end = a;
}

// ---- WIN: celebration (2.2 s)
{
  const D = 2.2, a = new Anim();
  a.scale('main', [[0, 1, 1, 'outBack'], [0.2, 1.22, 1.22, 'inOut'], [0.5, 1.12, 1.12, 'sine'], [1.6, 1.15, 1.15, 'inOut'], [D, 1, 1]]);
  a.scale('body', [[0, 1, 1, 'outQuad'], [0.1, 0.85, 1.18, 'outQuad'], [0.22, 1.15, 0.88, 'inOut'], [0.36, 0.97, 1.04, 'inOut'], [0.5, 1, 1, 'sine'], [1.05, 1, 1, 'outQuad'], [1.12, 1.16, 0.84, 'outBack'], [1.3, 1, 1]]);
  a.move('body', [[0, 0, 0, 'outQuad'], [0.1, 0, 0, 'outCubic'], [0.42, 0, 46, 'inQuad'], [0.7, 0, 0, 'sine'], [D, 0, 0]]);
  a.rot('body', [[0, 0], [0.42, 0, 'inOut'], [0.55, -6, 'inOut'], [0.7, 6, 'inOut'], [0.85, -3, 'inOut'], [1.0, 0]]);
  // hat flies up, does a full spin and lands back
  a.move('hat', [[0, 0, 0, 'outCubic'], [0.5, 0, 150, 'inQuad'], [1.05, 0, 0, 'outQuad'], [1.15, 0, 14, 'inQuad'], [1.25, 0, 0]]);
  a.rot('hat', [[0, 0, 'inOut'], [1.0, -360, 'outBack'], [1.25, -360]]);
  a.scale('hat', [[0, 1, 1], [1.05, 1, 1, 'outQuad'], [1.1, 1.15, 0.85, 'outBack'], [1.3, 1, 1]]);
  lightLevel(a, [[0, 1], [0.12, 1, 'outExpo'], [0.2, 1, 'inOut'], [D, 1]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.12, 0, 'outExpo'], [0.2, 1, 'out'], [0.8, 0.45, 'sine'], [1.5, 0.6, 'out'], [D, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35], [0.15, 1, 'out'], [D, 0.35]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35], [0.15, 1, 'out'], [D, 0.35]]);
  a.scale('eye_l', [[0, 1, 1], [0.15, 1.8, 1.8, 'out'], [D, 1, 1]]);
  a.scale('eye_r', [[0, 1, 1], [0.15, 1.8, 1.8, 'out'], [D, 1, 1]]);
  // backdrop
  a.alpha('rays', GOLD, [[0, 0], [0.15, 0.9, 'sine'], [1.6, 0.7, 'out'], [D, 0]]);
  a.rot('rays', [[0, 0], [D, -90]]);
  a.scale('rays', [[0, 0.6, 0.6, 'outBack'], [0.3, 1.05, 1.05, 'sine'], [D, 1, 1]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'out'], [0.2, 1, 'sine'], [1.6, 0.8, 'out'], [D, 0.5]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'out'], [0.2, 0.9, 'out'], [D, 0.4]]);
  a.scale('moon', [[0, 1, 1, 'outBack'], [0.2, 1.08, 1.08, 'inOut'], [D, 1, 1]]);
  a.show('flash', [[0, null], [0.12, 'flash'], [0.6, null]]);
  a.alpha('flash', WHITE, [[0, 0], [0.12, 1, 'out'], [0.6, 0]]);
  a.scale('flash', [[0, 0.5, 0.5], [0.12, 0.6, 0.6, 'outCubic'], [0.6, 1.8, 1.8]]);
  a.show('ring', [[0, null], [0.14, 'ring'], [0.85, null]]);
  a.alpha('ring', GOLD, [[0, 0], [0.14, 1, 'in'], [0.85, 0]]);
  a.scale('ring', [[0, 0.3, 0.3], [0.14, 0.3, 0.3, 'outCubic'], [0.85, 2.3, 2.3]]);
  // candy corns burst out
  [[-190, 120, 420], [200, 160, -380], [30, 230, 300]].forEach(([dx, dy, spin], i) => {
    const s = `candy${i + 1}`, t0 = 0.14 + i * 0.03;
    a.show(s, [[0, null], [t0, s], [1.45, null]]);
    a.move(s, [[0, 0, 0], [t0, 0, 0, 'outCubic'], [t0 + 0.55, dx, dy, 'inQuad'], [1.45, dx * 1.25, dy - 260]]);
    a.rot(s, [[0, 0], [t0, 0], [1.45, spin]]);
    a.scale(s, [[0, 0.3, 0.3], [t0, 0.3, 0.3, 'outBack'], [t0 + 0.3, 1.5, 1.5], [1.45, 1.1, 1.1]]);
    a.alpha(s, WHITE, [[0, 1], [1.2, 1, 'in'], [1.45, 0]]);
  });
  // ghost peeks out from behind and waves
  a.show('ghost', [[0, null], [0.3, 'ghost'], [D, null]]);
  a.move('ghost', [[0, 0, -40], [0.3, 0, -40, 'outBack'], [0.7, 120, 150, 'sine'], [1.5, 130, 165, 'inBack'], [1.95, 20, -30]]);
  a.rot('ghost', [[0, 0], [0.7, 0, 'sine'], [0.95, 12, 'sine'], [1.2, -8, 'sine'], [1.5, 0]]);
  a.alpha('ghost', WHITE, [[0, 0], [0.3, 0, 'out'], [0.6, 0.95, 'sine'], [1.6, 0.95, 'in'], [1.95, 0]]);
  a.scale('ghost', [[0, 0.4, 0.4], [0.3, 0.4, 0.4, 'outBack'], [0.7, 1, 1, 'sine'], [1.5, 1.05, 0.95, 'in'], [1.95, 0.5, 0.5]]);
  // bats loop around
  a.move('bat_l', [[0, 0, 0, 'inOut'], [0.6, 60, 90, 'inOut'], [1.2, -30, 40, 'inOut'], [D, 0, 0]]);
  a.move('bat_r', [[0, 0, 0, 'inOut'], [0.6, -50, 110, 'inOut'], [1.2, 40, 30, 'inOut'], [D, 0, 0]]);
  flapBat(a, 'l', 0, D, 0.11, 48); flapBat(a, 'r', 0, D, 0.12, 48);
  a.scale('plaque', [[0, 1, 1, 'outBack'], [0.2, 1.12, 1.12, 'inOut'], [0.5, 1, 1, 'sine'], [D, 1, 1]]);
  a.move('plaque_shine', [[0, 0, 0], [0.25, 0, 0, 'inOut'], [0.75, 460, 0, 'stepped'], [1.2, 0, 0, 'inOut'], [1.7, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [0.25, 1], [1.7, 1, 'stepped'], [1.71, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.15 + i * 0.12, 0.55));
  puff(a, 'smoke3', 0.12, -90, 40, 'smoke_big', 0.8, [1, 0.85, 1], 0.6);
  puff(a, 'smoke4', 0.12, 90, 30, 'smoke_big', 0.8, [1, 0.85, 1], 0.6);
  a.ev(0.12, 'burst').ev(1.05, 'thump');
  anims.win = a;
}

// ---- TRIGGER: free spins trigger, ends on a held "powered" pose (1.8 s)
{
  const D = 1.8, a = new Anim();
  const shake = [];
  for (let i = 0; i <= 18; i++) shake.push([(i * 0.9) / 18, i === 0 ? 0 : (i % 2 ? 1 : -1) * (1 + i * 0.35), 'sine']);
  shake.push([1.0, 0, 'outBack'], [D, 0]);
  a.rot('body', shake);
  a.scale('main', [[0, 1, 1, 'inCubic'], [0.9, 1.18, 1.18, 'outExpo'], [1.05, 1.42, 1.42, 'inOut'], [D, 1.32, 1.32]]);
  a.alpha('aura', [1, 0.45, 1], [[0, 0.5, 'in'], [0.9, 1, 'out'], [D, 0.9]]);
  a.scale('aura', [[0, 1, 1, 'in'], [0.9, 1.4, 1.4, 'out'], [D, 1.25, 1.25]]);
  a.alpha('rays', [0.85, 0.55, 1], [[0, 0, 'in'], [0.9, 1, 'out'], [D, 0.8]]);
  a.rot('rays', [[0, 0, 'in'], [D, -180]]);
  a.alpha('face_bloom', [1, 0.55, 0.9], [[0, 0, 'in'], [0.9, 0.55, 'out'], [D, 0.35]]);
  a.alpha('eye_l_glow', [1, 0.6, 0.9], [[0, 0.35, 'in'], [0.9, 0.75, 'out'], [D, 0.6]]);
  a.alpha('eye_r_glow', [1, 0.6, 0.9], [[0, 0.35, 'in'], [0.9, 0.75, 'out'], [D, 0.6]]);
  a.scale('eye_l', [[0, 1, 1, 'in'], [0.9, 1.6, 1.6, 'out'], [D, 1.35, 1.35]]);
  a.scale('eye_r', [[0, 1, 1, 'in'], [0.9, 1.6, 1.6, 'out'], [D, 1.35, 1.35]]);
  a.move('hat', [[0, 0, 0, 'in'], [0.9, 0, 14, 'outBack'], [1.1, 0, 40, 'inOut'], [D, 0, 30]]);
  a.rot('hat', [[0, 0, 'in'], [0.9, -6, 'outBack'], [1.2, 8, 'inOut'], [D, 4]]);
  a.show('flash', [[0, null], [0.9, 'flash'], [1.5, null]]);
  a.alpha('flash', [1, 0.85, 1], [[0, 0], [0.9, 0.85, 'out'], [1.5, 0]]);
  a.scale('flash', [[0, 1, 1], [0.9, 1, 1, 'outCubic'], [1.5, 3.2, 3.2]]);
  a.show('ring', [[0, null], [0.9, 'ring'], [1.6, null]]);
  a.alpha('ring', [0.9, 0.6, 1], [[0, 0], [0.9, 1, 'in'], [1.6, 0]]);
  a.scale('ring', [[0, 0.3, 0.3], [0.9, 0.3, 0.3, 'outCubic'], [1.6, 3, 3]]);
  a.move('bat_l', [[0, 0, 0, 'inBack'], [0.9, -120, 60, 'outCubic'], [D, -70, 40]]);
  a.move('bat_r', [[0, 0, 0, 'inBack'], [0.9, 120, 60, 'outCubic'], [D, 70, 40]]);
  flapBat(a, 'l', 0, D, 0.08, 50); flapBat(a, 'r', 0, D, 0.08, 50);
  a.color('moon', [[0, 1, 1, 1, 1, 'in'], [0.9, 1, 0.8, 1, 1], [D, 1, 0.85, 1, 1]]);
  a.alpha('moon_glow', [0.9, 0.7, 1], [[0, 0.4, 'in'], [0.9, 1, 'out'], [D, 0.8]]);
  a.move('plaque_shine', [[0, 0, 0], [0.9, 0, 0, 'inOut'], [1.4, 460, 0]]);
  a.alpha('plaque_shine', WHITE, [[0, 0], [0.9, 1], [1.4, 1, 'stepped'], [1.41, 0]]);
  [1, 2, 3, 4, 5, 6].forEach((i) => twinkle(a, i, 0.9 + (i % 3) * 0.1, 0.6));
  a.ev(0, 'charge').ev(0.9, 'trigger');
  anims.trigger = a;
}

// ---- OUTRO: departure (1.0 s)
{
  const a = new Anim();
  a.move('hat', [[0, 0, 0, 'outQuad'], [0.15, 0, -8, 'outCubic'], [0.7, 220, 330]]);
  a.rot('hat', [[0, 0], [0.15, 0, 'outCubic'], [0.7, -200]]);
  a.color('hat', [[0, 1, 1, 1, 1], [0.45, 1, 1, 1, 1, 'in'], [0.7, 1, 1, 1, 0]]);
  a.scale('body', [[0, 1, 1, 'outQuad'], [0.15, 1.18, 0.82, 'outQuad'], [0.25, 0.92, 1.08, 'inOut'], [0.3, 1, 1]]);
  a.scale('pumpkin', [[0, 1, 1], [0.25, 1, 1, 'inBack'], [0.55, 0.02, 0.02]]);
  a.rot('pumpkin', [[0, 0], [0.25, 0, 'in'], [0.55, 200]]);
  lightLevel(a, [[0, 1], [0.2, 1, 'in'], [0.4, 0]]);
  a.alpha('face_bloom', FACE, [[0, 0], [0.1, 0.8, 'in'], [0.4, 0]]);
  a.alpha('eye_l_glow', EYE, [[0, 0.35], [0.3, 0]]);
  a.alpha('eye_r_glow', EYE, [[0, 0.35], [0.3, 0]]);
  a.scale('plaque', [[0, 1, 1, 'outQuad'], [0.1, 1.06, 1.06, 'inBack'], [0.45, 1.1, 0]]);
  a.move('bat_l', [[0, 0, 0, 'inCubic'], [0.7, -280, 160]]);
  a.move('bat_r', [[0, 0, 0, 'inCubic'], [0.75, 280, 170]]);
  a.scale('bat_l', [[0, 1, 1, 'in'], [0.7, 0.4, 0.4]]);
  a.scale('bat_r', [[0, 1, 1, 'in'], [0.75, 0.4, 0.4]]);
  a.color('bat_l', [[0, 1, 1, 1, 1], [0.5, 1, 1, 1, 1, 'in'], [0.7, 1, 1, 1, 0]]);
  a.color('bat_r', [[0, 1, 1, 1, 1], [0.55, 1, 1, 1, 1, 'in'], [0.75, 1, 1, 1, 0]]);
  for (const s of ['l', 'r']) for (const w of ['wing_l', 'wing_r']) a.color(`bat_${s}_${w}`, [[0, 1, 1, 1, 1], [0.5, 1, 1, 1, 1, 'in'], [0.72, 1, 1, 1, 0]]);
  flapBat(a, 'l', 0, 0.8, 0.08, 50); flapBat(a, 'r', 0, 0.8, 0.08, 50);
  a.alpha('moon', WHITE, [[0, 1], [0.3, 1, 'in'], [0.62, 0]]);
  a.scale('moon', [[0, 1, 1], [0.3, 1, 1, 'inBack'], [0.62, 0.2, 0.2]]);
  a.alpha('moon_glow', MOONG, [[0, 0.4, 'in'], [0.5, 0]]);
  a.alpha('aura', ORANGE, [[0, 0.5, 'outQuad'], [0.25, 0.9, 'in'], [0.8, 0]]);
  puff(a, 'smoke3', 0.38, -40, 50, 'smoke_big', 0.6, WHITE, 0.95);
  puff(a, 'smoke4', 0.42, 45, 30, 'smoke_big', 0.55, WHITE, 0.95);
  puff(a, 'smoke1', 0.1, -80, 0, 'smoke_small', 0.5, WHITE, 0.7);
  puff(a, 'smoke2', 0.1, 80, 0, 'smoke_small', 0.5, WHITE, 0.7);
  a.show('flash', [[0, null], [0.5, 'flash'], [0.85, null]]);
  a.alpha('flash', [1, 0.8, 1], [[0, 0], [0.5, 0.8, 'out'], [0.85, 0]]);
  a.ev(0.15, 'hat').ev(0.5, 'vanish');
  anims.outro = a;
}

// ------------------------------------------------------------------ write
const skeleton = {
  skeleton: { hash: '', spine: '4.2.43', x: -300, y: -260, width: 600, height: 560, images: './images/', audio: '' },
  bones,
  slots,
  skins: [{ name: 'default', attachments: A }],
  events: { land: {}, ignite: {}, hat: {}, tease: {}, burst: {}, thump: {}, charge: {}, trigger: {}, vanish: {} },
  animations: Object.fromEntries(Object.entries(anims).map(([k, v]) => [k, v.json()])),
};
skeleton.skeleton.hash = crypto.createHash('sha1').update(JSON.stringify(skeleton)).digest('base64').slice(0, 11);
fs.writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(skeleton, null, 1));
console.log(`bones ${bones.length}, slots ${slots.length}, animations: ${Object.keys(anims).join(', ')}`);
console.log(`atlas ${page.w}x${page.h}, ${page.rects.length} regions; eyes`, eyeL.map(R), eyeR.map(R), 'mouth', mouth.map(R));

// metadata (same shape as the captured packages, so the gallery / index treat it the same way)
fs.writeFileSync(`${OUT}/metadata.json`, JSON.stringify({
  id: `creations/${NAME}`, package: NAME, name: NAME, game: 'Créations', game_slug: 'creations', provider: 'Scrap (création originale)',
  format: 'spine', skeleton_format: 'json', skeleton_file: `${NAME}.json`, skeleton_version: '4.2.43',
  category: 'symbol', subtypes: ['scatter', 'entrance', 'idle', 'land', 'anticipation', 'win', 'exit'], tags: ['halloween', 'scatter', 'pumpkin', 'witch', 'bat', 'ghost', 'moon', 'candy'],
  animations: Object.keys(anims), animation_details: Object.entries(skeleton.animations).map(([name, a]) => ({ name, duration: Math.max(0, ...JSON.stringify(a).match(/"time":[0-9.]+/g)?.map((s) => Number(s.slice(7))) || [0]) })),
  events: Object.keys(skeleton.events), bones_count: bones.length, slots_count: slots.length, skins: ['default'],
  atlases: [{ file: `${NAME}.atlas`, pages: [`${NAME}.png`] }], textures: [{ file: `${NAME}.png`, page: `${NAME}.png`, width: page.w, height: page.h, pma: false }],
  complete: true, warnings: [],
  usage: { tracks: { 0: 'intro -> idle (loop) | land | anticipation -> anticipation_idle (loop) -> anticipation_end | win | trigger | outro', 1: 'idle_eyes (loop, candle flicker), play together with idle' } },
  sources: 'Images: Nano Banana Pro via sjinn.ai (creations/halloween-scatter/source/prompts.jsonl). Rig & animations: build.mjs.',
}, null, 1));
