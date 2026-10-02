// Rebuilds Spine packages from loose resources.
// Primary evidence is CONTENT (atlas region names vs. skeleton attachment names, atlas page names),
// secondary evidence is LOCATION (same CDN folder, relative URL), NAME (same stem) and TIME (loaded together).
import path from 'node:path';
import { stemOf, resolveRelative } from '../lib/util.js';

/** How well an atlas covers what a skeleton needs. */
export function coverage(skelDet, atlas) {
  if (skelDet.kind === 'spine-json') {
    const req = skelDet.spine.requiredRegions;
    if (!req.size) return { ratio: null, matched: 0, total: 0, side: 'skeleton', missing: [] };
    let matched = 0;
    const missing = [];
    for (const r of req) {
      if (atlas.regionNames.has(r)) matched++;
      else if (missing.length < 40) missing.push(r);
    }
    return { ratio: matched / req.size, matched, total: req.size, side: 'skeleton', missing };
  }
  // Binary skeleton: we only have the strings it contains. Measure the share of atlas regions it names.
  const strings = skelDet.skel.strings;
  const total = atlas.baseNames.size;
  if (!total) return { ratio: null, matched: 0, total: 0, side: 'atlas', missing: [] };
  let matched = 0;
  for (const n of atlas.baseNames) if (strings.has(n)) matched++;
  return { ratio: matched / total, matched, total, side: 'atlas', missing: [] };
}

function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.5;
  return 0;
}

const intersects = (a, b) => [...a].some((x) => b.has(x));

/**
 * Picks the atlas(es) of one skeleton.
 * Returns { chosen: [{res, cov, score, evidence}], alternatives: [...], mode }
 */
export function matchSkeletonAtlases(skel, atlases) {
  const cands = atlases.map((a) => {
    const cov = coverage(skel.det, a.det.atlas);
    const ns = nameScore(skel.stem, a.stem);
    const sameDir = intersects(skel.dirs, a.dirs) ? 1 : 0;
    const dt = Math.abs((skel.first_ts ?? 0) - (a.first_ts ?? 0));
    const timeClose = dt <= 5000 ? 1 : 0;
    const score = (cov.ratio ?? 0) * 100 + ns * 25 + sameDir * 10 + timeClose * 5;
    const evidence = [];
    if (cov.ratio != null) evidence.push(`regions ${cov.matched}/${cov.total} (${Math.round(cov.ratio * 100)}% of ${cov.side})`);
    if (ns === 1) evidence.push('same base name');
    else if (ns) evidence.push('similar base name');
    if (sameDir) evidence.push('same folder');
    if (timeClose) evidence.push(`loaded ${Math.round(dt)}ms apart`);
    return { res: a, cov, ns, sameDir, timeClose, score, evidence };
  });

  const isJson = skel.det.kind === 'spine-json';
  const accept = (c) => {
    const r = c.cov.ratio;
    if (isJson) return (r != null && r >= 0.6) || (r == null && c.ns === 1);
    return (r != null && r >= 0.5) || (c.cov.matched >= 3 && (c.ns > 0 || c.sameDir)) || (c.ns === 1 && c.sameDir);
  };
  const accepted = cands.filter(accept).sort((a, b) => b.score - a.score);
  const chosen = [];
  if (accepted.length) chosen.push(accepted[0]);

  // A skeleton can span several atlases: greedily add atlases covering what is still missing.
  if (isJson && chosen.length && chosen[0].cov.ratio != null && chosen[0].cov.ratio < 0.999) {
    const remaining = new Set([...skel.det.spine.requiredRegions].filter((r) => !chosen[0].res.det.atlas.regionNames.has(r)));
    const pool = cands.filter((c) => c !== chosen[0]);
    while (remaining.size && chosen.length < 5) {
      let best = null;
      let bestGain = 0;
      for (const c of pool) {
        if (chosen.includes(c)) continue;
        let gain = 0;
        for (const r of remaining) if (c.res.det.atlas.regionNames.has(r)) gain++;
        if (gain > bestGain || (gain === bestGain && best && c.score > best.score)) {
          best = c;
          bestGain = gain;
        }
      }
      if (!best || (bestGain < 3 && bestGain / remaining.size < 0.1)) break;
      best.evidence.push(`adds ${bestGain} missing regions`);
      chosen.push(best);
      for (const r of [...remaining]) if (best.res.det.atlas.regionNames.has(r)) remaining.delete(r);
    }
  }

  // Same atlas at another resolution / duplicated in another folder: keep track, do not merge.
  const alternatives = cands
    .filter((c) => !chosen.includes(c) && c.cov.ratio != null && c.cov.ratio >= 0.9)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { chosen, alternatives };
}

