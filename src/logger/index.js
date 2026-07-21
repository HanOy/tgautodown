import { fileURLToPath } from 'node:url';
import { dirname, basename } from 'node:path';
import { performance } from 'node:perf_hooks';

const LEVELS = { trace: -1, debug: 0, info: 1, warn: 2, error: 3, fatal: 5 };
const LEVEL_NAMES = { '-1': 'TRC', '0': 'DBG', '1': 'INF', '2': 'WRN', '3': 'ERR', '5': 'FTL' };
const PID = String(process.pid);
let currentLevel = 0;

function nowStr() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function fmtVal(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

class Logger {
  constructor(levelName) {
    this.setLevel(levelName);
  }

  setLevel(name) {
    if (typeof name === 'string') {
      currentLevel = LEVELS[name.toLowerCase()] ?? 0;
    } else if (typeof name === 'number') {
      currentLevel = name;
    }
  }

  emit(level, args, err) {
    if (level < currentLevel) return;
    const caller = this.#caller();
    const lvl = LEVEL_NAMES[String(level)] ?? 'INF';
    const parts = [`T=${nowStr()} L=${lvl} F=${PID}/${caller}`];
    if (err) parts.push(`err=${fmtVal(err)}`);
    for (const a of args) parts.push(fmtVal(a));
    const stream = level >= 3 ? process.stderr : process.stdout;
    stream.write(parts.join(' ') + '\n');
  }

  #caller() {
    const stack = new Error().stack?.split('\n') ?? [];
    for (const line of stack.slice(1)) {
      const m = line.match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?/);
      if (!m) continue;
      const file = m[1];
      if (file.includes('node:') || file.includes('logger')) continue;
      return `${basename(file)}:${m[2]}`;
    }
    return '?:?';
  }

  trace(...a)  { this.emit(-1, a); }
  debug(...a)  { this.emit(0, a); }
  info(...a)   { this.emit(1, a); }
  warn(e, ...a) { this.emit(2, a, e); }
  error(e, ...a) { this.emit(3, a, e); }
  fatal(e, ...a) { this.emit(5, a, e); }

  rid(id) { return new RidLogger(this, id); }
}

class RidLogger {
  constructor(parent, id) { this.parent = parent; this.id = id; }
  trace(...a)  { this.parent.emit(-1, [`rid=${this.id}`, ...a]); }
  debug(...a)  { this.parent.emit(0,  [`rid=${this.id}`, ...a]); }
  info(...a)   { this.parent.emit(1,  [`rid=${this.id}`, ...a]); }
  warn(e, ...a)  { this.parent.emit(2,  [`rid=${this.id}`, ...a], e); }
  error(e, ...a) { this.parent.emit(3,  [`rid=${this.id}`, ...a], e); }
}

export const log = new Logger(process.env.TG_LOG_LEVEL ?? 'debug');
export { Logger };