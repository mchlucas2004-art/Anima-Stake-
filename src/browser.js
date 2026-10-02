// Two ways to get a browser:
//  - "attach" (default): plug into YOUR already-open Chrome (same profile, extensions, VPN, login).
//    Scrap opens one tab in it and never closes your browser.
//  - "launch": a separate Playwright Chromium with its own profile (used by the offline test).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';
import { log } from './lib/log.js';

function defaultChromeDataDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge'].map((d) => path.join(base, d));
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return ['Google/Chrome/User Data', 'Chromium/User Data', 'BraveSoftware/Brave-Browser/User Data', 'Microsoft/Edge/User Data'].map((d) => path.join(base, d));
  }
  const base = path.join(home, '.config');
  return ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map((d) => path.join(base, d));
}

/** Chrome writes "<port>\n<ws path>" there when remote debugging is enabled for the running browser. */
function findDevToolsEndpoint(settings) {
  const a = settings.attach || {};
  if (a.cdpUrl) return { url: a.cdpUrl };
  const dirs = a.userDataDir ? [a.userDataDir] : defaultChromeDataDirs();
  const found = [];
  let denied = null;
  for (const d of dirs) {
    const f = path.join(d, 'DevToolsActivePort');
    try {
      const [port, wsPath] = fs.readFileSync(f, 'utf8').trim().split('\n');
      if (port && wsPath) found.push({ url: `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`, mtime: fs.statSync(f).mtimeMs });
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') denied ||= f; // macOS privacy protection
    }
  }
  found.sort((x, y) => y.mtime - x.mtime);
  return { url: found[0]?.url || null, denied };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => (sock.destroy(), resolve(true)));
    sock.on('error', () => resolve(false));
    sock.setTimeout(1500, () => (sock.destroy(), resolve(false)));
  });
}

export const PERMISSION_HELP = (file) => `
Votre Chrome a bien le débogage activé, mais macOS empêche le terminal de lire :
  ${file}
(ce fichier contient l'adresse de connexion à Chrome).
Pour l'autoriser, une seule fois :
  Réglages Système → Confidentialité et sécurité → Accès complet au disque
  → activez l'app depuis laquelle vous lancez la commande (Terminal, iTerm ou Visual Studio Code)
  → quittez complètement cette app (Cmd+Q), rouvrez-la, et relancez la commande.`;

export const ATTACH_HELP = `
Impossible de se brancher sur votre Chrome déjà ouvert.
Une seule fois (dans VOTRE Chrome, celui avec le VPN) :
  1. ouvrez l'adresse   chrome://inspect/#remote-debugging
  2. cochez "Allow remote debugging for this browser instance" (autoriser le débogage à distance)
  3. relancez la commande ; si Chrome affiche "Autoriser le débogage à distance ?", cliquez Autoriser.
(Alternative : réglage "attach.cdpUrl" dans config/settings.json, ex. "http://127.0.0.1:9222".)`;

export class BrowserManager {
  constructor(settings) {
    this.settings = settings;
    this.mode = settings.browserMode || 'attach';
    this.context = null;
    this.browser = null;
    this.ownPage = null;
    this.ownPages = new Set();
    this.closed = false;
  }

  async ensure() {
    if (this.context && !this.closed) return this.context;
    this.closed = false;
    if (this.mode === 'attach') {
      const { url, denied } = findDevToolsEndpoint(this.settings);
      const candidates = url ? [url] : [];
      // File unreadable/missing but Chrome listens on the default port: try the generic browser endpoint.
      if (!url && (await portOpen(9222))) candidates.push('ws://127.0.0.1:9222/devtools/browser', 'http://127.0.0.1:9222');
      if (!candidates.length) throw new Error(denied ? PERMISSION_HELP(denied) : ATTACH_HELP);
      log.info('Connexion à votre Chrome déjà ouvert… → si Chrome affiche "Autoriser le débogage à distance ?", cliquez AUTORISER.');
      let lastErr = null;
      for (const c of candidates) {
        try {
          this.browser = await chromium.connectOverCDP(c, { timeout: url ? 120000 : 45000 });
          break;
        } catch (e) {
          lastErr = e;
          log.debug(`connectOverCDP ${c}: ${e.message.split('\n')[0]}`);
        }
      }
      if (!this.browser) {
        const help = denied ? PERMISSION_HELP(denied) : ATTACH_HELP;
        throw new Error(`${lastErr?.message.split('\n')[0] || 'connexion refusée'}\n${help}`);
      }
      this.context = this.browser.contexts()[0] || (await this.browser.newContext());
      this.closedPromise = new Promise((r) => this.browser.once('disconnected', () => ((this.closed = true), r())));
      log.info('Connecté à votre Chrome (profil, extensions et VPN inchangés).');
    } else {
      await fsp.mkdir(this.settings.profileDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.settings.profileDir, {
        headless: this.settings.headless,
        channel: this.settings.browserChannel || undefined,
        viewport: null,
        args: this.settings.headless ? [] : ['--start-maximized'],
      });
      this.closedPromise = new Promise((r) => this.context.once('close', () => ((this.closed = true), r())));
    }
    return this.context;
  }

  /** The tab Scrap drives. In attach mode it is a new tab of your browser, reused for every game. */
  async page() {
    const ctx = await this.ensure();
    if (this.ownPage && !this.ownPage.isClosed()) return this.ownPage;
    if (this.mode === 'attach') {
      this.ownPage = await ctx.newPage();
      this.ownPages.add(this.ownPage);
      this.ownPage.on('popup', (p) => this.ownPages.add(p)); // game opened in a new window by the site
      await this.ownPage.bringToFront().catch(() => {});
    } else this.ownPage = ctx.pages()[0] || (await ctx.newPage());
    return this.ownPage;
  }

  /** Which tabs belong to the capture (attach mode: only Scrap's own tab and its popups). */
  pageFilter() {
    return this.mode === 'attach' ? (p) => this.ownPages.has(p) : null;
  }

  async close() {
    if (this.closed) return;
    // Never close the user's browser: only drop the connection (the Scrap tab stays open).
    if (this.mode === 'attach') return;
    await this.context?.close().catch(() => {});
  }
}
