// Per-game persistent store: raw/ (content-addressed, original names) + network logs.
// Everything is appended as it arrives so an interrupted session can always be resumed.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { gameDir } from './lib/paths.js';
import { appendJsonl, readJsonl, sha256, safeSegment, sanitizeUrl, urlKey, writeFileAtomic, extOf } from './lib/util.js';

export class GameStore {
  constructor(slug) {
    this.slug = slug;
    this.dir = gameDir(slug);
    this.networkFile = path.join(this.dir, 'network', 'network.jsonl');
    this.resourcesFile = path.join(this.dir, 'network', 'resources.jsonl');
    this.bySha = new Map(); // sha -> raw_path (relative to game dir)
    this.takenPaths = new Map(); // raw_path -> sha
    this.inflight = new Map();
  }

  async init() {
    for (const d of ['raw', 'spine', 'images', 'other', 'network']) await fsp.mkdir(path.join(this.dir, d), { recursive: true });
    for (const r of await readJsonl(this.resourcesFile)) {
      if (!r.sha256 || !r.raw_path) continue;
      this.bySha.set(r.sha256, r.raw_path);
      this.takenPaths.set(r.raw_path, r.sha256);
    }
    return this;
  }

  get knownShas() {
    return this.bySha;
  }

  rawRelPath(url, filename) {
    if (url.startsWith('embedded://')) {
      const [, , parent, ...rest] = url.split('/');
      return ['raw', '_embedded', safeSegment(parent), ...rest.map((s) => safeSegment(s))].join('/');
    }
    let u;
    try {
      u = new URL(sanitizeUrl(url));
    } catch {
      return `raw/_unknown/${safeSegment(filename)}`;
    }
    const segs = u.pathname.split('/').filter(Boolean).map((s) => {
      try {
        return safeSegment(decodeURIComponent(s));
      } catch {
        return safeSegment(s);
      }
    });
    let file = u.pathname.endsWith('/') || !segs.length ? 'index' : segs.pop();
    const dirs = segs.slice(-8); // keep paths reasonably short
    return ['raw', safeSegment(u.host), ...dirs, file].join('/');
  }

  /** Reserve a raw path for `sha`. Never reuses a path that holds different content. */
  async reservePath(sha, rel) {
    const tryPath = async (p) => {
      const owner = this.takenPaths.get(p);
      if (owner === sha) return true;
      if (owner) return false;
      // a file left on disk by a crashed session but not in resources.jsonl
      try {
        const existing = await fsp.readFile(path.join(this.dir, p));
        if (sha256(existing) !== sha) return false;
      } catch {
        /* free */
      }
      if (this.takenPaths.has(p) && this.takenPaths.get(p) !== sha) return false; // raced
      this.takenPaths.set(p, sha);
      return true;
    };
    if (await tryPath(rel)) return rel;
    const ext = extOf(rel, true);
    const base = ext ? rel.slice(0, -ext.length) : rel;
    for (let n = 0; ; n++) {
      const p = `${base}__${sha.slice(0, 8)}${n ? '_' + n : ''}${ext}`;
      if (await tryPath(p)) return p;
    }
  }

  async writeRaw(buf, url, filename, sha = sha256(buf)) {
    if (this.bySha.has(sha)) return { sha, raw_path: this.bySha.get(sha), isNew: false };
    if (this.inflight.has(sha)) return { sha, raw_path: await this.inflight.get(sha), isNew: false };
    const p = (async () => {
      const rel = await this.reservePath(sha, this.rawRelPath(url, filename));
      const abs = path.join(this.dir, rel);
      let same = false;
      try {
        same = sha256(await fsp.readFile(abs)) === sha;
      } catch {
        /* not there yet */
      }
      if (!same) await writeFileAtomic(abs, buf);
      this.bySha.set(sha, rel);
      return rel;
    })();
    this.inflight.set(sha, p);
    try {
      return { sha, raw_path: await p, isNew: true };
    } finally {
      this.inflight.delete(sha);
    }
  }

  /** Stores the body (deduplicated by SHA-256) and records this occurrence. */
  async saveResource(buf, meta) {
    const { sha, raw_path, isNew } = await this.writeRaw(buf, meta.url, meta.filename);
    await appendJsonl(this.resourcesFile, {
      sha256: sha,
      size: buf.length,
      raw_path,
      url: sanitizeUrl(meta.url),
      url_key: urlKey(meta.url),
      filename: meta.filename,
      content_type: meta.contentType || null,
      status: meta.status ?? null,
      source: meta.source || 'network',
      session: meta.session,
      ts_request: meta.tsRequest || null,
      ts_response: meta.tsResponse || null,
      frame: meta.frameUrl ? sanitizeUrl(meta.frameUrl) : null,
    });
    return { sha, raw_path, isNew };
  }

  appendNetwork(rec) {
    return appendJsonl(this.networkFile, rec);
  }
}
