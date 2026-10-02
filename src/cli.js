#!/usr/bin/env node
// Scrap — collect -> identify -> associate -> download -> classify -> index (Spine assets)
import path from 'node:path';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { BrowserManager } from './browser.js';
import { ROOT, GAMES_DIR, TEMP_DIR, gameDir, rel } from './lib/paths.js';
import { loadSettings, loadGameList } from './lib/config.js';
import { log } from './lib/log.js';
import { StatusBoard } from './lib/status.js';
import { slugify, readJson, writeJson, sanitizeUrl, exists } from './lib/util.js';
import { GameStore } from './store.js';
import { CaptureSession } from './capture.js';
import { buildGame } from './analyze/build.js';
import { rebuildIndex, searchPackages } from './indexer.js';
import { resolveGameUrl, tryClickPlay } from './resolve.js';
import { importHar, repairGame } from './import-har.js';

const QUEUE_FILE = path.join(TEMP_DIR, 'queue.json');
const RESOLVE_CACHE = path.join(TEMP_DIR, 'resolve_cache.json');

// ---------- Ctrl+C: first press = stop capture gracefully, second = hard exit ----------
let sigints = 0;
const stopListeners = new Set();
process.on('SIGINT', () => {
  sigints++;
  if (sigints > 1 || !stopListeners.size) {
    console.log('\nAborted. Run "npm run resume" to build what was captured.');
    process.exit(130);
  }
  for (const fn of stopListeners) fn('ctrl_c');
});

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/casino\/games\/([^/?#]+)/);
    return m ? m[1] : (u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return 'game';
  }
}

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function waitForStop({ interactive, capture, settings, browser, autoCfg }) {
  return new Promise((resolve) => {
    let rl = null;
    let timer = null;
    const done = (reason) => {
      rl?.close();
      clearInterval(timer);
      stopListeners.delete(done);
      resolve(reason);
    };
    stopListeners.add(done);
    browser.closedPromise.then(() => done('browser_closed'));
    if (interactive) {
      rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.on('line', () => done('user'));
      rl.on('close', () => done('stdin_closed'));
    } else {
      timer = setInterval(() => {
        const elapsed = (Date.now() - capture.startedAt) / 1000;
        const idle = (Date.now() - capture.lastCandidateAt) / 1000;
        if (elapsed >= autoCfg.durationSec) done('duration');
        else if (elapsed >= autoCfg.minDurationSec && idle >= autoCfg.idleStopSec) done('idle');
      }, 500);
    }
  });
}

async function setSessionState(slug, state) {
  const f = path.join(gameDir(slug), 'session.json');
  await writeJson(f, { ...(await readJson(f, {})), ...state, updated_at: new Date().toISOString() });
}

function printReport(m, counters, outDir) {
  const s = m.stats;
  console.log(`
════════════════════════════════════════
GAME COMPLETE

Game: ${m.game}${m.provider && m.provider !== 'Unknown' ? `  (${m.provider})` : ''}

Network requests: ${counters ? counters.requests : s.network_requests_total}
Images detected: ${s.images}
JSON candidates: ${s.json_candidates}
Atlas detected: ${s.atlases}
Spine packages reconstructed: ${s.spine_packages}  (complete: ${s.complete_packages}, incomplete: ${s.incomplete_packages}, new: ${s.new_packages})
Atlas without skeleton: ${s.atlas_only}
Unclassified assets: ${s.unclassified}
Errors: ${s.errors}

Output:
${outDir}/
════════════════════════════════════════`);
  const incomplete = m.packages.filter((p) => !p.complete);
  if (incomplete.length) {
    console.log('Incomplete packages (see warnings in their metadata.json):');
    for (const p of incomplete.slice(0, 20)) console.log(`  - ${p.path}`);
  }
  if (m.unclassified.length) {
    console.log('Unclassified:');
    for (const u of m.unclassified.slice(0, 20)) console.log(`  - [${u.type}] ${u.path}  (${u.reason})`);
    if (m.unclassified.length > 20) console.log(`  … ${m.unclassified.length - 20} more in manifest.json`);
  }
  for (const e of m.errors.slice(0, 20)) console.log(`  ERROR ${e.type}: ${e.raw_path}`);
}

async function runGame(entry, settings, opts, browser) {
  const name = entry.name || opts.name || nameFromUrl(entry.url);
  const slug = slugify(name);
  const store = await new GameStore(slug).init();
  const prev = await readJson(path.join(gameDir(slug), 'manifest.json'), {});
  const knownSkeletonShas = new Set(Object.entries(prev?.ids || {}).filter(([, f]) => f.startsWith('package_')).map(([s]) => s));
  const sessionId = new Date().toISOString();
  await setSessionState(slug, { status: 'capturing', session_id: sessionId, game: name, entry });

  log.info(`\n▶ ${name}  →  ${rel(gameDir(slug))}/`);
  const context = await browser.ensure();
  const page = await browser.page();
  const capture = new CaptureSession({ context, store, settings, sessionId, knownSkeletonShas, pageFilter: browser.pageFilter() });
  browser.closedPromise.then(() => (capture.contextClosed = true));
  capture.start(); // listen before navigating: nothing loaded by the game is missed

  const cache = await readJson(RESOLVE_CACHE, {});
  let target = null;
  try {
    target = await resolveGameUrl(page, { ...entry, name }, settings, cache);
  } catch (e) {
    log.warn(`resolution failed: ${e.message}`);
  }
  if (target) {
    log.info(`Opening ${sanitizeUrl(target.url)}  (${target.method})`);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    } catch (e) {
      log.warn(`navigation: ${e.message.split('\n')[0]} — capture continues, the page may still be loading (or needs you).`);
    }
  } else {
    log.warn(`Could not find "${name}" automatically. Open the game yourself in the browser window: capture is already running.`);
  }

  const interactive = !opts.auto;
  const autoCfg = { ...settings.auto, ...(opts.duration ? { durationSec: Number(opts.duration) } : {}), ...(opts.idle ? { idleStopSec: Number(opts.idle) } : {}) };
  if (!interactive && autoCfg.clickPlay) {
    setTimeout(() => tryClickPlay(page).catch(() => {}), 6000);
    setTimeout(() => tryClickPlay(page).catch(() => {}), 16000);
  }

  const c = capture.counters;
  const board = new StatusBoard(() => [
    `━━━ CAPTURE ACTIVE ━━━  ${name}  [${fmtTime(Date.now() - capture.startedAt)}]${interactive ? '' : '  (auto)'}`,
    `Requests observed: ${c.requests}   Candidate assets: ${c.candidates}   Images: ${c.images}   JSON: ${c.json}`,
    `Atlases: ${c.atlases}   Spine packages: ${c.skeletons}   New packages: ${c.newSkeletons}   Errors: ${c.errors}`,
    interactive
      ? 'Play / interact freely. Press ENTER here to stop and build the library (Ctrl+C works too).'
      : `Auto mode: stops after ${autoCfg.durationSec}s or ${autoCfg.idleStopSec}s without new assets.`,
  ]);
  board.start();
  const reason = await waitForStop({ interactive, capture, settings, browser, autoCfg });
  board.stop();
  log.info(`Stopping capture (${reason}). Finishing in-flight downloads…`);

  const pageUrls = browser.closed ? [] : context.pages().flatMap((p) => p.frames().map((f) => f.url()));
  const gameUrls = [...new Set(pageUrls.filter((u) => /\/casino\/games\//.test(u)).map(sanitizeUrl))];
  if (target?.url) gameUrls.unshift(sanitizeUrl(target.url));
  await capture.stop();
  const finalUrl = gameUrls.find((u) => /\/casino\/games\//.test(u));
  if (entry.name && finalUrl && !entry.url) await writeJson(RESOLVE_CACHE, { ...cache, [entry.name.toLowerCase()]: finalUrl });

  const session = {
    id: sessionId, started_at: new Date(capture.startedAt).toISOString(), ended_at: new Date().toISOString(), stop_reason: reason,
    mode: interactive ? 'interactive' : 'auto', counters: { ...c }, game_frames: [...capture.gameFrameUrls].slice(0, 20),
  };
  await setSessionState(slug, { status: 'building', session });
  log.info('Building packages and index…');
  const manifest = await buildGame(slug, { game: name, provider: entry.provider, gameUrls: [...new Set(gameUrls)], session });
  await setSessionState(slug, { status: 'complete' });
  await rebuildIndex();
  printReport(manifest, c, rel(gameDir(slug)));
  return manifest;
}

async function processQueue(queue, settings, opts) {
  const browser = new BrowserManager(settings);
  try {
    for (const item of queue.items) {
      if (item.status === 'done') continue;
      if (sigints > 1) break;
      item.status = 'running';
      item.attempts = (item.attempts || 0) + 1;
      await writeJson(QUEUE_FILE, queue);
      try {
        await runGame(item, settings, opts, browser);
        item.status = 'done';
        item.error = null;
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
        log.error(`${item.name || item.url}: ${/Chrome/.test(e.message) ? e.message : e.stack || e.message}`);
      }
      item.updated_at = new Date().toISOString();
      await writeJson(QUEUE_FILE, queue);
    }
  } finally {
    await browser.close();
  }
  const failed = queue.items.filter((i) => i.status === 'failed');
  console.log(`\nQueue: ${queue.items.filter((i) => i.status === 'done').length}/${queue.items.length} done${failed.length ? `, ${failed.length} failed (npm run resume to retry)` : ''}.`);
}

async function finalizeInterrupted() {
  let slugs = [];
  try {
    slugs = (await fsp.readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return 0;
  }
  let n = 0;
  for (const slug of slugs) {
    const st = await readJson(path.join(gameDir(slug), 'session.json'));
    if (!st || st.status === 'complete') continue;
    log.info(`Recovering interrupted session of "${st.game || slug}" (was: ${st.status})…`);
    const session = st.session || { id: st.session_id, stop_reason: 'interrupted', recovered_at: new Date().toISOString() };
    const m = await buildGame(slug, { game: st.game || slug, provider: st.entry?.provider, session });
    await setSessionState(slug, { status: 'complete' });
    printReport(m, null, rel(gameDir(slug)));
    n++;
  }
  if (n) await rebuildIndex();
  return n;
}

async function main() {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      game: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' }, provider: { type: 'string' },
      list: { type: 'string' }, auto: { type: 'boolean' }, duration: { type: 'string' }, idle: { type: 'string' },
      headless: { type: 'boolean' }, 'no-probe': { type: 'boolean' }, category: { type: 'string' }, limit: { type: 'string' },
      complete: { type: 'boolean' }, json: { type: 'boolean' }, 'no-fetch': { type: 'boolean' },
    },
  });
  const [cmd = 'scrape', ...rest] = positionals;
  const overrides = {};
  if (opts.headless) overrides.headless = true;
  if (opts['no-probe']) overrides.probeMissing = false;
  const settings = await loadSettings(overrides);

  switch (cmd) {
    case 'scrape': {
      const one = opts.game || opts.url;
      if (one) {
        const entry = { name: opts.game || opts.name || null, url: opts.url || null, provider: opts.provider || null };
        await processQueue({ created_at: new Date().toISOString(), single: true, items: [entry] }, settings, opts);
        break;
      }
      const list = await loadGameList(opts.list);
      if (!list.length) {
        console.log(`No games in ${rel(path.join(ROOT, 'config', 'games.txt'))}. Add one name per line, or use --game "Name" / --url URL.`);
        break;
      }
      const queue = { created_at: new Date().toISOString(), source: opts.list || 'config/games.txt', items: list.map((e) => ({ ...e, status: 'pending' })) };
      await writeJson(QUEUE_FILE, queue);
      console.log(`${list.length} game(s) queued.`);
      await processQueue(queue, settings, opts);
      break;
    }
    case 'resume': {
      const recovered = await finalizeInterrupted();
      const queue = await readJson(QUEUE_FILE);
      const left = queue?.items?.filter((i) => i.status !== 'done') || [];
      if (left.length && !queue.single) {
        console.log(`Resuming queue: ${left.length} game(s) left.`);
        for (const i of left) if (i.status === 'running') i.status = 'pending';
        await processQueue(queue, settings, opts);
      } else if (!recovered) console.log('Nothing to resume.');
      break;
    }
    case 'import': {
      // HAR files exported from Chrome DevTools > Network. Default: every .har in Scrap/import/
      const importDir = path.join(ROOT, 'import');
      await fsp.mkdir(path.join(importDir, 'done'), { recursive: true });
      const files = rest.length
        ? rest.map((f) => path.resolve(f))
        : (await fsp.readdir(importDir)).filter((f) => f.toLowerCase().endsWith('.har')).map((f) => path.join(importDir, f));
      if (!files.length) {
        console.log(`Aucun fichier .har dans ${rel(importDir)}/ — enregistrez le Network de Chrome dans ce dossier (voir README).`);
        break;
      }
      for (const file of files) {
        // Game name: --game, else the file name ("Interrogator.har", "Interrogator 2.har", "interrogator-bonus.har"…)
        const name = opts.game || path.basename(file, path.extname(file)).replace(/\s*\(\d+\)$/, '').replace(/[\s_-]+(bonus|part\s*\d+)$/i, '').trim() || 'game';
        const slug = slugify(name);
        const store = await new GameStore(slug).init();
        const prev = await readJson(path.join(gameDir(slug), 'manifest.json'), {});
        const knownSkeletonShas = new Set(Object.entries(prev?.ids || {}).filter(([, f]) => f.startsWith('package_')).map(([s]) => s));
        const sessionId = new Date().toISOString();
        console.log(`\n▶ Import ${path.basename(file)}  →  ${name}  (${rel(gameDir(slug))}/)`);
        await setSessionState(slug, { status: 'capturing', session_id: sessionId, game: name, entry: { name, provider: opts.provider || null } });
        let r;
        try {
          r = await importHar(file, { store, settings, sessionId, knownSkeletonShas, allowFetch: !opts['no-fetch'] });
        } catch (e) {
          log.error(e.message);
          continue;
        }
        const session = { id: sessionId, started_at: sessionId, ended_at: new Date().toISOString(), stop_reason: 'har_import', mode: 'har', source_file: path.basename(file), counters: r.counters };
        await setSessionState(slug, { status: 'building', session });
        const m = await buildGame(slug, { game: name, provider: opts.provider || null, gameUrls: r.gameUrls, session });
        await setSessionState(slug, { status: 'complete' });
        await rebuildIndex();
        printReport(m, r.counters, rel(gameDir(slug)));
        if (file.startsWith(importDir + path.sep)) {
          await fsp.rename(file, path.join(importDir, 'done', `${sessionId.replace(/[:.]/g, '-')}_${path.basename(file)}`)).catch(() => {});
        }
      }
      break;
    }
    case 'repair': {
      // Re-download empty/invalid files of an existing capture + completion pass, then rebuild.
      const only = opts.game ? slugify(opts.game) : null;
      const slugs = (await fsp.readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory() && (!only || d.name === only)).map((d) => d.name);
      for (const slug of slugs) {
        if (!(await exists(path.join(gameDir(slug), 'network', 'network.jsonl')))) continue;
        const st = await readJson(path.join(gameDir(slug), 'session.json'), {});
        const prev = await readJson(path.join(gameDir(slug), 'manifest.json'), {});
        const name = prev?.game || st?.game || slug;
        console.log(`\n▶ Réparation de ${name}`);
        const store = await new GameStore(slug).init();
        const knownSkeletonShas = new Set(Object.entries(prev?.ids || {}).filter(([, f]) => f.startsWith('package_')).map(([s]) => s));
        const sessionId = new Date().toISOString();
        const r = await repairGame({ store, settings, sessionId, knownSkeletonShas });
        const session = st?.status && st.status !== 'complete' && st.session ? st.session : { id: sessionId, stop_reason: 'repair', mode: 'repair', counters: r.counters };
        const m = await buildGame(slug, { game: name, provider: prev?.provider || st?.entry?.provider, session });
        await setSessionState(slug, { status: 'complete' });
        printReport(m, null, rel(gameDir(slug)));
      }
      await rebuildIndex();
      break;
    }
    case 'login': {
      if ((settings.browserMode || 'attach') === 'attach') {
        console.log('Mode "attach" : Scrap utilise votre Chrome déjà ouvert et votre session. Pas besoin de login.');
        break;
      }
      const browser = new BrowserManager({ ...settings, headless: false });
      const page = await browser.page();
      await page.goto(settings.baseUrl).catch(() => {});
      console.log('Log in in the browser window (the session is kept in .browser-profile/). Press ENTER here when done.');
      await new Promise((r) => readline.createInterface({ input: process.stdin }).once('line', r));
      await browser.close();
      break;
    }
    case 'rebuild': {
      const only = opts.game ? slugify(opts.game) : null;
      const slugs = (await fsp.readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory() && (!only || d.name === only)).map((d) => d.name);
      for (const slug of slugs) {
        if (!(await exists(path.join(gameDir(slug), 'network', 'resources.jsonl')))) continue;
        const prev = await readJson(path.join(gameDir(slug), 'manifest.json'), {});
        const m = await buildGame(slug, { game: prev?.game || slug, provider: prev?.provider });
        printReport(m, null, rel(gameDir(slug)));
      }
      const r = await rebuildIndex();
      console.log(`Index: ${r.games} game(s), ${r.packages} Spine package(s), ${r.assets} asset(s).`);
      break;
    }
    case 'index': {
      const r = await rebuildIndex();
      console.log(`Index: ${r.games} game(s), ${r.packages} Spine package(s), ${r.assets} asset(s).`);
      break;
    }
    case 'search': {
      const res = await searchPackages(rest.join(' '), { category: opts.category, game: opts.game, limit: Number(opts.limit || 20), completeOnly: opts.complete });
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      if (!res.length) console.log('No match.');
      for (const p of res) {
        console.log(`${p.complete ? '✔' : '…'} ${p.path}   [${p.category}${p.subtypes.length ? ': ' + p.subtypes.join(', ') : ''}]  ${p.game}`);
        console.log(`    anims: ${p.animations.map((a) => a.name).join(', ') || '—'}`);
      }
      break;
    }
    default:
      console.log('Commands: scrape | import | repair | resume | login | rebuild | index | search');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    log.error(e.stack || e.message);
    process.exit(1);
  },
);
