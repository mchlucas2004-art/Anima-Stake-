// Spine skeleton JSON recognition and metadata extraction (Spine 2.x -> 4.2).

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

/** Heuristic score; >= 6 means "this is a Spine skeleton". A random JSON scores ~0. */
export function spineJsonScore(obj) {
  if (!isObj(obj)) return 0;
  let s = 0;
  const sk = obj.skeleton;
  if (isObj(sk) && typeof sk.spine === 'string') s += 5;
  else if (isObj(sk) && ('hash' in sk || 'images' in sk || 'width' in sk)) s += 2;
  if (Array.isArray(obj.bones) && obj.bones.length && obj.bones.every((b) => isObj(b) && typeof b.name === 'string')) s += 3;
  if (Array.isArray(obj.slots) && obj.slots.every((x) => isObj(x) && typeof x.name === 'string' && 'bone' in x)) s += 3;
  if (Array.isArray(obj.skins) || isObj(obj.skins)) s += 1;
  if (isObj(obj.animations)) s += 1;
  if (Array.isArray(obj.ik) || Array.isArray(obj.transform) || Array.isArray(obj.path) || Array.isArray(obj.physics)) s += 1;
  if (isObj(obj.events)) s += 0.5;
  return s;
}

export const isSpineJson = (obj) => spineJsonScore(obj) >= 6;

const REGION_TYPES = new Set(['region', 'mesh', 'linkedmesh', 'skinnedmesh', 'weightedmesh', 'weightedlinkedmesh']);

/** Yields [skinName, slotName, attachmentKey, attachment] for 3.8+ (array) and older (object) skins. */
function* iterAttachments(skins) {
  if (Array.isArray(skins)) {
    for (const skin of skins) {
      if (!isObj(skin) || !isObj(skin.attachments)) continue;
      for (const [slot, atts] of Object.entries(skin.attachments))
        if (isObj(atts)) for (const [k, a] of Object.entries(atts)) yield [skin.name, slot, k, a];
    }
  } else if (isObj(skins)) {
    for (const [skinName, slots] of Object.entries(skins)) {
      if (!isObj(slots)) continue;
      for (const [slot, atts] of Object.entries(slots))
        if (isObj(atts)) for (const [k, a] of Object.entries(atts)) yield [skinName, slot, k, a];
    }
  }
}

function maxTime(node, depth = 0) {
  if (depth > 12 || node == null || typeof node !== 'object') return 0;
  let m = 0;
  if (Array.isArray(node)) {
    for (const x of node) m = Math.max(m, maxTime(x, depth + 1));
    return m;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'time' && typeof v === 'number') m = Math.max(m, v);
    else if (v && typeof v === 'object') m = Math.max(m, maxTime(v, depth + 1));
  }
  return m;
}

function timelineSummary(anim) {
  const out = {};
  for (const k of ['bones', 'slots', 'deform', 'attachments', 'ik', 'transform', 'path', 'physics', 'drawOrder', 'draworder', 'events']) {
    const v = anim[k];
    if (v == null) continue;
    out[k] = Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 1;
  }
  return out;
}

export function extractSpineInfo(obj) {
  const sk = isObj(obj.skeleton) ? obj.skeleton : {};
  const bones = Array.isArray(obj.bones) ? obj.bones.map((b) => b.name) : [];
  const slots = Array.isArray(obj.slots) ? obj.slots.map((s) => s.name) : [];
  const skins = Array.isArray(obj.skins) ? obj.skins.map((s) => s?.name).filter(Boolean) : isObj(obj.skins) ? Object.keys(obj.skins) : [];
  const animations = isObj(obj.animations)
    ? Object.entries(obj.animations).map(([name, a]) => ({
        name,
        duration: Math.round(maxTime(a) * 1000) / 1000,
        timelines: isObj(a) ? timelineSummary(a) : {},
      }))
    : [];

  const required = new Set();
  const attachmentTypes = {};
  let attachments = 0;
  for (const [, , key, att] of iterAttachments(obj.skins)) {
    attachments++;
    const a = isObj(att) ? att : {};
    const type = (a.type || 'region').toLowerCase();
    attachmentTypes[type] = (attachmentTypes[type] || 0) + 1;
    if (!REGION_TYPES.has(type)) continue;
    const base = String(a.path || a.name || key).toLowerCase();
    if (isObj(a.sequence)) {
      const count = a.sequence.count || 1;
      const start = a.sequence.start ?? 1;
      const digits = a.sequence.digits || 0;
      for (let i = 0; i < count; i++) required.add(base + String(start + i).padStart(digits, '0'));
    } else required.add(base);
  }

  return {
    version: typeof sk.spine === 'string' ? sk.spine : null,
    hash: sk.hash || null,
    width: sk.width ?? null,
    height: sk.height ?? null,
    fps: sk.fps ?? null,
    imagesPath: sk.images || null,
    bones,
    slots,
    skins,
    animations,
    events: isObj(obj.events) ? Object.keys(obj.events) : [],
    constraints: {
      ik: Array.isArray(obj.ik) ? obj.ik.length : 0,
      transform: Array.isArray(obj.transform) ? obj.transform.length : 0,
      path: Array.isArray(obj.path) ? obj.path.length : 0,
      physics: Array.isArray(obj.physics) ? obj.physics.length : 0,
    },
    attachments,
    attachmentTypes,
    requiredRegions: required, // Set<string>, lower-case
  };
}
