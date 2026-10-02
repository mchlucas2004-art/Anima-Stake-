// Finds a game's page on the casino site from its name, by using the site the way a user would
// (search box, then the game links it shows). Falls back to manual navigation by the user.
import { log } from './lib/log.js';
import { slugify, sleep } from './lib/util.js';

const SEARCH_SELECTORS = [
  'input[type="search"]',
  'input[placeholder*="earch" i]',
  'input[placeholder*="echerch" i]',
  'input[data-testid*="search" i]',
  'input[name*="search" i]',
];

function similarity(name, href) {
  const want = slugify(name).split('-').filter(Boolean);
  const m = href.match(/\/casino\/games\/([^/?#]+)/);
  if (!m) return 0;
  const have = new Set(m[1].split('-'));
  const hits = want.filter((w) => have.has(w)).length;
  const extra = have.size - hits;
  return hits / want.length - Math.min(extra, 6) * 0.03; // provider prefix in the slug costs a little
}

async function collectGameLinks(page) {
  return page
    .$$eval('a[href*="/casino/games/"]', (as) => [...new Set(as.map((a) => a.href))])
    .catch(() => []);
}

function best(name, links) {
  return links.map((href) => ({ href, s: similarity(name, href) })).sort((a, b) => b.s - a.s)[0];
}

export async function resolveGameUrl(page, entry, settings, cache) {
  if (entry.url) return { url: entry.url, method: 'provided' };
  const cached = cache?.[entry.name.toLowerCase()];
  if (cached) return { url: cached, method: 'cache' };
  const base = settings.baseUrl.replace(/\/$/, '');

  try {
    await page.goto(`${base}/casino/home`, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    await sleep(2500);
    for (const sel of SEARCH_SELECTORS) {
      const input = page.locator(sel).first();
      if (!(await input.isVisible().catch(() => false))) continue;
      await input.click();
      await input.fill(entry.name);
      await sleep(3000);
      const b = best(entry.name, await collectGameLinks(page));
      if (b && b.s >= 0.75) return { url: b.href, method: 'site_search' };
      break;
    }
  } catch (e) {
    log.warn(`site search failed: ${e.message.split('\n')[0]}`);
  }

  // Direct slug guess (games without provider prefix in their slug).
  try {
    const guess = `${base}/casino/games/${slugify(entry.name)}`;
    const r = await page.goto(guess, { waitUntil: 'domcontentloaded', timeout: settings.navigationTimeoutMs });
    await sleep(2500);
    const title = (await page.title().catch(() => '')).toLowerCase();
    const words = slugify(entry.name).split('-');
    if (r && r.status() < 400 && page.url().includes('/casino/games/') && words.every((w) => title.includes(w)))
      return { url: page.url(), method: 'slug_guess' };
  } catch {
    /* fall through */
  }
  return null;
}

/** Best-effort click on a demo / fun-play button inside the game page (auto mode only). */
export async function tryClickPlay(page) {
  const re = /fun play|play for fun|demo|jouer gratuitement|mode démo|practice|free play/i;
  for (const frame of page.frames()) {
    try {
      const btn = frame.getByRole('button', { name: re }).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 2000 });
        log.info('Clicked a demo/fun-play button.');
        return true;
      }
    } catch {
      /* not there */
    }
  }
  return false;
}
