'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../helpers/app');
const { PERMISSIONS } = require('../../src/lib/permissions');

let app;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => { await app.reset(); });

test('health endpoint is public and reports the database', async () => {
  const r = await app.client().get('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ok' });
});

test('login issues an HttpOnly, SameSite=Strict cookie and a CSRF token; /me works', async () => {
  const c = app.client();
  const r = await c.login('analyst');
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('bj_session='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal(r.body.data.user.role, 'analyst');
  assert.ok(r.body.data.csrfToken.length >= 40);
  assert.ok(r.body.data.permissions.includes('sources:upload'));
  assert.ok(!JSON.stringify(r.body).includes('password'));
  const me = await c.get('/api/auth/me');
  assert.equal(me.body.data.user.username, 'analyst');
});

test('failed logins are generic, audited and never reveal whether the user exists', async () => {
  const a = await app.client().login('analyst', 'wrong-password-123');
  const b = await app.client().login('nobody', 'wrong-password-123');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
  const { rows } = await app.pool.query("SELECT action, context FROM audit_events WHERE action = 'auth.login_failed' ORDER BY id");
  assert.equal(rows.length, 2);
  assert.ok(!JSON.stringify(rows).includes('wrong-password'));
});

test('five consecutive failures lock the account even for the right password', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await app.client().login('analyst', 'bad-password-xx')).status, 401);
  assert.equal((await app.client().login('analyst')).status, 401);
  const { rows } = await app.pool.query("SELECT 1 FROM audit_events WHERE action = 'auth.account_locked'");
  assert.equal(rows.length, 1);
  await app.pool.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE username = 'analyst'");
  assert.equal((await app.client().login('analyst')).status, 200);
});

test('unauthenticated API access is rejected with 401', async () => {
  for (const url of ['/api/sources', '/api/runs', '/api/breaks', '/api/audit', '/api/settings', '/api/overview', '/api/proposals']) {
    const r = await app.client().get(url);
    assert.equal(r.status, 401, url);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  }
});

test('logout destroys the server-side session', async () => {
  const c = await app.as('analyst');
  const cookie = c.cookie;
  assert.equal((await c.post('/api/auth/logout')).status, 204);
  const replay = app.client();
  replay.cookie = cookie;
  assert.equal((await replay.get('/api/auth/me')).status, 401);
});

test('sessions expire after the idle timeout and after the absolute lifetime', async () => {
  const c = await app.as('analyst');
  await app.pool.query("UPDATE sessions SET last_seen_at = now() - interval '31 minutes'");
  assert.equal((await c.get('/api/auth/me')).status, 401);
  const d = await app.as('analyst');
  await app.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE username='analyst') AND id <> ''");
  assert.equal((await d.get('/api/auth/me')).status, 401);
});

test('each login mints a new session token (no session fixation)', async () => {
  const c = app.client();
  await c.login('analyst');
  const first = c.cookie;
  await c.login('analyst');
  assert.notEqual(c.cookie, first);
});

test('state-changing requests need the CSRF token and a same-origin Origin', async () => {
  const c = await app.as('analyst');
  const noToken = await c.request('POST', '/api/auth/logout', { headers: { 'x-csrf-token': 'wrong' } });
  assert.equal(noToken.status, 403);
  const crossOrigin = await c.request('POST', '/api/auth/logout', { headers: { origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await c.request('POST', '/api/auth/logout', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  assert.equal((await app.client().request('POST', '/api/auth/login', { body: { username: 'analyst', password: app.PASSWORD }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await c.post('/api/auth/logout')).status, 204);
});

test('security headers are present and errors never leak internals', async () => {
  const r = await app.client().get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
  assert.ok(r.body.error.requestId);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-powered-by'), null);
  const bad = await app.client().request('POST', '/api/auth/login', { raw: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
  assert.ok(!bad.text.includes('at '), 'no stack trace');
});

test('role matrix is enforced on the server for every permission', async () => {
  // endpoint per permission; a representative call must be 403 for roles outside the permission
  const probes = {
    'sources:upload': (c) => c.upload('ledger', 'x.csv', 'a,b\n1,2\n'),
    'runs:create': (c) => c.post('/api/runs', { ledgerFileId: 1, settlementFileId: 2 }),
    'settings:update': (c) => c.put('/api/settings', { amountTolerancePaise: 0, feeRatePercent: '2', feeTolerancePaise: 1, settlementWindowDays: 2, expectedVersion: 1 }),
    'proposals:decide': (c) => c.post('/api/proposals/1/decision', { decision: 'approved', breakVersion: 1 }),
    'proposals:create': (c) => c.post('/api/breaks/1/proposals', { resolutionCode: 'NO_ACTION', note: 'long enough note', breakVersion: 1 }),
    'breaks:note': (c) => c.post('/api/breaks/1/notes', { body: 'hello' }),
    'audit:read': (c) => c.get('/api/audit'),
  };
  for (const [permission, probe] of Object.entries(probes)) {
    for (const role of ['analyst', 'supervisor', 'auditor']) {
      const user = { analyst: 'analyst', supervisor: 'supervisor', auditor: 'auditor' }[role];
      const r = await probe(await app.as(user));
      const allowed = PERMISSIONS[permission].includes(role);
      if (allowed) assert.notEqual(r.status, 403, `${role} should pass the ${permission} gate (got ${r.status})`);
      else assert.equal(r.status, 403, `${role} must be forbidden for ${permission}`);
    }
  }
});