export function buildImageIndex(images) {
  const add = (m, k, v) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };
  const idx = { byKey: new Map(), byDirStem: new Map(), byName: new Map(), byStem: new Map() };
  for (const img of images) {
    for (const k of img.keys) add(idx.byKey, k, img);
    for (const d of img.dirs) add(idx.byDirStem, d + '|' + img.stem, img);
    for (const n of img.filenames) add(idx.byName, n.toLowerCase(), img);
    add(idx.byStem, img.stem, img);
  }
  return idx;
}

function pickBest(list, page, ref) {
  const uniqueList = [...new Set(list)];
  const sizeOk = (img) => page.size && img.det.image?.width === page.size[0] && img.det.image?.height === page.size[1];
  return uniqueList.sort((a, b) => {
    const s = (sizeOk(b) ? 1 : 0) - (sizeOk(a) ? 1 : 0);
    if (s) return s;
    return Math.abs((a.first_ts ?? 0) - (ref.first_ts ?? 0)) - Math.abs((b.first_ts ?? 0) - (ref.first_ts ?? 0));
  })[0];
}

/** Finds the captured image for every page of an atlas. */
export function resolveAtlasPages(atlasRes, imgIdx) {
  return atlasRes.det.atlas.pages.map((page) => {
    const pageStem = stemOf(page.name);
    const pageBase = path.posix.basename(page.name).toLowerCase();
    let found = [];
    let method = null;
    for (const key of atlasRes.keys) {
      const target = resolveRelative(page.name, key);
      if (target && imgIdx.byKey.has(target)) {
        found.push(...imgIdx.byKey.get(target));
        method = 'exact_relative_url';
      }
    }
    if (!found.length) {
      for (const key of atlasRes.keys) {
        const target = resolveRelative(page.name, key);
        if (!target) continue;
        const dir = target.slice(0, target.lastIndexOf('/') + 1);
        const hits = imgIdx.byDirStem.get(dir + '|' + pageStem);
        if (hits) found.push(...hits);
      }
      if (found.length) method = 'same_folder_variant'; // e.g. .webp served instead of .png, or hashed name
    }
    if (!found.length && imgIdx.byName.has(pageBase)) {
      found = imgIdx.byName.get(pageBase);
      method = 'same_filename_other_folder';
    }
    if (!found.length && imgIdx.byStem.has(pageStem)) {
      found = imgIdx.byStem.get(pageStem);
      method = 'same_stem_other_folder';
    }
    const img = found.length ? pickBest(found, page, atlasRes) : null;
    const dims = img?.det.image;
    let sizeMatch = null;
    if (img && page.size && dims?.width) sizeMatch = dims.width === page.size[0] && dims.height === page.size[1];
    return { page, img, method, sizeMatch, ambiguous: new Set(found).size > 1 };
  });
}

/** Fallback when no atlas exists: one image per attachment (some engines load textures individually). */
export function matchLooseImages(skel, imgIdx) {
  if (skel.det.kind !== 'spine-json') return null;
  const req = skel.det.spine.requiredRegions;
  if (!req.size) return null;
  const hits = new Map();
  for (const r of req) {
    const stem = stemOf(path.posix.basename(r) + '.png');
    const list = imgIdx.byStem.get(stem);
    if (list) {
      const sameDir = list.filter((i) => intersects(i.dirs, skel.dirs) || [...i.dirs].some((d) => [...skel.dirs].some((s) => d.startsWith(s))));
      hits.set(r, (sameDir.length ? sameDir : list)[0]);
    }
  }
  if (hits.size / req.size < 0.5) return null;
  return { hits, ratio: hits.size / req.size };
}
