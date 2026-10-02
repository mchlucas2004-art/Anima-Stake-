// Turns the raw captured resources of one game into the organised library:
//   spine/package_NNN_name/  images/  other/  manifest.json
// Derived folders are fully regenerated from raw/ + network/resources.jsonl (raw/ is never modified).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { gameDir } from '../lib/paths.js';
import { log } from '../lib/log.js';
import {
  readJsonl, readJson, writeJson, sha256, urlKey, stemOf, dirOfKey, extOf, safeSegment, linkOrCopy, uniqueName, hostOf, countLines, iso, resolveRelative,
} from '../lib/util.js';
import { detect } from '../detect/index.js';
import { GameStore } from '../store.js';
import { matchSkeletonAtlases, buildImageIndex, resolveAtlasPages, matchLooseImages } from './associate.js';
import { classifyPackage } from './classify.js';
import { providerFromHosts, providerFromUrl } from '../providers.js';
import { extractPragmatic } from '../vendors/pragmatic.js';
import { ktx2ToPng, isKtx2 } from '../vendors/basis.js';
import fs from 'node:fs';

const pad3 = (n) => String(n).padStart(3, '0');

async function loadResources(dir) {
  const records = await readJsonl(path.join(dir, 'network', 'resources.jsonl'));
  const bySha = new Map();
  for (const r of records) {
    if (!r.sha256) continue;
    let res = bySha.get(r.sha256);
    if (!res) {
      res = {
        sha: r.sha256, size: r.size, raw_path: r.raw_path, filenames: new Set(), keys: new Set(), urls: new Set(),
        occurrences: [], sources: new Set(), sessions: new Set(), content_types: new Set(), first_ts: Infinity,
      };
      bySha.set(r.sha256, res);
    }
    if (r.filename) res.filenames.add(r.filename);
    if (r.url_key) res.keys.add(r.url_key);
    if (r.url) res.urls.add(r.url);
    if (r.source) res.sources.add(r.source);
    if (r.session) res.sessions.add(r.session);
    if (r.content_type) res.content_types.add(r.content_type);
    const ts = Date.parse(r.ts_response || r.ts_request || '') || null;
    if (ts && ts < res.first_ts) res.first_ts = ts;
    res.occurrences.push({ url: r.url, ts: r.ts_response || r.ts_request, session: r.session, source: r.source });
  }
  for (const res of bySha.values()) finalizeRes(res);
  return { bySha, recordCount: records.length };
}

function finalizeRes(res) {
  if (res.first_ts === Infinity) res.first_ts = null;
  res.filename = [...res.filenames][0] || path.posix.basename(res.raw_path);
  res.stem = stemOf(res.filename);
  res.keys = [...res.keys];
  res.dirs = new Set(res.keys.map(dirOfKey));
  return res;
}

/** Last two folders of the URL: often "symbols/", "characters/hero/", "fx/"… */
function urlHint(res) {
  const k = res.keys[0] || '';
  try {
    const segs = new URL(k).pathname.split('/').filter(Boolean);
    segs.pop();
    return segs.slice(-2).join('/');
  } catch {
    return '';
  }
}

