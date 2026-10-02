// Pragmatic Play "UHT" engine resource packs -> standard Spine files.
//
// The game ships JSON packs split in numbered parts (main_resources000.json, main_resources001.json, …).
// Once concatenated, a pack is { resources: [ {type, id, data} ] } with, among others:
//   - UHTSpine   : { name, spineJSON: <base64 Spine skeleton JSON>, scale }
//   - GameObject : components; a "UIAtlas" component = { textureContent: {guid}, spriteList: { s_<region>: rect } }
//                  a spine component = { spineData: {guid -> UHTSpine}, spineAtlases: [{ atlases: [{guid -> UIAtlas GO}] }] }
//   - Texture    : { isInline, data: data-URI (png / KTX2 Basis) or "res/<id>.ktx|png" (separate file) }
// We rebuild, for every skeleton: <name>.json + <name>.atlas (Spine 3.x text format) + one PNG per atlas page.
import { ktx2ToPng, isKtx2 } from './basis.js';
import { sniffImage } from '../detect/image.js';
import { log } from '../lib/log.js';

const PART = /^(.+?)(\d{3})\.json$/i;

/** Groups numbered parts by folder + base name and returns the parsed packs. */
export function findPacks(resources, readBuf) {
  const groups = new Map();
  for (const r of resources) {
    const m = r.filename.match(PART);
    if (!m) continue;
    for (const key of r.keys) {
      const dir = key.slice(0, key.lastIndexOf('/') + 1);
      const g = `${dir}${m[1]}`;
      if (!groups.has(g)) groups.set(g, new Map());
      groups.get(g).set(Number(m[2]), r);
    }
  }
  const packs = [];
  for (const [g, parts] of groups) {
    const nums = [...parts.keys()].sort((a, b) => a - b);
    if (nums[0] !== 0) continue;
    const ordered = [];
    for (let i = 0; i < nums.length && nums[i] === i; i++) ordered.push(parts.get(i));
    try {
      const obj = JSON.parse(ordered.map((r) => readBuf(r).toString('utf8')).join(''));
      if (Array.isArray(obj?.resources)) packs.push({ id: g, dir: g.slice(0, g.lastIndexOf('/') + 1), parts: ordered, resources: obj.resources });
    } catch {
      /* incomplete pack (a part was not captured) */
    }
  }
  return packs;
}

/** Spine 3.x region lines from one UHT sprite rect (rect/paddings are expressed in the packed orientation). */
function regionLines(name, s) {
  const x = s.x || 0;
  const y = s.y || 0;
  const w = s.width || 0;
  const h = s.height || 0;
  const pl = s.paddingLeft || 0;
  const pr = s.paddingRight || 0;
  const pt = s.paddingTop || 0;
  const pb = s.paddingBottom || 0;
  const rot = !!s.rotate;
  // packed (as stored) original size
  const ow = w + pl + pr;
  const oh = h + pt + pb;
  let size;
  let orig;
  let offset;
  if (!rot) {
    size = [w, h];
    orig = [ow, oh];
    offset = [pl, pb];
  } else {
    // stored rotated 90° clockwise: original left = packed top, original bottom = packed left
    size = [h, w];
    orig = [oh, ow];
    offset = [pt, pl];
  }
  return [
    name,
    `  rotate: ${rot}`,
    `  xy: ${x}, ${y}`,
    `  size: ${size[0]}, ${size[1]}`,
    `  orig: ${orig[0]}, ${orig[1]}`,
    `  offset: ${offset[0]}, ${offset[1]}`,
    '  index: -1',
  ].join('\n');
}

/**
 * @param resources  all captured resources of the game ({filename, keys, sha, ...})
 * @param readBuf    (res) => Buffer
 * @param findByUrl  (absoluteUrl) => res | null   (for textures stored as separate files)
 * @returns { files: [{name, data, group, kind}], consumed: Set<sha>, report }
 */
