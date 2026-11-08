'use strict';

// Creates the database named in DATABASE_URL if it does not exist. Never drops anything.
require('../src/load-env');
const { Client } = require('pg');
const { loadConfig } = require('../src/config');

(async () => {
  const url = new URL(loadConfig().databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]{1,63}$/i.test(name)) throw new Error('Database name may only contain letters, digits and underscores');
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount) console.log(`Database "${name}" already exists.`);
    else { await client.query(`CREATE DATABASE "${name}"`); console.log(`Created database "${name}".`); }
  } finally {
    await client.end();
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
