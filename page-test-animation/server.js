#!/usr/bin/env node
// Local gallery of every captured Spine skeleton: npm run viewer  ->  http://localhost:4321
// Lists the built packages (games/*/spine/*) and, for games whose capture is not built yet,
// the skeletons found directly in raw/. Only serves files from the games/ folder, on localhost.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GAMES_DIR, ROOT } from '../src/lib/paths.js';
const CREATIONS_DIR = path.join(ROOT, 'creations');
import { isSpineJson, extractSpineInfo } from '../src/detect/spine-json.js';
import { parseAtlas } from '../src/detect/atlas.js';
import { detectSkel } from '../src/detect/skel.js';
import { coverage } from '../src/analyze/associate.js';
import { classifyPackage } from '../src/analyze/classify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.atlas': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.skel': 'application/octet-stream',
};

const fileUrl = (abs) => '/files/' + path.relative(GAMES_DIR, abs).split(path.sep).map(encodeURIComponent).join('/');

async function walk(dir, out = []) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const readJsonSafe = async (p) => {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch {
    return null;
  }
};

/** One blend mode per skeleton in the player: follow what most atlas pages declare. */
const majorityPma = (flags) => flags.filter(Boolean).length * 2 > flags.length;

/** Built packages: metadata.json already has everything. */
async function packagesOf(slug) {
  const spineDir = path.join(GAMES_DIR, slug, 'spine');
  let dirs = [];
  try {
    dirs = await fsp.readdir(spineDir);
  } catch {
    return [];
  }
  const items = [];
  for (const d of dirs.sort()) {
    const m = await readJsonSafe(path.join(spineDir, d, 'metadata.json'));
    if (!m) continue;
    const atlas = m.atlases?.[0]?.file;
    items.push({
      id: m.id, game: m.game, game_slug: slug, name: m.name, source: 'package', folder: `games/${slug}/spine/${d}`,
      category: m.category, subtypes: m.subtypes, version: m.skeleton_version, format: m.skeleton_format,
      skeleton: fileUrl(path.join(spineDir, d, m.skeleton_file)), atlas: atlas ? fileUrl(path.join(spineDir, d, atlas)) : null,
      animations: m.animations, skins: m.skins, complete: m.complete, warnings: m.warnings,
      pma_mixed: new Set((m.textures || []).map((t) => !!t.pma)).size > 1,
      pma: majorityPma((m.textures || []).map((t) => t.pma)),
    });
  }
  return items;
}

