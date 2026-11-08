'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, checkPasswordPolicy } = require('../../src/modules/auth/passwords');
const { loadConfig } = require('../../src/config');
const { PERMISSIONS, can, permissionsFor } = require('../../src/lib/permissions');
const { orderBy } = require('../../src/lib/paging');
const { canonicalJson, sha256Hex } = require('../../src/lib/hash');
const { AppError } = require('../../src/lib/errors');
const { cleanFilename } = require('../../src/modules/sources/source.service');

test('passwords: salted scrypt hashes verify, differ per call, and reject wrong or malformed input', async () => {
  const a = await hashPassword('correct horse battery', 10);
  const b = await hashPassword('correct horse battery', 10);
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$10\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterz', a), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.ok(!a.includes('correct horse'));
});

test('password policy', () => {
  assert.ok(checkPasswordPolicy('short'));
  assert.equal(checkPasswordPolicy('a-sufficiently-long-passphrase'), null);
  assert.ok(checkPasswordPolicy('x'.repeat(129)));
});

test('config: valid defaults, readable aggregated errors, production hardening', () => {
  const ok = loadConfig({ DATABASE_URL: 'postgres://localhost/x' });
  assert.equal(ok.port, 3000);
  assert.equal(ok.cookieSecure, false);
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://localhost/x', NODE_ENV: 'production' }).cookieSecure, true);
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://x', PORT: 'abc', LOG_LEVEL: 'loud' }), (e) => /DATABASE_URL/.test(e.message) && /PORT/.test(e.message) && /LOG_LEVEL/.test(e.message));
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://localhost/x', NODE_ENV: 'production', SCRYPT_LOG2_N: '12' }), /at least 17/);
  assert.ok(Object.isFrozen(ok));
});

test('permissions: least privilege holds for every role', () => {
  assert.ok(can('analyst', 'sources:upload') && !can('supervisor', 'sources:upload') && !can('auditor', 'sources:upload'));
  assert.ok(can('supervisor', 'proposals:decide') && !can('analyst', 'proposals:decide') && !can('auditor', 'proposals:decide'));
  assert.ok(can('supervisor', 'settings:update') && !can('analyst', 'settings:update') && !can('auditor', 'settings:update'));
  assert.ok(!can('analyst', 'audit:read') && can('auditor', 'audit:read') && can('supervisor', 'audit:read'));
  assert.ok(!can('auditor', 'proposals:create') && !can('auditor', 'breaks:note') && !can('auditor', 'runs:create'));
  assert.ok(!can('nobody', 'sources:read') && !can('analyst', 'does:not-exist'));
  // The auditor is strictly read-only: no permission outside *:read / audit:read.
  assert.ok(permissionsFor('auditor').every((p) => p.endsWith(':read')));
  assert.ok(Object.keys(PERMISSIONS).length >= 13);
});

test('sorting only ever emits whitelisted SQL', () => {
  const allowed = { age: 'AGE_EXPR', impact: 'b.impact_paise' };
  assert.equal(orderBy('impact:asc', allowed, 'FALLBACK', 'b.id'), 'b.impact_paise ASC, b.id');
  assert.equal(orderBy('impact:desc', allowed, 'FALLBACK', 'b.id'), 'b.impact_paise DESC, b.id');
  assert.equal(orderBy('impact:sideways', allowed, 'FALLBACK', 'b.id'), 'b.impact_paise DESC, b.id');
  assert.equal(orderBy("1; DROP TABLE users;--", allowed, 'FALLBACK', 'b.id'), 'FALLBACK, b.id');
  assert.equal(orderBy('__proto__:asc', allowed, 'FALLBACK', 'b.id'), 'FALLBACK, b.id');
  assert.equal(orderBy(undefined, allowed, 'FALLBACK', 'b.id'), 'FALLBACK, b.id');
});

test('canonical JSON hashing is key-order independent (run fingerprints)', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: null } }), canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
  assert.notEqual(sha256Hex(canonicalJson({ a: 1 })), sha256Hex(canonicalJson({ a: 2 })));
});

test('uploaded file names are reduced to a safe display name', () => {
  assert.equal(cleanFilename(encodeURIComponent('C:\\Users\\x\\ledger nov.csv')), 'ledger nov.csv');
  assert.equal(cleanFilename('../../etc/passwd.csv'), 'passwd.csv');
  assert.equal(cleanFilename('a\u0000b.csv'), 'ab.csv');
  assert.throws(() => cleanFilename('notes.txt'), (e) => e instanceof AppError && e.code === 'UNSUPPORTED_FILE_TYPE');
  assert.throws(() => cleanFilename(''), AppError);
  const long = cleanFilename(`${'a'.repeat(400)}.csv`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.csv'));
});