export async function buildGame(slug, { game = slug, provider = null, gameUrls = [], session = null } = {}) {
  const dir = gameDir(slug);
  const store = await new GameStore(slug).init();
  const prev = (await readJson(path.join(dir, 'manifest.json'), {})) || {};
  const prevIds = prev.ids || {};
  const errors = [];
  const warnings = [];

  const { bySha } = await loadResources(dir);

  // ---------- 1. detection (content based) + extraction of embedded resources ----------
  const all = [];
  for (const res of bySha.values()) {
    let buf;
    try {
      buf = await fsp.readFile(path.join(dir, res.raw_path));
    } catch {
      errors.push({ type: 'missing_raw_file', raw_path: res.raw_path, sha256: res.sha });
      continue;
    }
    if (buf.length === 0) {
      warnings.push({ type: 'empty_body_ignored', urls: [...res.urls].slice(0, 20) });
      continue;
    }
    if (sha256(buf) !== res.sha) {
      errors.push({ type: 'raw_file_changed_or_corrupt', raw_path: res.raw_path, sha256: res.sha });
      continue;
    }
    try {
      res.det = detect(buf, { filename: res.filename });
    } catch (e) {
      res.det = { kind: 'binary' };
      warnings.push({ type: 'detect_failed', raw_path: res.raw_path, message: e.message });
    }
    all.push(res);
    if (res.det.kind === 'json-bundle') {
      for (const e of res.det.embedded) {
        const esha = sha256(e.data);
        if (bySha.has(esha) || all.some((r) => r.sha === esha)) continue;
        const key = `embedded://${res.sha.slice(0, 12)}/${e.name}`;
        const { raw_path } = await store.writeRaw(e.data, key, e.name, esha);
        const v = finalizeRes({
          sha: esha, size: e.data.length, raw_path, filenames: new Set([e.name]), keys: new Set([key]), urls: new Set(res.urls),
          occurrences: [], sources: new Set(['embedded']), sessions: res.sessions, content_types: new Set(), first_ts: res.first_ts ?? Infinity,
        });
        v.embedded_from = { sha256: res.sha, raw_path: res.raw_path, json_path: e.jsonPath };
        v.det = detect(e.data, { filename: e.name });
        all.push(v);
      }
    }
  }

  // ---------- 1b. engine-specific packs (Pragmatic Play UHT: Spine hidden in split JSON packs) ----------
  try {
    const keyIndex = new Map();
    for (const r of all) for (const k of r.keys) keyIndex.set(k, r);
    const readBuf = (r) => fs.readFileSync(path.join(dir, r.raw_path));
    const vendor = await extractPragmatic(all.filter((r) => r.raw_path), readBuf, (u) => keyIndex.get(urlKey(u)) || null);
    if (vendor) {
      for (const r of all) if (vendor.consumed.has(r.sha)) r.det = { kind: 'vendor-pack', vendor: 'pragmatic' };
      for (const f of vendor.files) {
        const esha = sha256(f.data);
        const key = `embedded://uht-${String(f.group).slice(0, 12)}/${f.name}`;
        const existing = all.find((r) => r.sha === esha);
        if (existing) {
          if (!existing.keys.includes(key)) existing.keys.push(key);
          existing.dirs.add(dirOfKey(key));
          continue;
        }
        const { raw_path } = await store.writeRaw(f.data, key, f.name, esha);
        const v = finalizeRes({
          sha: esha, size: f.data.length, raw_path, filenames: new Set([f.name]), keys: new Set([key]), urls: new Set(),
          occurrences: [], sources: new Set(['pragmatic_uht']), sessions: new Set(), content_types: new Set(), first_ts: Infinity,
        });
        v.embedded_from = { vendor: 'pragmatic_uht', spine_id: f.group };
        v.det = detect(f.data, { filename: f.name });
        all.push(v);
      }
      log.info(`Pragmatic Play : ${vendor.report.skeletons} skeleton(s) Spine extraits des packs, ${vendor.report.rebuilt} avec atlas + textures reconstruits.`);
      if (vendor.report.missingTextures) warnings.push({ type: 'pragmatic_missing_textures', count: vendor.report.missingTextures });
    }
  } catch (e) {
    warnings.push({ type: 'vendor_extract_failed', message: e.message });
    log.warn(`Pragmatic extraction failed: ${e.message}`);
  }

  const byKind = (...k) => all.filter((r) => k.includes(r.det.kind)).sort((a, b) => (a.first_ts ?? 0) - (b.first_ts ?? 0));
  const skeletons = byKind('spine-json', 'spine-skel');
  const atlases = byKind('spine-atlas');
  const images = byKind('image', 'texture');
  const imgIdx = buildImageIndex(images);
  const pagesByAtlas = new Map(atlases.map((a) => [a.sha, resolveAtlasPages(a, imgIdx)]));

  // ---------- 2. association ----------
  const plans = skeletons.map((skel) => {
    const m = matchSkeletonAtlases(skel, atlases);
    const loose = m.chosen.length ? null : matchLooseImages(skel, imgIdx);
    return { skel, chosen: m.chosen, alternatives: m.alternatives, loose };
  });

  // ---------- 3. stable folder names ----------
  const ids = {};
  const used = new Set(Object.values(prevIds));
  const nextNum = (prefix) => {
    let n = 1;
    for (const f of used) {
      const m = f.match(new RegExp(`^${prefix}_(\\d+)`));
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return n;
  };
  const folderFor = (prefix, sha, stem) => {
    if (prevIds[sha]?.startsWith(prefix + '_')) return (ids[sha] = prevIds[sha]);
    const f = `${prefix}_${pad3(nextNum(prefix))}_${safeSegment(stem || 'unnamed', 40)}`;
    used.add(f);
    return (ids[sha] = f);
  };
  for (const p of plans) p.folder = folderFor('package', p.skel.sha, p.skel.stem);

  const atlasUsers = new Map(); // atlas sha -> [package folders]
  for (const p of plans) for (const c of p.chosen) atlasUsers.set(c.res.sha, [...(atlasUsers.get(c.res.sha) || []), p.folder]);
  const orphanAtlases = atlases.filter((a) => !atlasUsers.has(a.sha));
  for (const a of orphanAtlases) a.folder = folderFor('atlas', a.sha, a.stem);

  // ---------- 4. write into a staging folder, then swap ----------
  const stage = path.join(dir, `.build-${Date.now()}`);
  await fsp.mkdir(stage, { recursive: true });
  const outputs = new Map(); // sha -> [relative output paths]
  const addOutput = (sha, p) => outputs.set(sha, [...(outputs.get(sha) || []), p]);
  const usedAsTexture = new Set();
  const rawAbs = (res) => path.join(dir, res.raw_path);

  async function place(res, folderRel, name, taken) {
    const safeName = name.split('/').filter((s) => s && s !== '..' && s !== '.').map((s) => safeSegment(s)).join('/') || safeSegment(res.filename);
    const u = uniqueName(safeName, res.sha, taken);
    if (!u.reused) {
      await linkOrCopy(rawAbs(res), path.join(stage, folderRel, u.name));
      addOutput(res.sha, `${folderRel}/${u.name}`);
    }
    return u.name;
  }

  const gameName = game;
  const providerName =
    provider || prev.provider || providerFromUrl(gameUrls[0]) ||
    providerFromHosts(new Map(all.flatMap((r) => r.keys.map((k) => [hostOf(k), 1])))) || 'Unknown';

  const packages = [];
  const unclassified = [];
  const now = new Date().toISOString();

  for (const p of plans) {
    const { skel } = p;
    const folderRel = `spine/${p.folder}`;
    const taken = new Map();
    const files = [];
    const pkgWarnings = [];
    const fileEntry = (res, role, name, extra = {}) => ({
      file: name, role, sha256: res.sha, size: res.size, original_filename: res.filename,
      raw_path: res.raw_path, source_urls: [...res.urls], ...(res.embedded_from ? { embedded_from: res.embedded_from } : {}), ...extra,
    });

    const skelName = await place(skel, folderRel, skel.filename, taken);
    files.push(fileEntry(skel, 'skeleton', skelName));

    const atlasInfo = [];
    const textures = [];
    let pagesTotal = 0;
    let pagesResolved = 0;
    const regionSet = new Set();
    for (const c of p.chosen) {
      const a = c.res;
      const atlasName = await place(a, folderRel, a.filename, taken);
      files.push(fileEntry(a, 'atlas', atlasName));
      a.det.atlas.baseNames.forEach((n) => regionSet.add(n));
      for (const pr of pagesByAtlas.get(a.sha)) {
        pagesTotal++;
        if (!pr.img) {
          pkgWarnings.push(`texture page not captured: ${pr.page.name} (atlas ${a.filename})`);
          textures.push({ page: pr.page.name, atlas: atlasName, file: null, missing: true, atlas_size: pr.page.size });
          continue;
        }
        pagesResolved++;
        usedAsTexture.add(pr.img.sha);
        // GPU-compressed texture (KTX2/Basis): browsers and Spine runtimes can't read it -> decode to the PNG the atlas asks for
        if (pr.img.det.image?.format === 'ktx2' && !pr.img.png) {
          try {
            const buf = await fsp.readFile(rawAbs(pr.img));
            if (isKtx2(buf)) pr.img.png = (await ktx2ToPng(buf)).png;
          } catch (e) {
            pkgWarnings.push(`KTX2 texture ${pr.img.filename} could not be decoded: ${e.message}`);
          }
        }
        if (pr.img.png) {
          const pngName = /\.png$/i.test(pr.page.name) ? pr.page.name : pr.page.name.replace(/\.[^.]+$/, '') + '.png';
          const u = uniqueName(pngName, pr.img.sha + ':png', taken);
          if (!u.reused) { await fsp.mkdir(path.dirname(path.join(stage, folderRel, u.name)), { recursive: true }); await fsp.writeFile(path.join(stage, folderRel, u.name), pr.img.png); }
          if (u.name !== pr.page.name) pkgWarnings.push(`atlas page "${pr.page.name}" served as KTX2, decoded to ${u.name} (rename may be needed)`);
        }
        // Name the texture exactly as the atlas expects when the format matches, so the package loads as-is.
        const sameFormat = extOf(pr.img.filename) === extOf(pr.page.name);
        const texName = pr.img.png ? (/\.png$/i.test(pr.page.name) ? pr.page.name : pr.page.name.replace(/\.[^.]+$/, '') + '.png') : await place(pr.img, folderRel, sameFormat ? pr.page.name : pr.img.filename, taken);
        if (pr.img.png) await place(pr.img, folderRel, pr.img.filename, taken); // keep the original KTX2 next to it
        const dims = pr.img.det.image || {};
        if (pr.sizeMatch === false)
          pkgWarnings.push(`texture ${texName} is ${dims.width}x${dims.height}, atlas page says ${pr.page.size?.join('x')} (scaled variant?)`);
        if (!sameFormat) pkgWarnings.push(`atlas page "${pr.page.name}" was served as "${pr.img.filename}" (${dims.format})`);
        if (pr.ambiguous) pkgWarnings.push(`several captured images could match page "${pr.page.name}"; picked by size/time`);
        textures.push({
          page: pr.page.name, atlas: atlasName, file: texName, sha256: pr.img.sha, format: dims.format || null,
          width: dims.width ?? null, height: dims.height ?? null, atlas_size: pr.page.size, size_match: pr.sizeMatch,
          match_method: pr.method, pma: pr.page.pma, filter: pr.page.filter,
        });
        files.push(fileEntry(pr.img, 'texture', texName, { atlas_page: pr.page.name }));
      }
      // pages decoded from KTX2 under another name: the package atlas must point to the PNGs (raw/ stays untouched)
      const renamed = pagesByAtlas.get(a.sha).filter((pr) => pr.img?.png && !/\.png$/i.test(pr.page.name));
      if (renamed.length) {
        let text = await fsp.readFile(rawAbs(a), 'utf8');
        for (const pr of renamed) text = text.replace(new RegExp(`^${pr.page.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), pr.page.name.replace(/\.[^.]+$/, '') + '.png');
        const target = path.join(stage, folderRel, atlasName);
        await fsp.rm(target, { force: true }); // it is a hard link to raw/: never write through it
        await fsp.writeFile(target, text);
        await linkOrCopy(rawAbs(a), path.join(stage, folderRel, atlasName + '.original'));
        pkgWarnings.push(`atlas rewritten to use the decoded PNG pages (original kept as ${atlasName}.original)`);
      }
      atlasInfo.push({
        file: atlasName, sha256: a.sha, format: a.det.atlas.format, pages: a.det.atlas.pages.map((x) => x.name), regions: a.det.atlas.regionCount,
        coverage: c.cov.ratio == null ? null : Math.round(c.cov.ratio * 1000) / 1000, coverage_side: c.cov.side, score: Math.round(c.score),
        evidence: c.evidence, shared_with: (atlasUsers.get(a.sha) || []).filter((f) => f !== p.folder),
      });
    }

    let textureMode = p.chosen.length ? 'atlas' : 'none';
    if (p.loose) {
      textureMode = 'loose_images';
      for (const [region, img] of p.loose.hits) {
        usedAsTexture.add(img.sha);
        const n = await place(img, folderRel, `images/${img.filename}`, taken);
        textures.push({ region, file: n, sha256: img.sha, format: img.det.image?.format, width: img.det.image?.width, height: img.det.image?.height, match_method: 'region_name' });
        files.push(fileEntry(img, 'texture', n, { region }));
      }
      pkgWarnings.push(`no atlas: matched ${p.loose.hits.size} individual images to attachments (${Math.round(p.loose.ratio * 100)}%)`);
    }

    const isJson = skel.det.kind === 'spine-json';
    const sp = isJson ? skel.det.spine : null;
    const sk = isJson ? null : skel.det.skel;
    let regionCoverage = null;
    let missingRegions = [];
    if (isJson && sp.requiredRegions.size) {
      const covered = [...sp.requiredRegions].filter((r) => p.chosen.some((c) => c.res.det.atlas.regionNames.has(r)) || p.loose?.hits.has(r));
      regionCoverage = Math.round((covered.length / sp.requiredRegions.size) * 1000) / 1000;
      missingRegions = [...sp.requiredRegions].filter((r) => !covered.includes(r)).slice(0, 50);
      if (regionCoverage < 1) pkgWarnings.push(`${sp.requiredRegions.size - covered.length} attachment region(s) not found in the atlas`);
    } else if (!isJson && p.chosen.length) regionCoverage = p.chosen[0].cov.ratio;
    if (!p.chosen.length && !p.loose) pkgWarnings.push('no atlas / textures captured for this skeleton');
    if (!isJson) pkgWarnings.push('binary skeleton: animation list not parsed (version, size and atlas association only)');

    const complete =
      (p.chosen.length > 0 && pagesTotal > 0 && pagesResolved === pagesTotal && (regionCoverage == null || regionCoverage >= 0.95)) ||
      (textureMode === 'loose_images' && regionCoverage >= 0.95);

    const cls = classifyPackage({
      name: skel.stem, urlPath: urlHint(skel), ignore: [gameName, slug],
      animations: sp ? sp.animations.map((a) => a.name) : [], skins: sp ? sp.skins : [], bones: sp ? sp.bones : [], slots: sp ? sp.slots : [],
      regions: sp ? [...sp.requiredRegions] : [...regionSet].filter((n) => sk.strings.has(n)),
    });
    if (cls.category === 'unknown') unclassified.push({ type: 'spine_package', path: `games/${slug}/${folderRel}`, reason: 'no reliable category hint' });

    const meta = {
      id: `${slug}/${p.folder}`,
      package: p.folder,
      name: skel.stem,
      game: gameName,
      game_slug: slug,
      provider: providerName,
      format: 'spine',
      skeleton_format: isJson ? 'json' : 'binary',
      skeleton_file: skelName,
      skeleton_version: sp?.version ?? sk?.version ?? null,
      category: cls.category,
      subtypes: cls.subtypes,
      tags: cls.tags,
      classification: { confidence: cls.confidence, scores: cls.scores, evidence: cls.evidence },
      animations: sp ? sp.animations.map((a) => a.name) : [],
      animation_details: sp ? sp.animations : [],
      skins: sp?.skins ?? [],
      events: sp?.events ?? [],
      bones_count: sp ? sp.bones.length : null,
      slots_count: sp ? sp.slots.length : null,
      bones: sp ? sp.bones : [],
      slots: sp ? sp.slots : [],
      constraints: sp?.constraints ?? null,
      attachments_count: sp?.attachments ?? null,
      attachment_types: sp?.attachmentTypes ?? null,
      dimensions: { width: sp?.width ?? sk?.width ?? null, height: sp?.height ?? sk?.height ?? null },
      fps: sp?.fps ?? null,
      texture_mode: textureMode,
      textures,
      atlases: atlasInfo,
      alternative_atlases: p.alternatives.map((c) => ({ raw_path: c.res.raw_path, sha256: c.res.sha, coverage: c.cov.ratio, evidence: c.evidence })),
      files,
      source_urls: [...new Set(files.flatMap((f) => f.source_urls))],
      checks: {
        complete,
        atlas_found: p.chosen.length > 0,
        pages_resolved: `${pagesResolved}/${pagesTotal}`,
        region_coverage: regionCoverage,
        missing_regions: missingRegions,
      },
      complete,
      warnings: pkgWarnings,
      shared_atlas_with: [...new Set(atlasInfo.flatMap((a) => a.shared_with))],
      detected_at: iso(skel.first_ts),
      sessions: [...skel.sessions],
      packaged_at: now,
    };
    await writeJson(path.join(stage, folderRel, 'metadata.json'), meta);
    packages.push(meta);
  }

  // ---------- 5. atlases without any skeleton (sprite atlases, or skeleton never loaded) ----------
  const atlasOnly = [];
  for (const a of orphanAtlases) {
    const folderRel = `other/atlas_only/${a.folder}`;
    const taken = new Map();
    const atlasName = await place(a, folderRel, a.filename, taken);
    const textures = [];
    for (const pr of pagesByAtlas.get(a.sha)) {
      if (!pr.img) {
        textures.push({ page: pr.page.name, file: null, missing: true });
        continue;
      }
      usedAsTexture.add(pr.img.sha);
      const n = await place(pr.img, folderRel, extOf(pr.img.filename) === extOf(pr.page.name) ? pr.page.name : pr.img.filename, taken);
      textures.push({ page: pr.page.name, file: n, sha256: pr.img.sha, width: pr.img.det.image?.width, height: pr.img.det.image?.height, size_match: pr.sizeMatch, match_method: pr.method });
    }
    const meta = {
      id: `${slug}/${a.folder}`, game: gameName, provider: providerName, atlas_file: atlasName, sha256: a.sha, format: a.det.atlas.format,
      pages: a.det.atlas.pages, regions_count: a.det.atlas.regionCount, regions: [...a.det.atlas.baseNames].slice(0, 500), textures,
      note: 'Atlas with no matching skeleton captured. Could be a plain sprite atlas, or its skeleton was never loaded during the session.',
      source_urls: [...a.urls], detected_at: iso(a.first_ts),
    };
    await writeJson(path.join(stage, folderRel, 'metadata.json'), meta);
    atlasOnly.push({ id: meta.id, path: `games/${slug}/${folderRel}`, atlas: atlasName, pages: textures.length, missing_pages: textures.filter((t) => t.missing).length });
  }

  // ---------- 6. spritesheets (TexturePacker / Pixi JSON) ----------
  const spritesheets = [];
  for (const s of byKind('spritesheet')) {
    const folderRel = `other/spritesheets/${safeSegment(s.stem, 50)}_${s.sha.slice(0, 6)}`;
    const taken = new Map();
    const jsonName = await place(s, folderRel, s.filename, taken);
    let imgName = null;
    const ref = s.det.sheet.image;
    if (ref) {
      const targets = s.keys.map((k) => resolveRelative(ref, k)).filter(Boolean);
      const img = targets.flatMap((t) => imgIdx.byKey.get(t) || [])[0] || imgIdx.byName.get(path.posix.basename(ref).toLowerCase())?.[0] || imgIdx.byStem.get(stemOf(ref))?.[0];
      if (img) {
        usedAsTexture.add(img.sha);
        imgName = await place(img, folderRel, img.filename, taken);
      }
    }
    spritesheets.push({ path: `games/${slug}/${folderRel}`, json: jsonName, image: imgName, frames: s.det.sheet.frames, animations: s.det.sheet.animations });
  }

  // ---------- 7. remaining images and other files ----------
  const imgTaken = new Map();
  for (const img of images) {
    if (usedAsTexture.has(img.sha)) continue;
    await place(img, 'images', img.filename, imgTaken);
  }
  const otherDirs = { 'vendor-pack': 'other/vendor_packs', json: 'other/json', 'json-bundle': 'other/bundles', dragonbones: 'other/dragonbones', text: 'other/text', binary: 'other/binary' };
  const otherTaken = {};
  for (const r of all) {
    const d = otherDirs[r.det.kind];
    if (!d) continue;
    otherTaken[d] ||= new Map();
    const n = await place(r, d, r.filename, otherTaken[d]);
    if (['text', 'binary', 'dragonbones'].includes(r.det.kind))
      unclassified.push({ type: r.det.kind, path: `games/${slug}/${d}/${n}`, raw_path: r.raw_path, reason: r.det.kind === 'dragonbones' ? 'DragonBones skeleton (not Spine)' : 'unrecognised content' });
  }

  // ---------- 8. swap staging into place ----------
  const trash = path.join(dir, `.old-${Date.now()}`);
  await fsp.mkdir(trash, { recursive: true });
  for (const d of ['spine', 'images', 'other']) {
    await fsp.rename(path.join(dir, d), path.join(trash, d)).catch(() => {});
    await fsp.mkdir(path.join(stage, d), { recursive: true });
    await fsp.rename(path.join(stage, d), path.join(dir, d));
  }
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.rm(trash, { recursive: true, force: true });

  // ---------- 9. manifest ----------
  const previousSkeletonShas = new Set(Object.entries(prevIds).filter(([, f]) => f.startsWith('package_')).map(([s]) => s));
  const newPackages = plans.filter((p) => !previousSkeletonShas.has(p.skel.sha)).length;
  const sessions = [...(prev.sessions || [])];
  if (session) sessions.push(session);
  const stats = {
    network_requests_total: countLines(path.join(dir, 'network', 'network.jsonl')),
    resources_unique: all.length,
    images: images.length,
    json_candidates: byKind('spine-json', 'json', 'json-bundle', 'spritesheet', 'dragonbones').length,
    atlases: atlases.length,
    skeletons: skeletons.length,
    spine_packages: packages.length,
    complete_packages: packages.filter((p) => p.complete).length,
    incomplete_packages: packages.filter((p) => !p.complete).length,
    new_packages: newPackages,
    atlas_only: atlasOnly.length,
    spritesheets: spritesheets.length,
    unclassified: unclassified.length,
    errors: errors.length,
  };
  const manifest = {
    schema: 'scrap.manifest/1',
    game: gameName,
    slug,
    provider: providerName,
    game_urls: [...new Set([...(prev.game_urls || []), ...gameUrls])],
    status: 'complete',
    updated_at: now,
    stats,
    packages: packages.map((m) => ({
      id: m.id, path: `games/${slug}/spine/${m.package}`, name: m.name, category: m.category, subtypes: m.subtypes, complete: m.complete,
      skeleton_version: m.skeleton_version, animations: m.animations, textures: m.textures.length, warnings: m.warnings.length,
    })),
    atlas_only: atlasOnly,
    spritesheets,
    unclassified,
    errors,
    warnings,
    sessions,
    ids,
    resources: all.map((r) => ({
      sha256: r.sha, kind: r.det.kind, size: r.size, filename: r.filename, raw_path: r.raw_path, outputs: outputs.get(r.sha) || [],
      image: r.det.image ? { format: r.det.image.format, width: r.det.image.width, height: r.det.image.height } : undefined,
      urls: [...r.urls], occurrences: r.occurrences.length, first_seen: iso(r.first_ts), sources: [...r.sources],
      ...(r.embedded_from ? { embedded_from: r.embedded_from } : {}),
    })),
  };
  await writeJson(path.join(dir, 'manifest.json'), manifest);
  for (const e of errors) log.error(`${slug}: ${e.type} ${e.raw_path}`);
  return manifest;
}
