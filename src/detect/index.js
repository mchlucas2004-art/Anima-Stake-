// Content-based classification of a captured resource. Extensions and content-types are hints only.
import { sniffImage } from './image.js';
import { parseAtlas } from './atlas.js';
import { isSpineJson, extractSpineInfo, spineJsonScore } from './spine-json.js';
import { detectSkel } from './skel.js';
import { extOf } from '../lib/util.js';

function looksText(buf) {
  const n = Math.min(buf.length, 4096);
  if (!n) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl / n < 0.01;
}

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

function isSpritesheet(obj) {
  return isObj(obj) && (isObj(obj.frames) || Array.isArray(obj.frames)) && isObj(obj.meta) && ('image' in obj.meta || 'app' in obj.meta);
}

function isDragonBones(obj) {
  return isObj(obj) && Array.isArray(obj.armature) && ('frameRate' in obj || 'version' in obj);
}

const stripKind = (k) => String(k).replace(/[._-](png|jpe?g|webp|atlas|json|skel|txt)$/i, '');

/**
 * Finds Spine data embedded inside a larger JSON (asset bundles): skeleton objects,
 * atlas text in string values and data-URI images. Bounded walk.
 */
export function findEmbedded(root) {
  const found = [];
  let visited = 0;
  const walk = (node, keyPath, depth) => {
    if (visited++ > 200000 || depth > 6 || found.length > 500) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...keyPath, i], depth + 1));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const p = [...keyPath, k];
      if (isObj(v) && isSpineJson(v)) {
        found.push({ type: 'spine-json', key: k, path: p, data: Buffer.from(JSON.stringify(v)) });
      } else if (typeof v === 'string') {
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) {
          const data = Buffer.from(v.slice(v.indexOf(',') + 1), 'base64');
          if (sniffImage(data)) found.push({ type: 'image', key: k, path: p, data });
        } else if (v.length > 30 && v.includes('\n') && parseAtlas(v)) {
          found.push({ type: 'spine-atlas', key: k, path: p, data: Buffer.from(v) });
        }
      } else if (v && typeof v === 'object') walk(v, p, depth + 1);
    }
  };
  walk(root, [], 0);
  // Name each embedded file after its key (or the parent key for array items / generic keys).
  for (const f of found) {
    const named = [...f.path].reverse().find((x) => typeof x === 'string' && !/^(data|json|atlas|image|texture|skeleton|src|content)$/i.test(x));
    const base = stripKind(named ?? f.key ?? 'embedded');
    const ext = f.type === 'spine-json' ? '.json' : f.type === 'spine-atlas' ? '.atlas' : '.' + (sniffImage(f.data)?.format || 'png').replace('jpeg', 'jpg');
    f.name = base + ext;
    f.jsonPath = f.path.map((x) => (typeof x === 'number' ? `[${x}]` : `.${x}`)).join('');
  }
  return found;
}

export function detectJsonObject(obj) {
  if (isSpineJson(obj)) return { kind: 'spine-json', spine: extractSpineInfo(obj), score: spineJsonScore(obj) };
  if (isSpritesheet(obj))
    return {
      kind: 'spritesheet',
      sheet: {
        image: obj.meta.image || null,
        frames: Array.isArray(obj.frames) ? obj.frames.length : Object.keys(obj.frames).length,
        size: obj.meta.size || null,
        app: obj.meta.app || null,
        animations: isObj(obj.animations) ? Object.keys(obj.animations) : [],
        related: obj.meta.related_multi_packs || [],
      },
    };
  if (isDragonBones(obj)) return { kind: 'dragonbones', armatures: obj.armature.map((a) => a?.name).filter(Boolean) };
  const embedded = findEmbedded(obj);
  if (embedded.length) return { kind: 'json-bundle', embedded };
  return { kind: 'json' };
}

/**
 * kinds: image | texture | spine-json | spine-atlas | spine-skel | spritesheet | dragonbones |
 *        json-bundle | json | text | binary
 */
export function detect(buf, { filename = '' } = {}) {
  const ext = extOf(filename);
  const img = sniffImage(buf);
  if (img) return { kind: img.compressed ? 'texture' : 'image', image: img };
  if (looksText(buf)) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const t = text.trimStart();
    if (t[0] === '{' || t[0] === '[') {
      try {
        return detectJsonObject(JSON.parse(text));
      } catch {
        /* not JSON after all */
      }
    }
    const atlas = parseAtlas(text);
    if (atlas) return { kind: 'spine-atlas', atlas };
    return { kind: 'text' };
  }
  const skel = detectSkel(buf, ext);
  if (skel) return { kind: 'spine-skel', skel };
  return { kind: 'binary' };
}

export const isSkeletonKind = (k) => k === 'spine-json' || k === 'spine-skel';
