// Network observer: the automated equivalent of DevTools > Network for the whole browser context
// (all tabs, all frames incl. cross-origin game iframes). It only reads what the browser loads;
// the only active requests are refetches/probes of plain static URLs using the same session.
import { detect, isSkeletonKind } from './detect/index.js';
import { coverage } from './analyze/associate.js';
import { log } from './lib/log.js';
import {
  iso, sha256, sanitizeUrl, urlKey, filenameFromUrl, extOf, stemOf, dirOfKey, hostOf, retry, NonRetryableError, withTimeout, sleep,
} from './lib/util.js';

const SKIP_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'font', 'media', 'websocket', 'eventsource', 'manifest', 'texttrack', 'ping', 'cspreport']);
const CANDIDATE_EXT = new Set(['json', 'atlas', 'atlas.txt', 'txt', 'skel', 'skel.bytes', 'bin', 'binary', 'bytes', 'spine', 'png', 'webp', 'jpg', 'jpeg', 'avif', 'gif', 'ktx', 'ktx2', 'basis', 'dds', 'pvr']);
const SKIP_EXT = new Set(['js', 'mjs', 'css', 'html', 'htm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'wav', 'flac', 'mp4', 'webm', 'm3u8', 'ts', 'wasm', 'map', 'svg', 'ico']);

/**
 * Chrome sometimes hands back an EMPTY body for a 200 response (chunked/compressed, evicted buffer).
 * Returns a description of the problem, or null when the body looks like a real file.
 */
export function bodyProblem(body, url, ct) {
  if (!body || body.length === 0) return 'empty body';
  let ext = '';
  try {
    ext = extOf(new URL(url).pathname);
  } catch {
    /* ignore */
  }
  const isJson = ext === 'json' || /json/i.test(ct || '');
  if (isJson && body.length < 64 * 1024 * 1024) {
    const head = body.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (head[0] === '{' || head[0] === '[') {
      try {
        JSON.parse(body.toString('utf8').replace(/^\uFEFF/, ''));
      } catch {
        return 'truncated or invalid JSON';
      }
    }
  }
  return null;
}

/** Shared by live capture and HAR import: is this response worth storing? */
export function isCandidateResource({ method, status, resourceType, url, ct, scope }, settings) {
  if (method !== 'GET') return false;
  if (status < 200 || status >= 300 || status === 204) return false;
  if (scope === 'site' && !settings.captureSiteAssets) return false;
  if (SKIP_RESOURCE_TYPES.has(String(resourceType || '').toLowerCase())) return false;
  let ext = '';
  try {
    ext = extOf(new URL(url).pathname);
  } catch {
    /* ignore */
  }
  if (CANDIDATE_EXT.has(ext)) return true;
  if (SKIP_EXT.has(ext)) return false;
  const base = String(ct || '').split(';')[0].trim().toLowerCase();
  if (base.startsWith('image/')) return base !== 'image/svg+xml' && base !== 'image/x-icon';
  return /json|text\/plain|octet-stream|binary|application\/x-spine|^$/.test(base);
}

export class CaptureSession {
  constructor({ context, store, settings, sessionId, knownSkeletonShas = new Set(), pageFilter = null }) {
    this.pageFilter = pageFilter; // attach mode: only the tab(s) Scrap opened, never your other tabs
    this.context = context;
    this.store = store;
    this.settings = settings;
    this.sessionId = sessionId;
    this.knownSkeletonShas = knownSkeletonShas;
    this.counters = { requests: 0, finished: 0, failed: 0, candidates: 0, images: 0, json: 0, atlases: 0, skeletons: 0, newSkeletons: 0, bytes: 0, errors: 0, probes: 0 };
    this.seenSha = new Set();
    this.fullUrlByKey = new Map(); // in-memory only: real URLs (may contain tokens) are never written
    this.seenKeys = new Set();
    this.seenDirStems = new Set();
    this.imageDirStems = new Set(); // dir|stem of captured images only (detects .webp/hashed variants of a page)
    this.atlases = []; // {fullUrl, key, stem, det, frameUrl}
    this.skeletons = [];
    this.probed = new Set();
    this.pending = new Set();
    this.startedAt = Date.now();
    this.lastCandidateAt = Date.now();
    this.stopped = false;
    this.gameFrameUrls = new Set();
    this.handlers = {
      request: (req) => this.mine(req) && this.counters.requests++,
      requestfinished: (req) => this.mine(req) && this.track(this.onFinished(req, false)),
      requestfailed: (req) => this.mine(req) && this.track(this.onFinished(req, true)),
    };
  }

  mine(req) {
    if (!this.pageFilter) return true;
    try {
      return this.pageFilter(req.frame().page());
    } catch {
      return false; // worker requests cannot be attributed to a tab
    }
  }

  start() {
    for (const [ev, fn] of Object.entries(this.handlers)) this.context.on(ev, fn);
  }

  track(p) {
    this.pending.add(p);
    p.catch((e) => {
      this.counters.errors++;
      log.debug(`capture handler error: ${e.message}`);
    }).finally(() => this.pending.delete(p));
  }

  isSiteHost(url) {
    const h = hostOf(url);
    return this.settings.siteHosts.some((s) => h === s || h.endsWith('.' + s));
  }

  scopeOf(req) {
    try {
      const f = req.frame();
      if (!f.parentFrame() && this.isSiteHost(f.url())) return 'site';
      if (f.parentFrame()) this.gameFrameUrls.add(sanitizeUrl(f.url()));
    } catch {
      /* worker / service-worker request: treat as game */
    }
    return 'game';
  }

  isCandidate(req, res, url, ct, scope) {
    if (!res) return false;
    return isCandidateResource({ method: req.method(), status: res.status(), resourceType: req.resourceType(), url, ct, scope }, this.settings);
  }

  async onFinished(req, failed) {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome')) return;
    const now = Date.now();
    if (failed) this.counters.failed++;
    else this.counters.finished++;
    let res = null;
    if (!failed) res = await req.response().catch(() => null);
    const timing = (() => {
      try {
        return req.timing();
      } catch {
        return null;
      }
    })();
    const tsReq = timing?.startTime > 0 ? timing.startTime : null;
    const tsRes = tsReq && timing.responseStart >= 0 ? tsReq + timing.responseStart : null;
    let frameUrl = null;
    try {
      frameUrl = req.frame().url();
    } catch {
      /* worker */
    }
    const scope = this.scopeOf(req);
    const headers = res ? await res.allHeaders().catch(() => res.headers()) : {};
    const ct = headers['content-type'] || '';
    const rec = {
      session: this.sessionId,
      url: sanitizeUrl(url),
      method: req.method(),
      status: res ? res.status() : null,
      content_type: ct || null,
      content_length: headers['content-length'] != null ? Number(headers['content-length']) : null,
      content_encoding: headers['content-encoding'] || null,
      resource_type: req.resourceType(),
      ts_request: iso(tsReq),
      ts_response: iso(tsRes),
      ts_finished: iso(now),
      scope,
      initiator_frame: frameUrl ? sanitizeUrl(frameUrl) : null,
      referer: (() => {
        const r = req.headers().referer;
        return r ? sanitizeUrl(r) : null;
      })(),
      from_service_worker: res ? res.fromServiceWorker() : false,
    };
    if (failed) rec.failure = req.failure()?.errorText || 'failed';

    if (!failed && this.isCandidate(req, res, url, ct, scope)) {
      rec.candidate = true;
      let body = null;
      let source = 'network';
      try {
        body = await withTimeout(res.body(), this.settings.requestTimeoutMs, 'response body');
      } catch (e) {
        rec.body_error = e.message.split('\n')[0];
      }
      const cl = rec.content_length;
      if (body && res.status() === 206) {
        rec.body_error = 'partial content (206)';
        body = null;
      } else if (body && cl != null && !rec.content_encoding && cl !== body.length) {
        rec.body_error = `truncated body (${body.length}/${cl} bytes)`;
        body = null;
      } else if (body && bodyProblem(body, url, ct)) {
        rec.body_error = bodyProblem(body, url, ct);
        body = null;
      }
      if (!body && !this.contextClosed) {
        try {
          body = await this.fetchUrl(url, frameUrl);
          const problem = bodyProblem(body, url, ct);
          if (problem) throw new Error(`refetched body still invalid: ${problem}`);
          source = 'collector_refetch';
        } catch (e) {
          rec.error = e.message.split('\n')[0];
          log.warn(`could not retrieve ${rec.url}: ${rec.error}`);
        }
      }
      if (body && body.length > this.settings.maxResourceBytes) {
        rec.error = `skipped: larger than maxResourceBytes (${body.length})`;
        body = null;
      }
      if (body) {
        const info = await this.ingest(body, { url, frameUrl, contentType: ct, status: res.status(), source, tsRequest: rec.ts_request, tsResponse: rec.ts_response });
        rec.sha256 = info.sha;
        rec.kind = info.kind;
        rec.source = source;
      }
    }
    await this.store.appendNetwork(rec);
  }

  /** Frame to fetch from: the one that loaded the asset, else one of the same origin, else any page. */
  pickFrame(url, referer) {
    const frames = this.context.pages().filter((p) => !p.isClosed() && (!this.pageFilter || this.pageFilter(p))).flatMap((p) => p.frames());
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      /* ignore */
    }
    const sameOrigin = (f) => {
      try {
        return new URL(f.url()).origin === origin;
      } catch {
        return false;
      }
    };
    return frames.find((f) => referer && f.url() === referer) || frames.find(sameOrigin) || frames.find((f) => /^https?:/.test(f.url())) || null;
  }

  /** fetch() executed inside the browser: same network stack as the game (proxy / VPN extension, cookies). */
  async fetchInBrowser(url, referer) {
    const frame = this.pickFrame(url, referer);
    if (!frame) throw new Error('no open page to fetch from');
    const r = await frame.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        if (!res.ok) return { status: res.status };
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return { status: res.status, b64: btoa(s) };
      } catch (e) {
        return { error: String(e) };
      }
    }, url);
    if (r.error) throw new Error(`in-browser fetch: ${r.error}`);
    return { status: r.status, body: r.b64 != null ? Buffer.from(r.b64, 'base64') : null };
  }

  /** GET with the browser's own session, with retries. */
  async fetchUrl(url, referer) {
    const { attempts, backoffMs } = this.settings.retry;
    return retry(
      async () => {
        let viaBrowser = null;
        try {
          viaBrowser = await withTimeout(this.fetchInBrowser(url, referer), this.settings.requestTimeoutMs, 'in-browser fetch');
        } catch (e) {
          log.debug(`${e.message} — ${sanitizeUrl(url)}`);
        }
        if (viaBrowser) {
          const st = viaBrowser.status;
          if (st === 401 || st === 403) throw new NonRetryableError(`HTTP ${st} (expired or protected URL, not bypassed)`);
          if (st === 404 || st === 410) throw new NonRetryableError(`HTTP ${st}`);
          if (viaBrowser.body) return viaBrowser.body;
          throw new Error(`HTTP ${st}`);
        }
        // CORS blocked the in-page fetch. With your own Chrome (VPN in the browser) we stop here
        // rather than going out from Node without the VPN.
        if ((this.settings.browserMode || 'attach') === 'attach') throw new NonRetryableError('not retrievable from the browser (CORS)');
        const r = await this.context.request.get(url, {
          headers: referer ? { referer } : {},
          timeout: this.settings.requestTimeoutMs,
          failOnStatusCode: false,
        });
        const st = r.status();
        if (st === 401 || st === 403) throw new NonRetryableError(`HTTP ${st} (expired or protected URL, not bypassed)`);
        if (st === 404 || st === 410) throw new NonRetryableError(`HTTP ${st}`);
        if (st < 200 || st >= 300) throw new Error(`HTTP ${st}`);
        return await r.body();
      },
      { attempts, backoffMs },
    );
  }

  async ingest(body, meta) {
    const filename = filenameFromUrl(meta.url);
    const saved = await this.store.saveResource(body, { ...meta, filename, session: this.sessionId });
    const key = urlKey(meta.url);
    this.fullUrlByKey.set(key, meta.url);
    this.seenKeys.add(key);
    this.seenDirStems.add(dirOfKey(key) + '|' + stemOf(filename));
    this.lastCandidateAt = Date.now();
    if (this.seenSha.has(saved.sha)) return { sha: saved.sha, kind: 'duplicate' };
    this.seenSha.add(saved.sha);
    this.counters.candidates++;
    this.counters.bytes += body.length;

    let det;
    try {
      det = detect(body, { filename });
    } catch (e) {
      det = { kind: 'binary' };
      log.debug(`detect failed for ${filename}: ${e.message}`);
    }
    const entry = { fullUrl: meta.url, key, stem: stemOf(filename), det, frameUrl: meta.frameUrl, filename };
    if (det.kind === 'image' || det.kind === 'texture') {
      this.counters.images++;
      this.imageDirStems.add(dirOfKey(key) + '|' + entry.stem);
    }
    if (['json', 'json-bundle', 'spritesheet', 'dragonbones', 'spine-json'].includes(det.kind)) this.counters.json++;
    if (det.kind === 'spine-atlas') {
      this.counters.atlases++;
      this.atlases.push(entry);
      log.info(`+ atlas      ${filename}  (${det.atlas.pages.length} page(s), ${det.atlas.regionCount} regions)`);
    }
    const skels = [];
    if (isSkeletonKind(det.kind)) skels.push({ sha: saved.sha, det, name: filename });
    if (det.kind === 'json-bundle') {
      for (const e of det.embedded) {
        if (e.type === 'spine-json') {
          skels.push({ sha: sha256(e.data), det: detect(e.data, { filename: e.name }), name: `${filename} › ${e.name}` });
        }
        if (e.type === 'spine-atlas') this.counters.atlases++;
      }
    }
    for (const s of skels) {
      this.counters.skeletons++;
      const isNew = !this.knownSkeletonShas.has(s.sha);
      if (isNew) this.counters.newSkeletons++;
      if (s.det === det) this.skeletons.push(entry);
      const anims = s.det.kind === 'spine-json' ? s.det.spine.animations.map((a) => a.name) : null;
      const v = s.det.kind === 'spine-json' ? s.det.spine.version : s.det.skel.version;
      log.info(
        `+ skeleton   ${s.name}  (spine ${v || '?'}${anims ? `, ${anims.length} anim: ${anims.slice(0, 6).join(', ')}${anims.length > 6 ? '…' : ''}` : ', binary'})${isNew ? '  NEW' : ''}`,
      );
    }
    return { sha: saved.sha, kind: det.kind };
  }

  /**
   * Completion pass: files that the atlases/skeletons reference but the game never requested
   * (or requested before capture started). Plain GETs of the sibling static URLs only.
   */
  async probeMissing() {
    if (!this.settings.probeMissing || this.contextClosed) return;
    const targets = new Map(); // url -> reason
    const want = (url, reason) => {
      const key = urlKey(url);
      if (!key || this.seenKeys.has(key) || this.probed.has(url)) return;
      if (!targets.has(url)) targets.set(url, { reason, referer: null });
    };
    for (const a of this.atlases) {
      for (const p of a.det.atlas.pages) {
        let target;
        try {
          target = new URL(p.name, a.fullUrl).toString();
        } catch {
          continue;
        }
        const k = urlKey(target);
        // a variant (.webp instead of .png, hashed name) already loaded from the same folder counts as present
        if (this.seenKeys.has(k) || this.imageDirStems.has(dirOfKey(k) + '|' + stemOf(p.name))) continue;
        want(target, `atlas page of ${a.filename}`);
        if (targets.has(target)) targets.get(target).referer = a.frameUrl;
      }
      const hasSkeleton = this.skeletons.some(
        (s) => (s.stem === a.stem && dirOfKey(s.key) === dirOfKey(a.key)) || (coverage(s.det, a.det.atlas).ratio ?? 0) >= 0.6,
      );
      if (!hasSkeleton) for (const ext of ['.json', '.skel']) want(new URL(a.stem + ext, a.fullUrl).toString(), `skeleton for ${a.filename}`);
    }
    for (const s of this.skeletons) {
      const hasAtlas = this.atlases.some(
        (a) => (a.stem === s.stem && dirOfKey(a.key) === dirOfKey(s.key)) || (coverage(s.det, a.det.atlas).ratio ?? 0) >= 0.6,
      );
      if (!hasAtlas) for (const ext of ['.atlas', '.atlas.txt']) want(new URL(s.stem + ext, s.fullUrl).toString(), `atlas for ${s.filename}`);
    }
    const list = [...targets].slice(0, this.settings.maxProbes);
    if (!list.length) return;
    log.info(`Completion pass: probing ${list.length} referenced file(s) not loaded by the game…`);
    let found = 0;
    // atlas pages first: a fetched page never triggers new probes, a fetched atlas may
    for (const [url, { reason, referer }] of list) {
      this.counters.probes++;
      this.probed.add(url);
      const rec = { session: this.sessionId, url: sanitizeUrl(url), method: 'GET', probe: true, reason, ts_request: iso(Date.now()) };
      try {
        const body = await this.fetchUrl(url, referer);
        const info = await this.ingest(body, { url, frameUrl: referer, source: 'collector_probe', status: 200, tsRequest: rec.ts_request });
        Object.assign(rec, { status: 200, sha256: info.sha, kind: info.kind, source: 'collector_probe' });
        found++;
      } catch (e) {
        rec.error = e.message.split('\n')[0];
      }
      await this.store.appendNetwork(rec);
    }
    log.info(`Completion pass: ${found}/${list.length} retrieved.`);
  }

  async stop() {
    this.stopped = true;
    const deadline = Date.now() + this.settings.pendingFlushTimeoutMs;
    while (this.pending.size && Date.now() < deadline) await sleep(200);
    if (this.pending.size) log.warn(`${this.pending.size} response(s) still pending at stop; they are logged as incomplete.`);
    try {
      await this.probeMissing();
      await this.probeMissing(); // a probed atlas can reference pages of its own
    } catch (e) {
      log.warn(`completion pass failed: ${e.message}`);
    }
    for (const [ev, fn] of Object.entries(this.handlers)) this.context.off(ev, fn);
  }
}
