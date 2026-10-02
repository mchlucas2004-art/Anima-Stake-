// Spine / libGDX texture atlas parser. Handles both formats:
//  - Spine <= 3.8 : blank line before each page, indented region properties (xy, size, orig, offset, index)
//  - Spine >= 4.0 : compact "key:value" lines (bounds, offsets, rotate), regions not indented
import { IMAGE_EXT } from './image.js';
import { extOf } from '../lib/util.js';

const PAGE_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale']);
const REGION_KEYS = new Set(['bounds', 'xy', 'offsets', 'offset', 'orig', 'rotate', 'index', 'split', 'pad', 'size']);

export function parseAtlas(text) {
  if (!text || text.length > 20 * 1024 * 1024) return null;
  const lines = text.replace(/\r/g, '').split('\n');
  const pages = [];
  let page = null;
  let region = null;
  let expectPage = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      expectPage = true;
      region = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      if (expectPage || !page) {
        page = { name: line, props: {}, regions: [] };
        pages.push(page);
        region = null;
      } else {
        region = { name: line, props: {} };
        page.regions.push(region);
      }
      expectPage = false;
    } else {
      if (!page) return null; // key/value before any page name: not an atlas
      const k = line.slice(0, colon).trim();
      const v = line.slice(colon + 1).trim();
      (region ? region.props : page.props)[k] = v;
      expectPage = false;
    }
  }
  if (!pages.length) return null;
  const pageOk = pages.every((p) => Object.keys(p.props).some((k) => PAGE_KEYS.has(k)));
  const regionOk = pages.some((p) => p.regions.some((r) => Object.keys(r.props).some((k) => REGION_KEYS.has(k))));
  const imageNames = pages.filter((p) => IMAGE_EXT.has(extOf(p.name))).length;
  if (!pageOk || (!regionOk && imageNames === 0)) return null;

  const regionNames = new Set();
  const baseNames = new Set();
  let regionCount = 0;
  for (const p of pages) {
    for (const r of p.regions) {
      regionCount++;
      const n = r.name.toLowerCase();
      regionNames.add(n);
      baseNames.add(n);
      const idx = r.props.index;
      if (idx !== undefined && idx !== '-1') {
        // sequences: "name" + index, with the usual zero paddings
        for (let pad = 1; pad <= 4; pad++) regionNames.add(n + String(idx).padStart(pad, '0'));
      }
    }
  }
  return {
    format: pages.some((p) => p.regions.some((r) => 'bounds' in r.props)) ? 'spine-4' : 'spine-3/libgdx',
    pages: pages.map((p) => {
      const size = (p.props.size || '').split(',').map((x) => parseInt(x, 10));
      return {
        name: p.name,
        size: size.length === 2 && size.every(Number.isFinite) ? size : null,
        format: p.props.format || null,
        filter: p.props.filter || null,
        pma: p.props.pma === 'true' ? true : p.props.pma === 'false' ? false : null,
        scale: p.props.scale ? Number(p.props.scale) : null,
        regions: p.regions.length,
      };
    }),
    regionCount,
    regionNames, // Set, lower-case, incl. sequence variants
    baseNames, // Set, lower-case, as written in the atlas
  };
}
