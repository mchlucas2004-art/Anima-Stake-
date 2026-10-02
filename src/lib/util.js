import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const iso = (ms) => (ms == null || Number.isNaN(ms) ? null : new Date(ms).toISOString());

export function slugify(s) {
  return (
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'game'
  );
}

/** Filesystem-safe single path segment. */
export function safeSegment(s, max = 80) {
  let out = String(s || '')
    .replace(/[^\w.@+-]+/g, '_')
    .replace(/^\.+/, '_');
  if (out.length > max) {
    const ext = path.extname(out).slice(0, 12);
    out = out.slice(0, max - ext.length - 9) + '_' + sha256(out).slice(0, 8) + ext;
  }
  return out || '_';
}

export class NonRetryableError extends Error {}

export async function retry(fn, { attempts = 3, backoffMs = 1000, onError } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      onError?.(e, i);
      if (e instanceof NonRetryableError || i === attempts) break;
      await sleep(backoffMs * 2 ** (i - 1));
    }
  }
  throw last;
}

export async function withTimeout(promise, ms, label = 'operation') {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file in place. */
export async function writeFileAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

export const writeJson = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function appendJsonl(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, JSON.stringify(obj) + '\n');
}

/** Reads a JSONL file, skipping a truncated/corrupt line (e.g. after a crash). */
export async function readJsonl(file) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* partial line */
    }
  }
  return out;
}

export async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function fileSha(p) {
  return sha256(await fsp.readFile(p));
}

/** Hard-link (no extra disk space) and fall back to a copy across devices. */
export async function linkOrCopy(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.link(src, dest);
  } catch (e) {
    if (e.code === 'EEXIST') throw e;
    await fsp.copyFile(src, dest);
  }
}

/**
 * Picks a destination name in `dir` for content `sha`. Never overwrites a different file:
 * same name + same content -> reuse, same name + different content -> name__<sha8>.ext.
 * `taken` (Map name->sha) tracks names already assigned in this directory during a build.
 */
export function uniqueName(name, sha, taken) {
  const prev = taken.get(name);
  if (prev === undefined) {
    taken.set(name, sha);
    return { name, reused: false };
  }
  if (prev === sha) return { name, reused: true };
  const ext = extOf(name, true);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let n = 0; ; n++) {
    const cand = `${base}__${sha.slice(0, 8)}${n ? '_' + n : ''}${ext}`;
    const p = taken.get(cand);
    if (p === undefined) {
      taken.set(cand, sha);
      return { name: cand, reused: false };
    }
    if (p === sha) return { name: cand, reused: true };
  }
}

const MULTI_EXT = ['.atlas.txt', '.skel.bytes', '.json.txt', '.atlas.bytes'];

/** Lower-case extension. `withDot` keeps the dot. Understands .atlas.txt and friends. */
export function extOf(name, withDot = false) {
  const lower = String(name || '').toLowerCase();
  for (const m of MULTI_EXT) if (lower.endsWith(m)) return withDot ? lower.slice(-m.length) : m.slice(1);
  const e = path.extname(lower);
  return withDot ? e : e.slice(1);
}

const HASH_SUFFIX = /[-_.~]([0-9a-f]{6,40})$/i;
const SCALE_SUFFIX = /[@_-](\d+(\.\d+)?x|x\d+(\.\d+)?|hd|sd|ld|low|high|mobile|desktop)$/i;

/** Base name used to match related files: no extension, no content hash, no scale suffix. */
export function stemOf(name) {
  let s = String(name || '').toLowerCase();
  const e = extOf(s, true);
  if (e) s = s.slice(0, -e.length);
  for (let i = 0; i < 2; i++) {
    const m = s.match(HASH_SUFFIX);
    if (m && /\d/.test(m[1]) && /[a-f]/i.test(m[1])) s = s.slice(0, -m[0].length);
    s = s.replace(SCALE_SUFFIX, '');
  }
  return s;
}

export function filenameFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split('/').pop() || 'index';
    return decodeURIComponent(last) || 'index';
  } catch {
    return String(u).split('?')[0].split('/').pop() || 'index';
  }
}

// ---------- URL sanitizing (no tokens / credentials ever reach exported files) ----------

const SENSITIVE_KEY =
  /(token|auth|sig|signature|secret|session|sess|sid|jwt|apikey|api_key|key-pair|keypair|pass|pwd|credential|ticket|policy|nonce|^code$|mgckey|cookie|bearer|access|refresh|user|player|account|login|email)/i;

function looksSecret(v) {
  if (!v) return false;
  if (/^eyJ[\w-]{8,}\.[\w-]+/.test(v)) return true; // JWT
  return v.length >= 24 && /^[A-Za-z0-9._~+/=%-]+$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);
}

function secretSegment(seg) {
  if (/^eyJ[\w-]{8,}\.[\w-]+/.test(seg)) return true;
  return seg.length >= 48 && /^[A-Za-z0-9_-]+$/.test(seg) && !/^[0-9a-f]+$/i.test(seg) && /\d/.test(seg);
}

export function sanitizeUrl(raw) {
  if (!raw) return raw;
  if (raw.startsWith('data:')) return raw.slice(0, 32) + '…';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return String(raw).split(/[?#]/)[0];
  }
  u.username = '';
  u.password = '';
  u.hash = '';
  if (/^https?:$/.test(u.protocol)) {
    u.pathname = u.pathname
      .split('/')
      .map((s) => (secretSegment(s) ? 'REDACTED' : s))
      .join('/');
  }
  for (const [k, v] of [...u.searchParams]) {
    if (SENSITIVE_KEY.test(k) || looksSecret(v)) u.searchParams.set(k, 'REDACTED');
  }
  return u.toString();
}

/** Stable identity of a resource location: sanitized origin + path, without query. */
export function urlKey(raw) {
  const s = sanitizeUrl(raw);
  if (!s) return null;
  return s.split(/[?#]/)[0];
}

export const dirOfKey = (key) => (key ? key.slice(0, key.lastIndexOf('/') + 1) : '');

export function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

export function resolveRelative(ref, base) {
  try {
    return new URL(ref, base).toString().split(/[?#]/)[0];
  } catch {
    return null;
  }
}

export const uniq = (arr) => [...new Set(arr)];

export function countLines(file) {
  try {
    const buf = fs.readFileSync(file);
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    return n;
  } catch {
    return 0;
  }
}
