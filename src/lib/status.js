import { setConsoleSink } from './log.js';

/** Live block of status lines redrawn in place; log lines are printed above it. */
export class StatusBoard {
  constructor(render, { intervalMs = 1000 } = {}) {
    this.render = render;
    this.intervalMs = intervalMs;
    this.tty = process.stdout.isTTY;
    this.drawn = 0;
    this.timer = null;
    this.lastPlain = 0;
  }

  start() {
    setConsoleSink((msg) => this.print(msg));
    this.draw();
    this.timer = setInterval(() => this.draw(), this.intervalMs);
  }

  clear() {
    if (this.tty && this.drawn) process.stdout.write(`\x1b[${this.drawn}A\x1b[0J`);
    this.drawn = 0;
  }

  draw() {
    const lines = this.render();
    if (!this.tty) {
      // Non-interactive output (piped/CI): one summary line every 15 s.
      if (Date.now() - this.lastPlain > 15000) {
        this.lastPlain = Date.now();
        console.log(lines.filter(Boolean).join(' | '));
      }
      return;
    }
    this.clear();
    const cols = process.stdout.columns || 100;
    const out = lines.map((l) => (l.length > cols - 1 ? l.slice(0, cols - 2) + '…' : l));
    process.stdout.write(out.join('\n') + '\n');
    this.drawn = out.length;
  }

  print(msg) {
    this.clear();
    console.log(msg);
    this.draw();
  }

  stop() {
    clearInterval(this.timer);
    if (this.tty) this.draw();
    this.drawn = 0;
    setConsoleSink(null);
  }
}
