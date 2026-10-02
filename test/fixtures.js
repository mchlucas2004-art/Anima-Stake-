// Synthetic "casino + game" used by the offline end-to-end test. Everything is generated in memory.
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function makeWebpHeader(w, h) {
  const body = Buffer.alloc(16);
  body[0] = 0x2f;
  body.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  const chunkHdr = Buffer.concat([Buffer.from('VP8L'), Buffer.from([16, 0, 0, 0])]);
  const riffBody = Buffer.concat([Buffer.from('WEBP'), chunkHdr, body]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(riffBody.length);
  return Buffer.concat([Buffer.from('RIFF'), size, riffBody]);
}

function skeleton({ version, bones, slots, anims, skinsAsObject = false, extra = {} }) {
  const attachments = {};
  for (const s of slots) attachments[s.name] = s.attachments;
  const animations = {};
  for (const [name, dur] of Object.entries(anims))
    animations[name] = { bones: { [bones[0]]: { rotate: [{ time: 0, angle: 0 }, { time: dur, angle: 10 }] } } };
  return {
    skeleton: { hash: 'abc', spine: version, width: 200, height: 300, images: './images/' },
    bones: bones.map((n, i) => (i ? { name: n, parent: bones[0] } : { name: n })),
    slots: slots.map((s) => ({ name: s.name, bone: s.bone || bones[0], attachment: Object.keys(s.attachments)[0] })),
    skins: skinsAsObject ? { default: attachments } : [{ name: 'default', attachments }],
    animations,
    ...extra,
  };
}

const region = (w = 10, h = 10) => ({ width: w, height: h });

function atlas4(pages) {
  return pages
    .map((p) => `${p.name}\nsize:${p.size[0]},${p.size[1]}\nfilter:Linear,Linear\npma:true\n` + p.regions.map((r, i) => `${r}\nbounds:${i * 2},0,2,2\n`).join(''))
    .join('\n');
}
function atlas3(pages) {
  return pages
    .map((p) => `\n${p.name}\nsize: ${p.size[0]},${p.size[1]}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n` + p.regions.map((r, i) => `${r}\n  rotate: false\n  xy: ${i * 2}, 0\n  size: 2, 2\n  orig: 2, 2\n  offset: 0, 0\n  index: -1\n`).join(''))
    .join('');
}

function varintStr(s) {
  return Buffer.concat([Buffer.from([s.length + 1]), Buffer.from(s)]);
}
function skelBinary(version, names) {
  const floats = Buffer.alloc(16);
  floats.writeFloatBE(0, 0);
  floats.writeFloatBE(0, 4);
  floats.writeFloatBE(512, 8);
  floats.writeFloatBE(256, 12);
  return Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), varintStr(version), floats, Buffer.from([0, 30, names.length]), ...names.map(varintStr), Buffer.from([0, 0, 0, 1])]);
}

export const SECRET = 'SeCrEtToKeN0123456789abcdefXYZ';

