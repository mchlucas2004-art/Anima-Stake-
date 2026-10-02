// Spine binary skeleton (.skel) recognition.
// 3.x header: string hash, string version.  4.x header: int64 hash, string version.
// Strings are varint(length + 1) followed by UTF-8 bytes.

const VERSION_RE = /^[234]\.\d{1,2}\.\d{1,3}(?:-[\w.]+)?$/;
const SKEL_EXT = new Set(['skel', 'skel.bytes', 'bin', 'binary', 'bytes', 'spine']);

function readVarint(buf, off) {
  let result = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: result >>> 0, next: off + i + 1 };
    shift += 7;
  }
  return null;
}

function readString(buf, off) {
  const v = readVarint(buf, off);
  if (!v || v.value === 0) return null;
  const len = v.value - 1;
  if (len > 256 || v.next + len > buf.length) return null;
  return { str: buf.toString('utf8', v.next, v.next + len), next: v.next + len };
}

function headerVersion(buf) {
  // 4.x: 8 byte hash then version
  const v4 = readString(buf, 8);
  if (v4 && VERSION_RE.test(v4.str)) return { version: v4.str, layout: '4.x', after: v4.next };
  // 3.x: hash string then version string
  const h = readString(buf, 0);
  if (h) {
    const v3 = readString(buf, h.next);
    if (v3 && VERSION_RE.test(v3.str)) return { version: v3.str, layout: '3.x', after: v3.next };
  }
  const m = buf.subarray(0, 96).toString('latin1').match(/[234]\.\d{1,2}\.\d{1,3}/);
  return m ? { version: m[0], layout: 'unknown', after: null } : null;
}

/** All printable ASCII runs (>= 2 chars); attachment / region names live in these. */
export function extractStrings(buf, max = 50000) {
  const out = new Set();
  let start = -1;
  const flush = (end) => {
    if (start >= 0 && end - start >= 2) {
      const s = buf.toString('latin1', start, end).toLowerCase();
      out.add(s);
      if (s.length > 2) out.add(s.slice(1)); // the varint length byte may itself be printable
    }
    start = -1;
  };
  for (let i = 0; i < buf.length && out.size < max; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(buf.length);
  return out;
}

export function detectSkel(buf, ext) {
  if (!buf || buf.length < 16) return null;
  const hv = headerVersion(buf);
  if (!hv && ext !== 'skel' && ext !== 'skel.bytes') return null;
  if (hv && hv.layout === 'unknown' && !SKEL_EXT.has(ext)) return null;
  let width = null;
  let height = null;
  if (hv?.after != null && hv.after + 16 <= buf.length) {
    // x, y, width, height as big-endian floats
    width = Math.round(buf.readFloatBE(hv.after + 8) * 100) / 100;
    height = Math.round(buf.readFloatBE(hv.after + 12) * 100) / 100;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0 || width > 1e5 || height > 1e5)
      width = height = null;
  }
  return {
    version: hv?.version || null,
    layout: hv?.layout || 'unknown',
    width,
    height,
    strings: extractStrings(buf),
    confidence: hv?.layout && hv.layout !== 'unknown' ? 'high' : hv ? 'medium' : 'low',
  };
}
