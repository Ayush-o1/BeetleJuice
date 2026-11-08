'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { TEST_DB_URL } = require('../helpers/app');

const script = path.join(__dirname, '..', '..', 'scripts', 'demo-reset.js');
const run = (env, args = ['--yes']) => spawnSync(process.execPath, [script, ...args], {
  env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
});

test('demo reset refuses to run unless every guard is satisfied', () => {
  const base = { DATABASE_URL: TEST_DB_URL, ALLOW_DEMO_RESET: 'true', NODE_ENV: 'development' };
  const cases = [
    ['production environment', { ...base, NODE_ENV: 'production' }, ['--yes'], /NODE_ENV is production/],
    ['no explicit opt-in', { ...base, ALLOW_DEMO_RESET: 'false' }, ['--yes'], /ALLOW_DEMO_RESET=true/],
    ['database name not disposable', { ...base, DATABASE_URL: 'postgres://localhost:5432/customer_data' }, ['--yes'], /does not end in _dev, _demo or _test/],
    ['missing --yes', base, [], /Re-run with --yes/],
  ];
  for (const [name, env, args, message] of cases) {
    const r = run(env, args);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, message, name);
  }
});
