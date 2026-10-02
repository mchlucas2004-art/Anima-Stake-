// Global index across all games: index/games.json, index/assets.json, index/spine_packages.json
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GAMES_DIR, INDEX_DIR } from './lib/paths.js';
import { readJson, writeJson } from './lib/util.js';

export async function rebuildIndex() {
  let slugs = [];
  try {
    slugs = (await fsp.readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    /* no games yet */
  }
  const games = [];
  const assets = [];
  const packages = [];
  for (const slug of slugs) {
    const dir = path.join(GAMES_DIR, slug);
    const m = await readJson(path.join(dir, 'manifest.json'));
    if (!m) continue;
    games.push({
      game: m.game, slug, provider: m.provider, path: `games/${slug}`, game_urls: m.game_urls, status: m.status,
      updated_at: m.updated_at, stats: m.stats, sessions: (m.sessions || []).length,
    });
    for (const r of m.resources || []) {
      assets.push({
        game: slug, sha256: r.sha256, kind: r.kind, filename: r.filename, size: r.size, image: r.image,
        raw: `games/${slug}/${r.raw_path}`, outputs: (r.outputs || []).map((o) => `games/${slug}/${o}`), urls: r.urls, occurrences: r.occurrences,
      });
    }
    for (const p of m.packages || []) {
      const meta = await readJson(path.join(dir, 'spine', p.id.split('/')[1], 'metadata.json'));
      if (!meta) continue;
      const search = [
        meta.name, meta.game, meta.provider, meta.category, ...meta.subtypes, ...meta.tags, ...meta.animations, ...meta.skins, ...meta.events,
      ].join(' ').toLowerCase();
      packages.push({
        id: meta.id,
        path: `games/${slug}/spine/${meta.package}`,
        metadata: `games/${slug}/spine/${meta.package}/metadata.json`,
        game: meta.game,
        game_slug: slug,
        provider: meta.provider,
        name: meta.name,
        category: meta.category,
        subtypes: meta.subtypes,
        tags: meta.tags,
        confidence: meta.classification.confidence,
        skeleton_format: meta.skeleton_format,
        skeleton_version: meta.skeleton_version,
        skeleton_file: meta.skeleton_file,
        animations: meta.animation_details.length
          ? meta.animation_details.map((a) => ({ name: a.name, duration: a.duration }))
          : meta.animations.map((name) => ({ name, duration: null })),
        skins: meta.skins,
        events: meta.events,
        bones_count: meta.bones_count,
        slots_count: meta.slots_count,
        dimensions: meta.dimensions,
        textures: meta.textures.map((t) => ({ file: t.file, width: t.width, height: t.height, format: t.format })),
        atlas_files: meta.atlases.map((a) => a.file),
        complete: meta.complete,
        warnings: meta.warnings.length,
        shared_atlas_with: meta.shared_atlas_with,
        detected_at: meta.detected_at,
        search_text: search,
      });
    }
  }
  const generated_at = new Date().toISOString();
  await writeJson(path.join(INDEX_DIR, 'games.json'), { generated_at, count: games.length, games });
  await writeJson(path.join(INDEX_DIR, 'assets.json'), { generated_at, count: assets.length, assets });
  await writeJson(path.join(INDEX_DIR, 'spine_packages.json'), {
    generated_at,
    count: packages.length,
    usage:
      'Each entry points to a self-contained Spine package folder (skeleton + atlas + textures + metadata.json). ' +
      'Filter on category/subtypes/tags/animations[].name or match words against search_text. Paths are relative to the Scrap root.',
    categories: countBy(packages, (p) => p.category),
    packages,
  });
  return { games: games.length, assets: assets.length, packages: packages.length };
}

function countBy(arr, fn) {
  const out = {};
  for (const x of arr) out[fn(x)] = (out[fn(x)] || 0) + 1;
  return out;
}

/** Simple ranked search over the package index (used by `npm run search`). */
export async function searchPackages(query, { category, game, limit = 20, completeOnly = false } = {}) {
  const idx = await readJson(path.join(INDEX_DIR, 'spine_packages.json'), { packages: [] });
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const p of idx.packages) {
    if (category && p.category !== category) continue;
    if (game && p.game_slug !== game && p.game.toLowerCase() !== game.toLowerCase()) continue;
    if (completeOnly && !p.complete) continue;
    let score = 0;
    let all = true;
    for (const w of words) {
      let s = 0;
      if (p.category === w) s += 5;
      if (p.subtypes.includes(w)) s += 4;
      if (p.tags.includes(w)) s += 3;
      if (p.animations.some((a) => a.name.toLowerCase() === w)) s += 3;
      else if (p.animations.some((a) => a.name.toLowerCase().includes(w))) s += 2;
      if (!s && p.search_text.includes(w)) s += 1;
      if (!s) all = false;
      score += s;
    }
    if (!words.length || all) results.push({ score: score + (p.complete ? 0.5 : 0), p });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.p);
}
