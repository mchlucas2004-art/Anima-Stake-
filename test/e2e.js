// Offline end-to-end test: fake casino page + cross-origin game iframe, real Chromium, real pipeline.
// Run: npm test
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildFixtures, sitePage, makePng, SECRET } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const sandbox = path.join(here, '.sandbox');

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function run(args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(projectDir, 'src/cli.js'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}\n${out}`))));
  });
}

function walk(dir, skip) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p)) continue;
    if (e.isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').join('\n      ')}`);
  }
}

async function main() {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });

  let gameOrigin;
  const gameSrv = await serve((req, res) => {
    const F = buildFixtures(gameOrigin);
    const p = new URL(req.url, 'http://x').pathname;
    const f = F[p];
    if (!f) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': f.type, 'access-control-allow-origin': '*', 'content-length': f.body.length });
    res.end(f.body);
  });
  gameOrigin = `http://127.0.0.1:${gameSrv.address().port}`;
  const siteSrv = await serve((req, res) => {
    if (req.url.startsWith('/thumbs/')) return res.writeHead(200, { 'content-type': 'image/png' }).end(makePng(4, 4, [1, 2, 3]));
    if (req.url.startsWith('/casino/games/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(sitePage(gameOrigin));
    res.writeHead(404).end();
  });
  const siteUrl = `http://localhost:${siteSrv.address().port}`;

  const env = {
    SCRAP_ROOT: sandbox,
    SCRAP_SETTINGS_JSON: JSON.stringify({
      baseUrl: siteUrl, siteHosts: ['localhost'], headless: true, profileDir: '.profile',
      ...(process.env.E2E_CDP_URL ? { browserMode: 'attach', attach: { cdpUrl: process.env.E2E_CDP_URL } } : { browserMode: 'launch' }), retry: { attempts: 2, backoffMs: 200 } }),
  };

  console.log('1) capture (auto mode, headless)…');
  const out = await run(['scrape', '--url', `${siteUrl}/casino/games/test-slot`, '--name', 'Test Slot', '--auto', '--duration', '14', '--idle', '6'], env);
  console.log(out.split('\n').filter((l) => /GAME COMPLETE|packages reconstructed|Completion pass|skeleton  |atlas  /.test(l)).map((l) => '   ' + l).join('\n'));

  const g = path.join(sandbox, 'games', 'test-slot');
  const m = readJson(path.join(g, 'manifest.json'));
  const byName = Object.fromEntries(m.packages.map((p) => [p.name, p]));
  const meta = (n) => readJson(path.join(sandbox, byName[n].path, 'metadata.json'));
  const files = (n) => fs.readdirSync(path.join(sandbox, byName[n].path)).sort();

  console.log('2) checks');
  check('8 Spine packages reconstructed', () => assert.deepEqual(Object.keys(byName).sort(), ['background', 'bigwin', 'coin', 'fire', 'ghost', 'hero', 'sym_h1', 'sym_h2']));
  check('hero: 2-page atlas, both textures, character, complete', () => {
    const h = meta('hero');
    assert.deepEqual(files('hero'), ['hero.atlas', 'hero.json', 'hero.png', 'hero_2.png', 'metadata.json']);
    assert.equal(h.complete, true);
    assert.equal(h.category, 'character');
    assert.deepEqual(h.animations, ['idle', 'walk', 'win', 'reaction_happy']);
    assert.equal(h.animation_details.find((a) => a.name === 'win').duration, 3);
    assert.equal(h.skeleton_version, '4.1.24');
    assert.equal(h.bones_count, 9);
    assert.ok(h.subtypes.includes('idle') && h.subtypes.includes('reaction'));
  });
  check('symbols: two separate packages sharing one atlas, WebP texture used for "symbols.png" page', () => {
    for (const s of ['sym_h1', 'sym_h2']) {
      const x = meta(s);
      assert.equal(x.complete, true, s);
      assert.equal(x.category, 'symbol', s);
      assert.ok(x.subtypes.includes('symbol_win'), s);
      assert.equal(x.textures[0].file, 'symbols.webp');
      assert.equal(x.textures[0].match_method, 'same_folder_variant');
      assert.equal(x.shared_atlas_with.length, 1);
      assert.equal(x.files.filter((f) => f.role === 'skeleton').length, 1);
    }
  });
  check('fire: hashed names matched, sequence regions covered, effect', () => {
    const f = meta('fire');
    assert.equal(f.complete, true);
    assert.equal(f.checks.region_coverage, 1);
    assert.equal(f.category, 'effect');
    assert.ok(f.subtypes.includes('fire') && f.subtypes.includes('explosion'));
  });
  check('background: binary .skel associated to its atlas', () => {
    const b = meta('background');
    assert.equal(b.skeleton_format, 'binary');
    assert.equal(b.skeleton_version, '4.1.24');
    assert.equal(b.complete, true);
    assert.equal(b.category, 'background');
  });
  check('bigwin: lazy-loaded, texture retrieved by completion probe', () => {
    const b = meta('bigwin');
    assert.equal(b.complete, true);
    assert.ok(b.subtypes.includes('big_win'));
    const r = m.resources.find((x) => x.sha256 === b.textures[0].sha256);
    assert.ok(r.sources.includes('collector_probe'));
  });
  check('coin: skeleton + atlas + texture extracted from a JSON bundle', () => {
    const c = meta('coin');
    assert.equal(c.complete, true);
    assert.ok(c.files.every((f) => f.embedded_from));
  });
  check('ghost: skeleton without atlas reported as incomplete', () => {
    const x = meta('ghost');
    assert.equal(x.complete, false);
    assert.ok(x.warnings.some((w) => /no atlas/.test(w)));
  });
  check('duplicates: hero.json stored once, both URLs kept', () => {
    const r = m.resources.find((x) => x.filename === 'hero.json');
    assert.equal(r.occurrences, 2);
    assert.equal(m.resources.filter((x) => x.filename === 'hero.json').length, 1);
  });
  check('same name, different content: both logo.png kept', () => {
    const imgs = fs.readdirSync(path.join(g, 'images')).filter((f) => f.startsWith('logo'));
    assert.equal(imgs.length, 2, imgs.join(','));
  });
  check('spritesheet, atlas-only and non-Spine JSON routed to other/', () => {
    assert.equal(m.spritesheets.length, 1);
    assert.equal(m.spritesheets[0].image, 'buttons.png');
    assert.equal(m.atlas_only.length, 1);
    assert.ok(fs.existsSync(path.join(g, 'other/json/config.json')));
  });
  check('site (casino page) assets not collected', () => assert.ok(!m.resources.some((r) => r.filename === 'other-game.png')));
  check('network.jsonl logged with required fields', () => {
    const lines = fs.readFileSync(path.join(g, 'network/network.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(lines.length > 25);
    for (const k of ['url', 'method', 'status', 'content_type', 'content_length', 'ts_request', 'ts_response', 'initiator_frame']) assert.ok(k in lines[0], k);
  });
  check('no token/secret anywhere in the library (outside the browser profile)', () => {
    const all = walk(sandbox, (p) => p.includes(`${path.sep}.profile`));
    const leaks = all.filter((p) => fs.readFileSync(p).includes(SECRET));
    assert.deepEqual(leaks, []);
  });
  check('global index lists the packages and is searchable', () => {
    const idx = readJson(path.join(sandbox, 'index/spine_packages.json'));
    assert.equal(idx.count, 8);
    assert.ok(readJson(path.join(sandbox, 'index/assets.json')).count > 20);
    assert.equal(readJson(path.join(sandbox, 'index/games.json')).games[0].slug, 'test-slot');
  });

  console.log('3) search + rebuild (stable ids) + resume');
  const s = await run(['search', 'character', 'idle'], env);
  check('search "character idle" → hero first', () => assert.match(s.split('\n')[0], /package_\d+_hero/));
  const before = m.packages.map((p) => p.path).sort();
  await run(['rebuild'], env);
  const after = readJson(path.join(g, 'manifest.json')).packages.map((p) => p.path).sort();
  check('rebuild keeps package folders stable', () => assert.deepEqual(after, before));
  const r = await run(['resume'], env);
  check('resume with nothing pending', () => assert.match(r, /Nothing to resume/));

  console.log('4) import of a DevTools HAR export (one body removed, one emptied)');
  {
    const { chromium } = await import('playwright');
    const harPath = path.join(sandbox, 'import', 'Har Slot.har');
    await fsp.mkdir(path.dirname(harPath), { recursive: true });
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ recordHar: { path: harPath, content: 'embed' } });
    const page = await ctx.newPage();
    await page.goto(`${siteUrl}/casino/games/test-slot`);
    await page.waitForTimeout(7000); // includes the lazy big win
    await ctx.close();
    await browser.close();
    const har = readJson(harPath);
    for (const e of har.log.entries) {
      if (e.request.url.includes('fire-3f9a2c1d.json')) delete e.response.content.text; // DevTools sometimes omits bodies
      if (e.request.url.includes('sym_h1.json')) e.response.content.text = ''; // …or keeps an empty one
    }
    fs.writeFileSync(harPath, JSON.stringify(har));
    const out4 = await run(['import'], env);
    const hm = readJson(path.join(sandbox, 'games', 'har-slot', 'manifest.json'));
    const names = hm.packages.map((p) => p.name).sort();
    check('HAR import: same 8 packages as the live capture', () => assert.deepEqual(names, ['background', 'bigwin', 'coin', 'fire', 'ghost', 'hero', 'sym_h1', 'sym_h2']));
    check('HAR import: missing / empty bodies re-downloaded', () => {
      for (const n of ['fire-3f9a2c1d.json', 'sym_h1.json']) assert.ok(hm.resources.find((r) => r.filename === n)?.sources.includes('collector_refetch'), n);
    });
    check('HAR import: file moved to import/done', () => assert.ok(!fs.existsSync(harPath) && fs.readdirSync(path.join(sandbox, 'import', 'done')).length === 1));
    check('HAR import: report printed', () => assert.match(out4, /GAME COMPLETE/));
  }

  gameSrv.close();
  siteSrv.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
