import fs from 'node:fs';
import path from 'node:path';
import { ArgSet } from '../utils/args.js';
import { log } from '../logger/index.js';

const DEFAULTS = {
  appid:    0,
  apphash:  '',
  phone:    '',
  cfgdir:   './data',
  savedir:  './download',
  gopeed:   '',
  httpaddr: ':2020',
  logpath:  '',
  loglevel: 0,
  logsize:  300 << 20,
  logcnt:   1,
};

export class Config {
  constructor() {
    Object.assign(this, JSON.parse(JSON.stringify(DEFAULTS)));
    this.#cliDefaults();
  }

  // Pre-register so -h works even before parse()
  #cliDefaults() {
    const a = new ArgSet();
    a.str('cfg',     'config file path',  '');
    a.str('proxy',   'socks5://127.0.0.1:1080', '');
    a.str('f2a',     '2FA password', '');
    a.int('retrycnt','max retry count', 10);
    a.strings('names', 'channels (private prefix +)', '');
    a.bool('h', 'show help');
    a.bool('help', 'show help');
    a.usageIfHasKeys('h', 'help');
  }

  load() {
    const cli = new ArgSet();
    cli.str('cfg', '', '');
    cli.str('proxy', '', '');
    cli.str('f2a', '', '');
    cli.int('retrycnt', '', 10);
    cli.strings('names', '', '');
    cli.str('httpaddr', '', '');

    // Read CLI values into locals first — never mutate this.* before the file merge.
    const cliCfg    = cli.str('cfg', '', '');
    const cliProxy  = cli.str('proxy', '', '');
    const cliF2a    = cli.str('f2a', '', '');
    const cliRetry  = cli.int('retrycnt', '', 0);
    const cliNames  = cli.strings('names', '', []);
    const cliHttp   = cli.str('httpaddr', '', '');

    // Resolve config file path (CLI override of default location).
    const defaultCfgPath = path.join(this.cfgdir, 'config.json');
    this.cfgPath = cliCfg || defaultCfgPath;

    // Load config.json (if exists) — merge into this.* — EXCEPT cfgPath itself.
    if (fs.existsSync(this.cfgPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.cfgPath, 'utf8'));
        for (const k of Object.keys(raw)) {
          if (k === 'cfgPath') continue;          // never load the path-to-config from config
          this[k] = raw[k];                       // channels, socks5, f2aPwd, retryCnt, … all come from file
        }
      } catch (e) {
        log.error(e, 'config load fail');
        throw e;
      }
    }

    // Recompute derived paths AFTER config merge — cfgdir may have been overridden.
    this.sessionPath = path.resolve(this.cfgdir, 'session.json');
    this.cfgdir      = path.resolve(this.cfgdir);

    // CLI flags win over file config
    if (cliProxy)             this.socks5   = cliProxy;
    if (cliF2a)               this.f2aPwd   = cliF2a;
    if (cliRetry > 0)         this.retryCnt = cliRetry;
    if (cliNames.length)      this.channels = cliNames;
    if (cliHttp)              this.httpaddr = cliHttp;

    log.setLevel(this.loglevel);
    log.info('cfg loaded', JSON.stringify({ ...this, sessionPath: this.sessionPath }));
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.cfgPath), { recursive: true });
      fs.writeFileSync(this.cfgPath, JSON.stringify(this, null, 2));
      log.debug('config saved', this.cfgPath);
    } catch (e) {
      log.error(e, 'config save fail');
    }
  }

  isLoginReady() {
    return this.appid > 0 && this.apphash && this.phone;
  }
}

export const cfg = new Config();