export function buildFixtures(gameOrigin) {
  const F = {};
  const put = (p, body, type) => (F[p] = { body: Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), type });

  // character, 2-page atlas, Spine 4.1
  put('/game/assets/characters/hero.json', skeleton({
    version: '4.1.24',
    bones: ['root', 'hip', 'torso', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'eye'],
    slots: [
      { name: 'head', bone: 'head', attachments: { head: region() } },
      { name: 'torso', bone: 'torso', attachments: { torso: { type: 'mesh', path: 'torso', uvs: [], vertices: [], triangles: [] } } },
      { name: 'arm_l', bone: 'arm_l', attachments: { arm_l: region() } },
      { name: 'arm_r', bone: 'arm_r', attachments: { arm_r: region() } },
      { name: 'leg_l', bone: 'leg_l', attachments: { leg_l: region() } },
      { name: 'leg_r', bone: 'leg_r', attachments: { leg_r: region() } },
      { name: 'eye', bone: 'eye', attachments: { eye: region(), hitbox: { type: 'boundingbox', vertexCount: 3, vertices: [] } } },
    ],
    anims: { idle: 2, walk: 1, win: 3, reaction_happy: 1.5 },
    extra: { events: { footstep: {} } },
  }), 'application/json');
  put('/game/assets/characters/hero.atlas', atlas4([
    { name: 'hero.png', size: [64, 64], regions: ['head', 'torso', 'arm_l', 'arm_r'] },
    { name: 'hero_2.png', size: [32, 32], regions: ['leg_l', 'leg_r', 'eye'] },
  ]), 'text/plain');
  put('/game/assets/characters/hero.png', makePng(64, 64, [200, 100, 50]), 'image/png');
  put('/game/assets/characters/hero_2.png', makePng(32, 32, [50, 100, 200]), 'image/png');

  // two symbols sharing one atlas (Spine 3.8 format), texture served as WebP while the atlas says .png
  for (const s of ['h1', 'h2'])
    put(`/game/assets/symbols/sym_${s}.json`, skeleton({
      version: '3.8.99', bones: ['root', `${s}_bone`],
      slots: [{ name: s, attachments: { [s]: region() } }, { name: `${s}_glow`, attachments: { [`${s}_glow`]: region() } }],
      anims: { idle: 1, win: 2, land: 0.5 },
    }), 'application/json');
  put('/game/assets/symbols/symbols.atlas', atlas3([{ name: 'symbols.png', size: [128, 128], regions: ['h1', 'h1_glow', 'h2', 'h2_glow', 'wild'] }]), 'application/octet-stream');
  put('/game/assets/symbols/symbols.webp', makeWebpHeader(128, 128), 'image/webp');

  // effect with hashed file names and a 4.1 sequence attachment
  put('/game/assets/fx/fire-3f9a2c1d.json', skeleton({
    version: '4.2.11', bones: ['root'],
    slots: [{ name: 'flame', attachments: { flame: { path: 'flame_', sequence: { count: 3, start: 1, digits: 2 } } } }, { name: 'spark', attachments: { spark: region() } }],
    anims: { burn_loop: 1.2, explode: 0.8 },
  }), 'application/json');
  put('/game/assets/fx/fire-77aa21bc.atlas', atlas4([{ name: 'fire.png', size: [32, 32], regions: ['flame_01', 'flame_02', 'flame_03', 'spark'] }]), 'text/plain');
  put('/game/assets/fx/fire.png', makePng(32, 32, [255, 120, 0]), 'image/png');

  // binary skeleton (background)
  put('/game/assets/bg/background.skel', skelBinary('4.1.24', ['sky', 'clouds', 'mountain']), 'application/octet-stream');
  put('/game/assets/bg/background.atlas', atlas4([{ name: 'background.png', size: [16, 16], regions: ['sky', 'clouds', 'mountain'] }]), 'text/plain');
  put('/game/assets/bg/background.png', makePng(16, 16, [10, 10, 80]), 'image/png');

  // lazy-loaded big win: its texture is never requested by the page -> completion probe
  put('/game/assets/bigwin/bigwin.json', skeleton({
    version: '4.1.24', bones: ['root'], slots: [{ name: 'banner', attachments: { banner: region(), coins: region() } }],
    anims: { bigwin_intro: 1, bigwin_loop: 2, megawin_loop: 2, outro: 1 },
  }), 'application/json');
  put('/game/assets/bigwin/bigwin.atlas', atlas4([{ name: 'bigwin.png', size: [16, 16], regions: ['banner', 'coins'] }]), 'text/plain');
  put('/game/assets/bigwin/bigwin.png', makePng(16, 16, [255, 215, 0]), 'image/png');

  // same file name, different content
  put('/game/assets/ui/logo.png', makePng(16, 16, [255, 0, 0]), 'image/png');
  put('/game/assets/promo/logo.png', makePng(8, 8, [0, 0, 255]), 'image/png');

  // non-Spine JSON, TexturePacker sheet, atlas without skeleton, skeleton without atlas
  put('/game/config.json', { lines: 20, bet: [0.2, 1, 5], skeleton: 'not a spine file' }, 'application/json');
  put('/game/assets/ui/buttons.json', { frames: { 'spin.png': { frame: { x: 0, y: 0, w: 8, h: 8 } } }, meta: { app: 'https://www.codeandweb.com/texturepacker', image: 'buttons.png', size: { w: 8, h: 8 } } }, 'application/json');
  put('/game/assets/ui/buttons.png', makePng(8, 8, [0, 255, 0]), 'image/png');
  put('/game/assets/ui/hud.atlas', atlas4([{ name: 'hud.png', size: [8, 8], regions: ['btn_spin', 'btn_bet'] }]), 'text/plain');
  put('/game/assets/ui/hud.png', makePng(8, 8, [9, 9, 9]), 'image/png');
  put('/game/assets/misc/ghost.json', skeleton({ version: '4.1.24', bones: ['root'], slots: [{ name: 'g', attachments: { ghost_body: region() } }], anims: { float: 2 } }), 'application/json');

  // bundle with an embedded skeleton + atlas text + data-URI texture
  put('/game/assets/bundle/coin_bundle.json', {
    version: 3,
    coin: skeleton({ version: '4.1.24', bones: ['root'], slots: [{ name: 'coin', attachments: { coin_face: region() } }], anims: { spin: 1, sparkle: 0.5 } }),
    coin_atlas: 'coin.png\nsize:16,16\nfilter:Linear,Linear\ncoin_face\nbounds:0,0,16,16\n',
    coin_png: 'data:image/png;base64,' + makePng(16, 16, [250, 200, 0]).toString('base64'),
  }, 'application/json');

  const fetchList = [
    'assets/characters/hero.json', 'assets/characters/hero.atlas', 'assets/characters/hero.png', 'assets/characters/hero_2.png',
    'assets/characters/hero.json?v=2',
    'assets/symbols/sym_h1.json', 'assets/symbols/sym_h2.json', 'assets/symbols/symbols.atlas', 'assets/symbols/symbols.webp',
    'assets/fx/fire-3f9a2c1d.json', 'assets/fx/fire-77aa21bc.atlas', 'assets/fx/fire.png',
    'assets/bg/background.skel', 'assets/bg/background.atlas', 'assets/bg/background.png',
    `assets/ui/logo.png?sessionToken=${SECRET}`, 'assets/promo/logo.png',
    'config.json', 'assets/ui/buttons.json', 'assets/ui/buttons.png', 'assets/ui/hud.atlas', 'assets/ui/hud.png', 'assets/misc/ghost.json',
    'assets/bundle/coin_bundle.json',
  ];
  put('/game/index.html', `<!doctype html><html><body><h1>Fake game</h1><script>
    const list = ${JSON.stringify(fetchList)};
    Promise.all(list.map(u => fetch(u).then(r => r.arrayBuffer())));
    setTimeout(() => { fetch('assets/bigwin/bigwin.json'); fetch('assets/bigwin/bigwin.atlas'); }, 5000);
  </script></body></html>`, 'text/html');

  return F;
}

export function sitePage(gameOrigin) {
  return `<!doctype html><html><head><title>Test Slot - Stake</title></head><body>
    <img src="/thumbs/other-game.png">
    <iframe src="${gameOrigin}/game/index.html?token=${SECRET}" width="800" height="600"></iframe>
  </body></html>`;
}
