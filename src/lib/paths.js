import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_DIR = path.resolve(here, '..', '..');
// SCRAP_ROOT lets tests (or a second library) write outside the main Scrap folder.
export const ROOT = process.env.SCRAP_ROOT ? path.resolve(process.env.SCRAP_ROOT) : PROJECT_DIR;
export const CONFIG_DIR = path.join(ROOT, 'config');
export const GAMES_DIR = path.join(ROOT, 'games');
export const INDEX_DIR = path.join(ROOT, 'index');
export const LOGS_DIR = path.join(ROOT, 'logs');
export const TEMP_DIR = path.join(ROOT, 'temp');

export const gameDir = (slug) => path.join(GAMES_DIR, slug);

/** Path relative to the library root, always with forward slashes. */
export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