export async function extractPragmatic(resources, readBuf, findByUrl) {
  const packs = findPacks(resources, readBuf);
  if (!packs.length) return null;
  const byId = new Map();
  for (const p of packs) for (const r of p.resources) if (r?.id) byId.set(r.id, { ...r, pack: p });
  const spines = [...byId.values()].filter((r) => r.type === 'UHTSpine');
  if (!spines.length) return null;

  // GameObjects: UIAtlas components and spine renderers
  const atlasGo = new Map(); // go id -> { name, textureGuid, sprites }
  const spineAtlases = new Map(); // UHTSpine id -> Set(atlas go ids)
  const pmaOf = new Map();
  for (const r of byId.values()) {
    if (r.type !== 'GameObject') continue;
    for (const root of r.data?.root || []) {
      for (const c of root.components || []) {
        const d = c.serializableData || {};
        if (c.componentType === 'UIAtlas' && d.spriteList) {
          atlasGo.set(r.id, { name: String(root.name || r.id).replace(/_Material$/i, ''), textureGuid: d.textureContent?.guid, sprites: d.spriteList });
        }
        if (d.spineData?.guid) {
          const set = spineAtlases.get(d.spineData.guid) || new Set();
          for (const a of d.spineAtlases || []) for (const ref of a.serializableData?.atlases || []) if (ref?.guid) set.add(ref.guid);
          spineAtlases.set(d.spineData.guid, set);
          if (typeof d.exportedWithPMA === 'boolean') pmaOf.set(d.spineData.guid, d.exportedWithPMA);
        }
      }
    }
  }

  const pngCache = new Map(); // texture guid -> { png, width, height } | null
  async function texturePng(guid) {
    if (pngCache.has(guid)) return pngCache.get(guid);
    let out = null;
    const t = byId.get(guid);
    try {
      let buf = null;
      if (t?.type === 'Texture') {
        if (t.isInline || String(t.data).startsWith('data:')) buf = Buffer.from(String(t.data).split(',')[1] || '', 'base64');
        else {
          const target = new URL(String(t.data), t.pack.dir.replace(/^embedded:/, 'https:')).toString();
          const res = findByUrl(target) || findByUrl(target.replace(/\.ktx$/i, '.png')) || findByUrl(target.replace(/\.png$/i, '.ktx'));
          if (res) buf = readBuf(res);
        }
      }
      if (buf && isKtx2(buf)) out = await ktx2ToPng(buf);
      else if (buf) {
        const im = sniffImage(buf);
        if (im?.format === 'png' || im?.format === 'jpeg' || im?.format === 'webp') out = { png: buf, width: im.width, height: im.height, ext: im.format === 'jpeg' ? 'jpg' : im.format };
      }
    } catch (e) {
      log.warn(`Pragmatic texture ${guid}: ${e.message}`);
    }
    pngCache.set(guid, out);
    return out;
  }

  const files = [];
  const report = { skeletons: 0, rebuilt: 0, missingTextures: 0 };
  for (const s of spines) {
    let json;
    try {
      json = Buffer.from(s.data.spineJSON, 'base64');
      JSON.parse(json.toString('utf8'));
    } catch {
      continue;
    }
    report.skeletons++;
    const name = String(s.data.name || s.id).replace(/_SkeletonData$/i, '').replace(/[^\w.-]+/g, '_');
    files.push({ name: `${name}.json`, data: json, group: s.id, kind: 'skeleton' });
    const atlasIds = [...(spineAtlases.get(s.id) || [])].filter((id) => atlasGo.has(id));
    if (!atlasIds.length) continue;
    const pages = [];
    for (const id of atlasIds) {
      const a = atlasGo.get(id);
      const tex = a.textureGuid ? await texturePng(a.textureGuid) : null;
      if (!tex) {
        report.missingTextures++;
        continue;
      }
      const pageName = `${a.name}.${tex.ext || 'png'}`;
      files.push({ name: pageName, data: tex.png, group: s.id, kind: 'texture' });
      const regions = Object.entries(a.sprites).map(([k, rect]) => regionLines(k.replace(/^s_/, ''), rect));
      pages.push(`\n${pageName}\nsize: ${tex.width},${tex.height}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${regions.join('\n')}\n`);
    }
    if (pages.length) {
      files.push({ name: `${name}.atlas`, data: Buffer.from(pages.join('')), group: s.id, kind: 'atlas', pma: pmaOf.get(s.id) ?? false });
      report.rebuilt++;
    }
  }
  const consumed = new Set(packs.flatMap((p) => p.parts.map((r) => r.sha)));
  return { files, consumed, report };
}
