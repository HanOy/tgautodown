import { cfg } from './config/cfg.js';
import { log } from './logger/index.js';
import { state, startHttp } from './state.js';

async function main() {
  cfg.load();

  await startHttp(state);
  log.info('web ui ready', { url: `http://localhost${cfg.httpaddr}` });

  if (cfg.isLoginReady()) {
    log.info('config has login info — auto-starting');
    state.kickLogin().catch((e) => log.error(e, 'auto-login fail'));
  } else {
    log.info('no login info — open web ui to login');
    state.status = 'need-login';
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function shutdown(sig) {
  log.info('shutting down', sig);
  process.exit(0);
}

main().catch((e) => {
  log.fatal(e, 'fatal');
  process.exit(1);
});