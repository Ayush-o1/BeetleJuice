'use strict';

require('../src/load-env');
const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');

(async () => {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 2 });
  try {
    const ran = await migrate(pool, { log: (m) => console.log(m) });
    console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
