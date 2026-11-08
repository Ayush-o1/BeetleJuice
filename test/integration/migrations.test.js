'use strict';
/** Migrations on a brand-new empty database (not the shared test database): the install path a new developer takes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { TEST_DB_URL } = require('../helpers/app');

const NAME = 'beetlejuice_migrations_test';        // must end in _test: nothing else is ever dropped
const adminUrl = new URL('/postgres', TEST_DB_URL).toString();
const dbUrl = new URL(`/${NAME}`, TEST_DB_URL).toString();
let pool;

async function recreate() {
  const admin = new Client({ connectionString: adminUrl }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${NAME}`); await admin.end();
}
test.before(async () => { assert.ok(NAME.endsWith('_test')); await recreate(); pool = createPool(dbUrl, { max: 4 }); });
test.after(async () => {
  await pool.end();
  const admin = new Client({ connectionString: adminUrl }); await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`); await admin.end();
});

const files = fs.readdirSync(path.join(__dirname, '..', '..', 'migrations')).filter((f) => f.endsWith('.sql')).sort();

test('every migration applies, in order, to an empty database', async () => {
  const log = [];
  await migrate(pool, { log: (m) => log.push(m) });
  assert.deepEqual(log.filter((m) => m.startsWith('applying')).map((m) => m.replace('applying ', '')), files);
  const applied = (await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
  assert.deepEqual(applied, files);
});

test('migrating again is a no-op (idempotent) and records nothing new', async () => {
  const before = (await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n;
  const log = [];
  await migrate(pool, { log: (m) => log.push(m) });
  assert.deepEqual(log, []);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, before);
});

test('two migrators racing do not double-apply or corrupt anything (advisory lock)', async () => {
  const fresh = createPool(dbUrl, { max: 4 });
  try { await Promise.all([migrate(fresh), migrate(fresh), migrate(fresh)]); } finally { await fresh.end(); }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, files.length);
});

test('an applied migration that was edited afterwards is refused with a clear message', async () => {
  await pool.query("UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE name = $1", [files[0]]);
  await assert.rejects(() => migrate(pool), new RegExp(`${files[0]} was modified after being applied`));
  // restore for the remaining tests
  const crypto = require('node:crypto');
  const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', files[0]), 'utf8')).digest('hex');
  await pool.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [sum, files[0]]);
  await migrate(pool);
});

test('the integrity guarantees exist on a clean install (not only on a database that grew over time)', async () => {
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const idx = (await q("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).map((r) => r.indexname);
  for (const name of ['match_results_ledger_key', 'match_results_settlement_key', 'match_results_batch_key', 'ledger_entries_reference_idx', 'settlement_lines_reference_idx', 'match_results_reference_idx']) {
    assert.ok(idx.includes(name), `index ${name} exists`);
  }
  assert.ok(idx.includes('source_files_kind_sha_key'), 'duplicate files are prevented by a unique index on (kind, content_sha256)');
  const immut = (await q("SELECT tgname FROM pg_trigger WHERE tgrelid = 'source_files'::regclass AND NOT tgisinternal")).map((r) => r.tgname);
  assert.ok(immut.includes('source_files_immutable'), 'stored source files cannot be updated or deleted');
  const triggers = (await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).map((r) => r.tgname);
  for (const t of ['audit_events_no_rowchange', 'audit_events_no_truncate']) assert.ok(triggers.includes(t), `trigger ${t}`);
  assert.ok(triggers.some((t) => /run.*transition|transition/.test(t)), 'run state machine is enforced by a trigger');
  // the seeded settings row the application relies on
  const s = await q('SELECT version, fee_rate_percent::text AS rate, settlement_window_days AS win FROM settings_versions ORDER BY version');
  assert.deepEqual(s, [{ version: 1, rate: '2.0000', win: 2 }]);
});

test('on a clean install the audit log really is append-only, even for the database owner using plain SQL', async () => {
  await pool.query("INSERT INTO audit_events (action, entity_type) VALUES ('test.event', 'test')");
  await assert.rejects(() => pool.query("UPDATE audit_events SET action = 'tampered'"), /append-only|not allowed|immutable|forbid/i);
  await assert.rejects(() => pool.query('DELETE FROM audit_events'), /append-only|not allowed|immutable|forbid/i);
  await assert.rejects(() => pool.query('TRUNCATE audit_events'), /append-only|not allowed|immutable|forbid/i);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n, 1);
});

test('the 0006 reference indexes are used by the trace lookups (planner check on a populated table)', async () => {
  await pool.query("INSERT INTO users (username, display_name, role, password_hash) VALUES ('tester', 'Tester', 'analyst', 'x')");
  await pool.query("INSERT INTO source_files (kind, original_filename, content_sha256, size_bytes, total_rows, accepted_rows, rejected_rows, uploaded_by) SELECT 'ledger', 'f.csv', repeat('a', 64), 1, 1, 1, 0, id FROM users LIMIT 1");
  await pool.query(`INSERT INTO ledger_entries (source_file_id, row_number, ledger_id, reference, merchant, entry_type, amount_paise, currency, recorded_at)
                    SELECT 1, g, 'L-' || g, 'REF-' || g, 'M', 'PAYMENT', 100, 'INR', '2026-11-01T10:00:00+05:30' FROM generate_series(1, 20000) g`);
  await pool.query('ANALYZE ledger_entries');
  const plan = (await pool.query("EXPLAIN SELECT id FROM ledger_entries WHERE reference = 'REF-777'")).rows.map((r) => r['QUERY PLAN']).join('\n');
  assert.match(plan, /ledger_entries_reference_idx/, plan);
});
