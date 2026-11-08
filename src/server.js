'use strict';

require('./load-env');
const { loadConfig } = require('./config');
const { buildContext } = require('./context');
const { createApp } = require('./app');
const { createWorker } = require('./modules/runs/run.worker');
const { pendingMigrations } = require('./db/migrate');
const sessions = require('./modules/auth/session.repo');

async function main() {
  const config = loadConfig();
  const ctx = buildContext(config);
  const { logger, pool } = ctx;

  const pending = await pendingMigrations(pool);
  if (pending.length) {
    logger.fatal({ pending }, 'database schema is out of date — run `npm run migrate`');
    process.exit(1);
  }

  const app = createApp(ctx);
  const server = app.listen(config.port, () => logger.info({ port: config.port, env: config.env }, 'BeetleJuice listening'));

  const worker = config.workerInProcess ? createWorker(ctx) : null;
  worker?.start();
  const purge = setInterval(() => sessions.purgeExpired(pool).catch((e) => logger.warn({ err: e.message }, 'session purge failed')), 3600_000);
  purge.unref();

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    server.close();
    clearInterval(purge);
    await worker?.stop();
    await pool.end();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
