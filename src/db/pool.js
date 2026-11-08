'use strict';

const { Pool, types } = require('pg');

// bigint (int8) arrives as a string by default. Money is bounded well below 2^53
// (see CHECK constraints), so converting to Number is exact; anything larger is a bug
// we want to hear about loudly rather than silently round.
types.setTypeParser(types.builtins.INT8, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`bigint value ${v} exceeds the safe integer range`);
  return n;
});
// Keep DATE values as 'YYYY-MM-DD' strings. The default parser builds a JS Date in the
// server's local timezone, which is exactly how off-by-one-day bugs happen.
types.setTypeParser(types.builtins.DATE, (v) => v);
// numeric stays a string (fee rates are parsed into exact rationals, never floats).

function createPool(databaseUrl, { max = 10 } = {}) {
  return new Pool({ connectionString: databaseUrl, max, idleTimeoutMillis: 30000 });
}

/** Runs fn inside a transaction; commits on success, rolls back on any throw. */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
