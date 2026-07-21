// Custom CLI parser — mirrors tgautodown's internal/utils/args.go.
// Supports: `-key value` and `-key=value`. `-h` / `-help` triggers usage dump.

const HELP_KEYS = new Set(['h', 'help']);

export class ArgSet {
  constructor() {
    this.defs = new Map(); // name -> { desc, def }
    this.argv = process.argv.slice(2);
  }

  str(name, desc, def = '') {
    this.defs.set(name, { desc, def, type: 'str' });
    const v = this.#find(name);
    return v ?? def;
  }

  int(name, desc, def = 0) {
    this.defs.set(name, { desc, def, type: 'int' });
    const v = this.#find(name);
    if (v == null) return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  }

  strings(name, desc, def = '') {
    this.defs.set(name, { desc, def, type: 'strings' });
    const v = this.#find(name);
    if (!v) return [];
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  bool(name, desc) {
    this.defs.set(name, { desc, def: false, type: 'bool' });
    return this.#find(name) != null;
  }

  usageIfHasKeys(...keys) {
    for (const k of keys) if (this.#find(k) != null) this.#dump();
  }

  #find(name) {
    const argv = this.argv;
    for (let i = 0; i < argv.length; i++) {
      const tok = argv[i];
      if (!tok.startsWith('-')) continue;
      const body = tok.slice(1);
      if (body.includes('=')) {
        const eq = body.indexOf('=');
        const key = body.slice(0, eq);
        const val = body.slice(eq + 1);
        if (key === name) return val;
      } else if (body === name) {
        const next = argv[i + 1];
        if (next != null && !next.startsWith('-')) return next;
        return ''; // flag-style present
      }
    }
    return undefined;
  }

  #dump() {
    const lines = [`usage: node src/main.js options`];
    for (const [k, v] of this.defs) {
      const suf = v.type === 'bool' ? '' : ` ${v.type === 'strings' ? 'a,b,c' : 'val'}`;
      lines.push(`  -${k}${suf}    ## ${v.desc ?? ''} (default: ${JSON.stringify(v.def)})`);
    }
    console.error(lines.join('\n'));
    process.exit(2);
  }
}