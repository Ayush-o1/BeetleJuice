'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
// Arbitrary constant: serialises concurrent migrators (e.g. two containers starting at once).
const ADVISORY_LOCK_KEY = 727_001;

/**
 * Applies pending SQL files in filename order, each in its own transaction.
 * Applied files are recorded with a checksum; editing an applied migration is an error
 * (write a new migration instead). Never drops or resets anything.
 */
async function migrate(pool, { log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows
      .map((r) => [r.name, r.checksum]));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const ran = [];
    for (const file of files) {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead.`);
        }
        continue;
      }
      log(`applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      ran.push(file);
    }
    return ran;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch { /* ignore */ }
    client.release();
  }
}

module.exports = { migrate };
