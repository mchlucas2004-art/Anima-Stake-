// Image / GPU texture sniffing from magic bytes (extension and content-type are not trusted).

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { width: null, height: null };
}

function webpSize(buf) {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30) return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  return { width: null, height: null };
}

const KTX2 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const KTX1 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.length >= 24)
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { format: 'jpeg', ...jpegSize(buf) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { format: 'webp', ...webpSize(buf) };
  const g = buf.toString('ascii', 0, 6);
  if (g === 'GIF87a' || g === 'GIF89a') return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /avi[fs]/.test(buf.toString('ascii', 8, 12)))
    return { format: 'avif', width: null, height: null };
  if (buf.length >= 28 && buf.subarray(0, 12).equals(KTX2))
    return { format: 'ktx2', compressed: true, width: buf.readUInt32LE(20), height: buf.readUInt32LE(24) };
  if (buf.length >= 44 && buf.subarray(0, 12).equals(KTX1)) {
    const le = buf.readUInt32LE(12) === 0x04030201;
    const r = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    return { format: 'ktx', compressed: true, width: r(36), height: r(40) };
  }
  if (buf.toString('ascii', 0, 4) === 'DDS ' && buf.length >= 20)
    return { format: 'dds', compressed: true, width: buf.readUInt32LE(16), height: buf.readUInt32LE(12) };
  if (buf.readUInt32LE(0) === 0x03525650 && buf.length >= 32)
    return { format: 'pvr', compressed: true, width: buf.readUInt32LE(28), height: buf.readUInt32LE(24) };
  if (buf[0] === 0x73 && buf[1] === 0x42 && buf.length > 77) return { format: 'basis', compressed: true, width: null, height: null };
  return null;
}

export const IMAGE_EXT = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif', 'avif', 'ktx', 'ktx2', 'basis', 'dds', 'pvr']);
