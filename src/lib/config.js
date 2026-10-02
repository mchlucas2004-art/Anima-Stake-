import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR, ROOT } from './paths.js';
import { readJson, hostOf } from './util.js';

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://stake.com',
  // Hosts of the casino site itself. Resources loaded by the top-level page of these hosts
  // (lobby thumbnails, site UI) are logged but not collected, unless captureSiteAssets is true.
  siteHosts: ['stake.com', 'stake.us', 'stake.bet', 'stake.games', 'stake.ac', 'stake.pet', 'stake.mba', 'stake.jp', 'stake.bz', 'stake.ceo', 'stake.krd'],
  captureSiteAssets: false,
  // "attach": use your already-open Chrome (its VPN, extensions, login). "launch": separate Playwright Chromium.
  browserMode: 'attach',
  attach: { userDataDir: null, cdpUrl: null },
  headless: false,
  browserChannel: null, // e.g. "chrome" to use the installed Google Chrome instead of Playwright Chromium
  profileDir: '.browser-profile',
  navigationTimeoutMs: 60000,
  maxResourceBytes: 150 * 1024 * 1024,
  probeMissing: true, // fetch atlas pages / atlases referenced but never requested by the game
  maxProbes: 300,
  retry: { attempts: 3, backoffMs: 1000 },
  requestTimeoutMs: 45000,
  auto: { durationSec: 120, idleStopSec: 25, minDurationSec: 20, clickPlay: true },
  pendingFlushTimeoutMs: 30000,
};

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
}

export async function loadSettings(overrides = {}) {
  let s = merge(DEFAULT_SETTINGS, await readJson(path.join(CONFIG_DIR, 'settings.json'), {}));
  if (process.env.SCRAP_SETTINGS_JSON) s = merge(s, JSON.parse(process.env.SCRAP_SETTINGS_JSON));
  s = merge(s, overrides);
  const baseHost = hostOf(s.baseUrl).replace(/^www\./, '');
  if (baseHost && !s.siteHosts.includes(baseHost)) s.siteHosts = [...s.siteHosts, baseHost];
  s.profileDir = path.resolve(ROOT, s.profileDir);
  return s;
}

/**
 * games.txt: one game per line. Optional extra columns separated by "|":
 *   Le Bandit
 *   Le Bandit | https://stake.com/casino/games/hacksaw-le-bandit | Hacksaw Gaming
 *   https://stake.com/casino/games/some-game
 * games.json: [{ "name": "...", "url": null, "provider": null }]
 */
export async function loadGameList(listPath) {
  const entries = [];
  const files = listPath
    ? [path.resolve(listPath)]
    : [path.join(CONFIG_DIR, 'games.txt'), path.join(CONFIG_DIR, 'games.json')];
  for (const f of files) {
    let text;
    try {
      text = await fsp.readFile(f, 'utf8');
    } catch {
      continue;
    }
    if (f.endsWith('.json')) {
      const arr = JSON.parse(text);
      for (const e of Array.isArray(arr) ? arr : [])
        if (e && (e.name || e.url)) entries.push({ name: e.name || null, url: e.url || null, provider: e.provider || null });
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cols = line.split('|').map((c) => c.trim());
      if (/^https?:\/\//i.test(cols[0])) entries.push({ name: null, url: cols[0], provider: cols[1] || null });
      else entries.push({ name: cols[0], url: cols[1] || null, provider: cols[2] || null });
    }
  }
  const seen = new Set();
  return entries.filter((e) => {
    const k = (e.name || e.url).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