/** Capture not built yet: find skeletons in raw/ and pair each with the best atlas of its folder. */
async function rawSkeletonsOf(slug, gameName) {
  const files = await walk(path.join(GAMES_DIR, slug, 'raw'));
  const atlasCache = new Map();
  const atlasesIn = async (dir) => {
    if (atlasCache.has(dir)) return atlasCache.get(dir);
    const list = [];
    for (const f of files.filter((x) => path.dirname(x) === dir && /\.atlas(\.txt)?$/i.test(x))) {
      const a = parseAtlas(await fsp.readFile(f, 'utf8').catch(() => ''));
      if (a) list.push({ file: f, atlas: a });
    }
    atlasCache.set(dir, list);
    return list;
  };
  const items = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const isJson = lower.endsWith('.json');
    const isSkel = lower.endsWith('.skel') || lower.endsWith('.skel.bytes');
    if (!isJson && !isSkel) continue;
    const st = await fsp.stat(f);
    if (st.size > 40 * 1024 * 1024) continue;
    let det;
    if (isJson) {
      const obj = await readJsonSafe(f);
      if (!obj || !isSpineJson(obj)) continue;
      det = { kind: 'spine-json', spine: extractSpineInfo(obj) };
    } else {
      const skel = detectSkel(await fsp.readFile(f), 'skel');
      if (!skel) continue;
      det = { kind: 'spine-skel', skel };
    }
    const stem = path.basename(f).replace(/\.(json|skel(\.bytes)?)$/i, '');
    const cands = await atlasesIn(path.dirname(f));
    const best = cands
      .map((c) => ({ ...c, cov: coverage(det, c.atlas).ratio ?? 0, same: path.basename(c.file).replace(/\.atlas(\.txt)?$/i, '') === stem }))
      .sort((a, b) => b.same - a.same || b.cov - a.cov)[0];
    const sp = det.spine;
    const cls = classifyPackage({
      name: stem, urlPath: path.relative(path.join(GAMES_DIR, slug, 'raw'), path.dirname(f)).split(path.sep).slice(-2).join('/'),
      ignore: [gameName, slug], animations: sp?.animations.map((a) => a.name) || [], skins: sp?.skins || [], bones: sp?.bones || [], slots: sp?.slots || [],
    });
    items.push({
      id: `${slug}/raw/${path.relative(path.join(GAMES_DIR, slug, 'raw'), f)}`, game: gameName, game_slug: slug, name: stem, source: 'raw',
      folder: path.relative(path.join(GAMES_DIR, '..'), path.dirname(f)), category: cls.category, subtypes: cls.subtypes,
      version: sp?.version || det.skel?.version || null, format: isJson ? 'json' : 'binary',
      skeleton: fileUrl(f), atlas: best ? fileUrl(best.file) : null, animations: sp ? sp.animations.map((a) => a.name) : [], skins: sp?.skins || [],
      complete: !!best && (best.same || best.cov >= 0.95), warnings: best ? [] : ['aucun atlas trouvé dans le même dossier'],
      pma: best ? majorityPma(best.atlas.pages.map((p) => p.pma)) : false,
      pma_mixed: best ? new Set(best.atlas.pages.map((p) => !!p.pma)).size > 1 : false,
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function catalog() {
  let slugs = [];
  try {
    slugs = (await fsp.readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    /* empty library */
  }
  const items = [];
  // original creations (creations/<name>/package/metadata.json)
  // any creations/**/package/metadata.json
  const pkgs = (await walk(CREATIONS_DIR)).filter((f) => f.endsWith(`${path.sep}package${path.sep}metadata.json`) && !f.includes(`${path.sep}tools${path.sep}`)).sort();
  for (const metaFile of pkgs) {
    const dir = path.dirname(metaFile);
    const m = await readJsonSafe(metaFile);
    if (!m) continue;
    const relDir = path.relative(CREATIONS_DIR, dir).split(path.sep);
    const url = (f) => '/creations/' + [...relDir, f].map(encodeURIComponent).join('/');
    items.push({
      id: m.id, game: m.game, game_slug: m.game_slug, name: m.name, source: 'creation', folder: `creations/${relDir.join('/')}`,
      category: m.category, subtypes: m.subtypes, version: m.skeleton_version, format: m.skeleton_format,
      skeleton: url(m.skeleton_file), atlas: url(m.atlases[0].file), animations: m.animations, skins: m.skins, complete: true, warnings: [],
      pma: false, showcase: `/showcase.html#${encodeURIComponent(m.id)}`,
    });
  }
  for (const slug of slugs) {
    const manifest = await readJsonSafe(path.join(GAMES_DIR, slug, 'manifest.json'));
    const session = await readJsonSafe(path.join(GAMES_DIR, slug, 'session.json'));
    const gameName = manifest?.game || session?.game || slug;
    const built = await packagesOf(slug);
    items.push(...(built.length ? built : await rawSkeletonsOf(slug, gameName)));
  }
  return items;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') return sendFile(res, path.join(here, 'viewer.html'));
    if (url.pathname === '/play.html') return sendFile(res, path.join(here, 'play.html'));
    if (url.pathname === '/v1' || url.pathname === '/v1/') return sendFile(res, path.join(here, 'v1', 'index.html'));
    if (url.pathname.startsWith('/v1/')) {
      const abs = path.resolve(here, 'v1', url.pathname.slice(4));
      if (!abs.startsWith(path.join(here, 'v1') + path.sep)) return res.writeHead(403).end();
      return sendFile(res, abs);
    }
    if (url.pathname === '/api/catalog') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(await catalog()));
    }
    if (['/showcase.html', '/contact.html', '/halloween.html'].includes(url.pathname)) return sendFile(res, path.join(here, url.pathname.slice(1)));
    if (url.pathname.startsWith('/creations/')) {
      const rel = url.pathname.slice('/creations/'.length).split('/').map(decodeURIComponent).join(path.sep);
      const abs = path.resolve(CREATIONS_DIR, rel);
      if (!abs.startsWith(CREATIONS_DIR + path.sep) || abs.includes(`${path.sep}source${path.sep}`)) return res.writeHead(403).end();
      return sendFile(res, abs);
    }
    if (url.pathname.startsWith('/files/')) {
      const rel = url.pathname.slice('/files/'.length).split('/').map(decodeURIComponent).join(path.sep);
      const abs = path.resolve(GAMES_DIR, rel);
      if (!abs.startsWith(GAMES_DIR + path.sep)) return res.writeHead(403).end();
      return sendFile(res, abs);
    }
    res.writeHead(404).end('not found');
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
});

function sendFile(res, abs) {
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(abs).pipe(res);
  });
}

server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.log(`Galerie Spine : ${link}   (Ctrl+C pour arrêter)`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${link}`);
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log(`Port ${PORT} déjà utilisé : la galerie tourne peut-être déjà → http://localhost:${PORT}`);
  else console.error(e);
  process.exit(1);
});
