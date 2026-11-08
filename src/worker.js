'use strict';

// Stand-alone worker process: `npm run worker`. Use with WORKER_IN_PROCESS=false on the web process.
require('./load-env');
const { loadConfig } = require('./config');
const { buildContext } = require('./context');
const { createWorker } = require('./modules/runs/run.worker');
const { pendingMigrations } = require('./db/migrate');

async function main() {
  const ctx = buildContext(loadConfig());
  if ((await pendingMigrations(ctx.pool)).length) throw new Error('database schema is out of date — run `npm run migrate`');
  const worker = createWorker(ctx);
  worker.start();
  ctx.logger.info({ workerId: worker.workerId }, 'worker started');
  const stop = async () => { await worker.stop(); await ctx.pool.end(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
