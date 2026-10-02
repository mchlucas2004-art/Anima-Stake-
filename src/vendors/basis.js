// KTX2 (Basis Universal ETC1S / UASTC) -> PNG, with the official Basis transcoder (WASM).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PROJECT_DIR } from '../lib/paths.js';
import { encodePng } from '../lib/png.js';

const require = createRequire(import.meta.url);
const DIR = path.join(PROJECT_DIR, 'vendor', 'basis');
const RGBA32 = 13; // basis transcoder_texture_format cTFRGBA32
let modulePromise = null;

function loadBasis() {
  modulePromise ||= (async () => {
    const BASIS = require(path.join(DIR, 'basis_transcoder.cjs'));
    const m = await BASIS({ wasmBinary: fs.readFileSync(path.join(DIR, 'basis_transcoder.wasm')) });
    m.initializeBasis();
    return m;
  })();
  return modulePromise;
}

export const isKtx2 = (buf) => buf && buf.length > 12 && buf[0] === 0xab && buf[1] === 0x4b && buf[5] === 0x32 && buf[6] === 0x30;

/** Returns { png, width, height, hasAlpha } or throws. */
export async function ktx2ToPng(buf) {
  const basis = await loadBasis();
  const file = new basis.KTX2File(new Uint8Array(buf));
  try {
    if (!file.isValid()) throw new Error('invalid KTX2 file');
    const width = file.getWidth();
    const height = file.getHeight();
    if (!file.startTranscoding()) throw new Error('KTX2 startTranscoding failed (not a Basis-supercompressed texture?)');
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
    const dst = new Uint8Array(size);
    if (!file.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error('KTX2 transcode failed');
    return { png: encodePng(width, height, dst), width, height, hasAlpha: !!file.getHasAlpha() };
  } finally {
    file.close();
    file.delete();
  }
}
