// Import of a DevTools Network export (.har): same pipeline as the live capture, but the
// requests come from YOUR browser (VPN, session) via Chrome DevTools > Network > Export HAR.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CaptureSession, isCandidateResource, bodyProblem } from './capture.js';
import { log } from './lib/log.js';
import { retry, NonRetryableError, sanitizeUrl, hostOf, iso } from './lib/util.js';

const MAX_HAR_BYTES = 480 * 1024 * 1024; // V8 cannot hold a much larger JSON string

/** Session fed from a HAR file; missing bodies / probes are fetched directly (public CDN files). */
export class HarSession extends CaptureSession {
  constructor(opts) {
    super({ ...opts, context: null });
    this.allowFetch = opts.allowFetch;
  }

  async fetchUrl(url, referer) {
    if (!this.allowFetch) throw new NonRetryableError('fetch disabled (--no-fetch)');
    const { attempts, backoffMs } = this.settings.retry;
    return retry(
      async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.settings.requestTimeoutMs);
        try {
          const r = await fetch(url, { headers: referer ? { referer } : {}, signal: ctrl.signal, redirect: 'follow' });
          const st = r.status;
          if (st === 401 || st === 403) throw new NonRetryableError(`HTTP ${st} (expired or protected URL, not bypassed)`);
          if (st === 404 || st === 410) throw new NonRetryableError(`HTTP ${st}`);
          if (st < 200 || st >= 300) throw new Error(`HTTP ${st}`);
          return Buffer.from(await r.arrayBuffer());
        } finally {
          clearTimeout(t);
        }
      },
      { attempts, backoffMs },
    );
  }
}

const header = (headers, name) => headers?.find((h) => h.name.toLowerCase() === name)?.value ?? null;

function bodyOf(content) {
  if (!content || content.text == null) return null;
  if (content.encoding === 'base64') return Buffer.from(content.text, 'base64');
  return Buffer.from(content.text, 'utf8');
}

function isSiteUrl(url, settings) {
  const h = hostOf(url);
  return [...settings.siteHosts, ...(settings.siteAssetHosts || [])].some((s) => h === s || h.endsWith('.' + s));
}

export async function importHar(file, { store, settings, sessionId, knownSkeletonShas, allowFetch = true }) {
  const stat = await fsp.stat(file);
  if (stat.size > MAX_HAR_BYTES)
    throw new Error(`HAR trop gros (${Math.round(stat.size / 1e6)} Mo). Exportez en plusieurs fois (ex. après le chargement, puis après le bonus).`);
  let har;
  try {
    har = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`${path.basename(file)} n'est pas un HAR valide : ${e.message}`);
  }
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error(`${path.basename(file)} : aucune entrée réseau (log.entries).`);

  const session = new HarSession({ store, settings, sessionId, knownSkeletonShas, allowFetch });
  const c = session.counters;
  let missingBodies = 0;
  for (const e of entries) {
    const req = e.request || {};
    const res = e.response || {};
    const url = req.url || '';
    if (!/^https?:/i.test(url)) continue;
    c.requests++;
    const start = Date.parse(e.startedDateTime) || null;
    const t = e.timings || {};
    const pos = (x) => (typeof x === 'number' && x > 0 ? x : 0);
    const tsResponse = start ? start + pos(t.blocked) + pos(t.dns) + pos(t.connect) + pos(t.send) + pos(t.wait) : null;
    const ct = res.content?.mimeType || header(res.headers, 'content-type') || '';
    const initiator = e._initiator?.url || e._initiator?.stack?.callFrames?.[0]?.url || null;
    const scope = isSiteUrl(url, settings) ? 'site' : 'game';
    const rec = {
      session: sessionId,
      source_file: path.basename(file),
      url: sanitizeUrl(url),
      method: req.method,
      status: res.status || null,
      content_type: ct || null,
      content_length: Number(header(res.headers, 'content-length')) || res.content?.size || null,
      resource_type: e._resourceType || null,
      ts_request: iso(start),
      ts_response: iso(tsResponse),
      ts_finished: iso(start && e.time ? start + e.time : null),
      scope,
      initiator: initiator ? sanitizeUrl(initiator) : null,
      from_cache: !!e._fromCache || res.status === 304,
    };
    if (res.status === 0 || e._error) {
      c.failed++;
      rec.failure = e._error || 'failed';
    } else c.finished++;

    const status = res.status === 304 ? 200 : res.status; // cached: body may still be in the HAR
    if (isCandidateResource({ method: req.method, status, resourceType: e._resourceType, url, ct, scope }, settings)) {
      rec.candidate = true;
      let body = bodyOf(res.content);
      let source = 'har';
      if (body && bodyProblem(body, url, ct)) body = null;
      if (!body) {
        missingBodies++;
        try {
          body = await session.fetchUrl(url, initiator);
          const problem = bodyProblem(body, url, ct);
          if (problem) throw new Error(problem);
          source = 'collector_refetch';
        } catch (err) {
          rec.error = `body absent from HAR, ${err.message}`;
        }
      }
      if (body && body.length > settings.maxResourceBytes) {
        rec.error = `skipped: larger than maxResourceBytes (${body.length})`;
        body = null;
      }
      if (body) {
        const info = await session.ingest(body, { url, frameUrl: initiator, contentType: ct, status: 200, source, tsRequest: rec.ts_request, tsResponse: rec.ts_response });
        Object.assign(rec, { sha256: info.sha, kind: info.kind, source });
      }
    }
    await store.appendNetwork(rec);
  }
  if (missingBodies) log.info(`${missingBodies} ressource(s) sans contenu dans le HAR → re-téléchargées depuis leur URL quand c'était possible.`);
  if (allowFetch) await session.probeMissing().catch((e) => log.warn(`completion pass failed: ${e.message}`));
  const pages = (har.log.pages || []).map((p) => p.title).filter((x) => /^https?:/.test(x || ''));
  return { counters: c, gameUrls: pages.map(sanitizeUrl), entries: entries.length };
}

