import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from './paths.js';

let consoleSink = null; // set by the status board so log lines print above the live counters

export function setConsoleSink(fn) {
  consoleSink = fn;
}

function logFile() {
  return path.join(LOGS_DIR, `scrap-${new Date().toISOString().slice(0, 10)}.log`);
}

function write(level, msg, extra) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(logFile(), line + '\n');
  } catch {
    /* logging must never crash the collector */
  }
  if (level === 'debug' && !process.env.SCRAP_DEBUG) return;
  const prefix = level === 'error' ? 'ERROR ' : level === 'warn' ? 'WARN  ' : '';
  const out = prefix + msg;
  if (consoleSink) consoleSink(out);
  else (level === 'error' ? console.error : console.log)(out);
}

export const log = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
  debug: (m, x) => write('debug', m, x),
};
