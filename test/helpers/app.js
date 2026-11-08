'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../../src/config');
const { buildContext } = require('../../src/context');
const { createApp } = require('../../src/app');
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');
const { createWorker } = require('../../src/modules/runs/run.worker');
const { hashPassword } = require('../../src/modules/auth/passwords');
const users = require('../../src/modules/users/user.repo');

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/beetlejuice_test';
const PASSWORD = 'Test-password-1234';
const TEST_USERS = [
  ['analyst', 'analyst', 'Priya Nair'], ['analyst2', 'analyst', 'Rohan Gupta'],
  ['supervisor', 'supervisor', 'Meera Iyer'], ['supervisor2', 'supervisor', 'Arjun Rao'],
  ['auditor', 'auditor', 'Kavya Menon'],
];

/** Refuses to touch any database whose name does not end in _test. */
function assertDisposable(url) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${name}"`);
}

async function resetDatabase(pool, cfg) {
  assertDisposable(cfg.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The audit table rejects TRUNCATE by design; only this test helper, on a *_test database, lifts that.
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_truncate');
    await client.query(`TRUNCATE audit_events, resolution_decisions, resolution_proposals, break_notes, breaks, match_results,
      reconciliation_runs, settlement_batches, settlement_lines, ledger_entries, source_row_errors, source_files, sessions, users,
      settings_versions RESTART IDENTITY CASCADE`);
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_truncate');
    await client.query(`INSERT INTO settings_versions (version, amount_tolerance_paise, fee_rate_percent, fee_tolerance_paise, settlement_window_days, note)
      VALUES (1, 0, 2.0000, 1, 2, 'Initial defaults')`);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const hash = await hashPassword(PASSWORD, cfg.scryptLog2N);
  for (const [username, role, displayName] of TEST_USERS) await users.create(pool, { username, displayName, role, passwordHash: hash });
}

/** Minimal cookie-aware JSON client; mirrors what the browser frontend does. */
class Client {
  constructor(base) { this.base = base; this.cookie = null; this.csrf = null; this.user = null; }
  async request(method, url, { body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf && method !== 'GET' && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    let payload = raw;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [kv] = c.split(';'); if (kv.startsWith('bj_session=')) this.cookie = kv.endsWith('=') ? null : kv; }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  get(url, o) { return this.request('GET', url, o); }
  post(url, body, o) { return this.request('POST', url, { ...o, body }); }
  put(url, body, o) { return this.request('PUT', url, { ...o, body }); }
  async login(username, password = PASSWORD) {
    const r = await this.request('POST', '/api/auth/login', { body: { username, password } });
    if (r.status === 200) { this.csrf = r.body.data.csrfToken; this.user = r.body.data.user; }
    return r;
  }
  upload(kind, filename, csv, { contentType = 'text/csv' } = {}) {
    return this.request('POST', `/api/sources/${kind}`, { raw: Buffer.from(csv), headers: { 'content-type': contentType, 'x-filename': encodeURIComponent(filename) } });
  }
}

async function startTestApp(env = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, LOG_LEVEL: 'silent', SCRYPT_LOG2_N: '10', WORKER_IN_PROCESS: 'false',
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bj-uploads-')), LOGIN_RATE_MAX: '100000', ...env,
  });
  assertDisposable(config.databaseUrl);
  const pool = createPool(config.databaseUrl, { max: 12 });
  await migrate(pool);
  await resetDatabase(pool, config);
  const ctx = buildContext(config, { pool });
  const server = await new Promise((resolve) => { const s = createApp(ctx).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ctx, pool, base, config, PASSWORD,
    client: () => new Client(base),
    async as(username) { const c = new Client(base); const r = await c.login(username); if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`); return c; },
    worker: (opts) => createWorker(ctx, opts),
    reset: () => resetDatabase(pool, config),
    async close() { await new Promise((r) => server.close(r)); await pool.end(); fs.rmSync(config.uploadDir, { recursive: true, force: true }); },
  };
}

module.exports = { startTestApp, Client, PASSWORD, TEST_DB_URL };