/**
 * Repairs an existing capture: re-downloads every candidate whose stored body was empty/invalid,
 * then runs the completion pass (atlas pages, sibling atlas/skeleton) over ALL known resources.
 */
export async function repairGame({ store, settings, sessionId, knownSkeletonShas }) {
  const { readJsonl, dirOfKey, stemOf, filenameFromUrl } = await import('./lib/util.js');
  const { detect, isSkeletonKind } = await import('./detect/index.js');
  const session = new HarSession({ store, settings, sessionId, knownSkeletonShas, allowFetch: true });

  // 1. seed the session with what is already stored, so the completion pass knows every atlas/skeleton
  const seen = new Set();
  for (const r of await readJsonl(path.join(store.dir, 'network', 'resources.jsonl'))) {
    if (r.url_key) session.seenKeys.add(r.url_key);
    if (!r.sha256 || seen.has(r.sha256)) continue;
    seen.add(r.sha256);
    let buf;
    try {
      buf = await fsp.readFile(path.join(store.dir, r.raw_path));
    } catch {
      continue;
    }
    if (!buf.length) continue;
    session.seenSha.add(r.sha256);
    const det = detect(buf, { filename: r.filename });
    const entry = { fullUrl: r.url, key: r.url_key, stem: stemOf(r.filename), det, frameUrl: r.frame, filename: r.filename };
    if (det.kind === 'image' || det.kind === 'texture') session.imageDirStems.add(dirOfKey(r.url_key) + '|' + entry.stem);
    if (det.kind === 'spine-atlas') session.atlases.push(entry);
    if (isSkeletonKind(det.kind)) session.skeletons.push(entry);
  }

  // 2. re-download candidates whose body was missing, empty or invalid
  const broken = new Map();
  for (const r of await readJsonl(store.networkFile)) {
    if (!r.candidate || r.probe) continue;
    let bad = !r.sha256;
    if (r.sha256) {
      try {
        const buf = await fsp.readFile(path.join(store.dir, store.bySha.get(r.sha256) || ''));
        bad = !!bodyProblem(buf, r.url, r.content_type);
      } catch {
        bad = true;
      }
    }
    if (bad && !r.url.includes('REDACTED')) broken.set(r.url, r);
    else if (!bad) broken.delete(r.url); // a later request of the same URL succeeded
  }
  let fixed = 0;
  if (broken.size) log.info(`Réparation : ${broken.size} fichier(s) vides ou invalides à re-télécharger…`);
  for (const [url, r] of broken) {
    const rec = { session: sessionId, url, method: 'GET', repair: true, ts_request: iso(Date.now()) };
    try {
      const body = await session.fetchUrl(url, r.initiator_frame);
      const problem = bodyProblem(body, url, r.content_type);
      if (problem) throw new Error(problem);
      const info = await session.ingest(body, { url, frameUrl: r.initiator_frame, contentType: r.content_type, status: 200, source: 'collector_repair', tsRequest: rec.ts_request });
      Object.assign(rec, { status: 200, sha256: info.sha, kind: info.kind, source: 'collector_repair' });
      fixed++;
      log.info(`  ✔ ${filenameFromUrl(url)}${info.kind === 'spine-json' ? '  (skeleton Spine)' : ''}`);
    } catch (e) {
      rec.error = e.message;
      log.warn(`  ✘ ${filenameFromUrl(url)} : ${e.message}`);
    }
    await store.appendNetwork(rec);
  }

  // 3. completion pass over everything (twice: a fetched atlas can reference new pages)
  await session.probeMissing();
  await session.probeMissing();
  return { counters: session.counters, fixed, broken: broken.size };
}
