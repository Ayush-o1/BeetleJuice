'use strict';

/**
 * Rebuilds a DISPOSABLE development database: drops the public schema, re-runs every migration,
 * seeds the demo users and (with --load-sample) ingests the demo files, runs a reconciliation and
 * leaves a few proposals in different states.
 *
 *   npm run demo:reset -- --yes [--load-sample] [--scenario <name> [--size small|normal|large|xl] [--seed N]]
 *
 * --load-sample alone loads the original November demo files. With --scenario it loads that generated scenario
 * instead (see docs/data-scenarios.md); the sample proposals are only created for the original demo files.
 *
 * This is destructive by design, so it has four independent guards. It refuses to run unless:
 *   1. NODE_ENV is not "production";
 *   2. ALLOW_DEMO_RESET=true is set explicitly;
 *   3. the database name ends in _dev, _demo or _test;
 *   4. --yes is passed on the command line.
 */
require('../src/load-env');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { buildContext } = require('../src/context');
const { migrate } = require('../src/db/migrate');
const users = require('../src/modules/users/user.repo');
const { hashPassword } = require('../src/modules/auth/passwords');
const sources = require('../src/modules/sources/source.service');
const runs = require('../src/modules/runs/run.service');
const resolutions = require('../src/modules/resolutions/resolution.service');
const breakRepo = require('../src/modules/breaks/break.repo');
const { createWorker } = require('../src/modules/runs/run.worker');
const { DEMO_PASSWORD, DEMO_USERS } = require('./lib/demo-users');

function refuse(reason) {
  console.error(`Refusing to reset: ${reason}`);
  process.exit(1);
}

(async () => {
  const config = loadConfig();
  const dbName = decodeURIComponent(new URL(config.databaseUrl).pathname.slice(1));
  if (config.isProduction || process.env.NODE_ENV === 'production') refuse('NODE_ENV is production.');
  if (process.env.ALLOW_DEMO_RESET !== 'true') refuse('set ALLOW_DEMO_RESET=true to confirm this is a throwaway environment.');
  if (!/_(dev|demo|test)$/.test(dbName)) refuse(`database "${dbName}" does not end in _dev, _demo or _test.`);
  if (!process.argv.includes('--yes')) refuse(`this will DROP all data in "${dbName}". Re-run with --yes to proceed.`);

  const ctx = buildContext(config);
  const { pool } = ctx;
  try {
    console.log(`Resetting database "${dbName}"…`);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool, { log: (m) => console.log(`  ${m}`) });
    fs.rmSync(config.uploadDir, { recursive: true, force: true });

    const hash = await hashPassword(DEMO_PASSWORD, config.scryptLog2N);
    for (const [username, role, displayName] of DEMO_USERS) await users.create(pool, { username, displayName, role, passwordHash: hash });
    console.log(`Seeded ${DEMO_USERS.length} demo users (password: ${DEMO_PASSWORD}).`);

    if (argValue('scenario')) await loadScenario(ctx, argValue('scenario'));
    else if (process.argv.includes('--load-sample')) await loadSample(ctx);
  } finally {
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });

const argValue = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function loadScenario(ctx, name) {
  const { generateScenario } = require('./lib/scenario-library');
  const size = argValue('size') || 'normal';
  const g = generateScenario(name, { size, seed: argValue('seed') ? Number(argValue('seed')) : undefined });
  const analyst = { user: await users.findByUsername(ctx.pool, 'analyst'), ip: null, requestId: 'demo-reset' };
  const l = await sources.ingest(ctx, analyst, { kind: 'ledger', filename: `${name}-${size}-ledger.csv`, buffer: Buffer.from(g.ledgerCsv) });
  const s = await sources.ingest(ctx, analyst, { kind: 'settlement', filename: `${name}-${size}-settlement.csv`, buffer: Buffer.from(g.settlementCsv) });
  const run = await runs.createRun(ctx, analyst, { ledgerFileId: l.file.id, settlementFileId: s.file.id, asOfDate: g.expected.asOfDate });
  await createWorker(ctx).processNext();
  console.log(`Loaded scenario "${name}" (${size}) and completed run #${run.id}: expect ${g.expected.transactions.matched} matched, ${g.expected.transactions.pending} pending, ${g.expected.totalBreaks} breaks.`);
}

async function loadSample(ctx) {
  const actorFor = async (name) => ({ user: await users.findByUsername(ctx.pool, name), ip: null, requestId: 'demo-reset' });
  const analyst = await actorFor('analyst');
  const analyst2 = await actorFor('analyst2');
  const supervisor = await actorFor('supervisor');
  const dir = path.join(__dirname, '..', 'demo-data');
  const l = await sources.ingest(ctx, analyst, { kind: 'ledger', filename: 'ledger-2026-11.csv', buffer: fs.readFileSync(path.join(dir, 'ledger-2026-11.csv')) });
  const s = await sources.ingest(ctx, analyst, { kind: 'settlement', filename: 'nimbuspay-settlement-2026-11.csv', buffer: fs.readFileSync(path.join(dir, 'nimbuspay-settlement-2026-11.csv')) });
  const run = await runs.createRun(ctx, analyst, { ledgerFileId: l.file.id, settlementFileId: s.file.id });
  await createWorker(ctx).processNext();
  console.log(`Loaded sample files and completed run #${run.id}.`);

  // A few workflow states so the review queue and break timelines are not empty.
  const find = async (type, n = 0) => (await breakRepo.list(ctx.pool, { type, status: 'open' }, { limit: 10, offset: 0, sort: 'age:desc' })).rows[n];
  const propose = async (actor, b, code, note) => resolutions.propose(ctx, actor, b.id, { resolutionCode: code, note, breakVersion: b.version });
  const dup = await find('DUPLICATE_SETTLEMENT', 0);
  const p1 = await propose(analyst, dup, 'RECOVER_DUPLICATE', 'Processor settled this reference twice. Requesting a reversal of the second line.');
  const fee = await find('FEE_VARIANCE', 0);
  await propose(analyst2, fee, 'DISPUTE_WITH_PROCESSOR', 'Fee charged is above the contracted 2%. Raising with the processor account manager.');
  const mism = await find('AMOUNT_MISMATCH', 0);
  const p3 = await propose(analyst, mism, 'CORRECT_LEDGER', 'Processor amount is correct per the customer receipt; ledger entry was keyed wrongly.');
  const mism2 = await find('AMOUNT_MISMATCH', 1);
  const p4 = await propose(analyst2, mism2, 'WRITE_OFF', 'Difference is one paisa from rounding on the processor side.');
  const bump = async (id) => (await breakRepo.getBreakRow(ctx.pool, id)).version;
  await resolutions.decide(ctx, supervisor, p1.id, { decision: 'approved', note: 'Reversal requested; confirmed with processor.', breakVersion: await bump(dup.id) });
  await resolutions.decide(ctx, supervisor, p4.id, { decision: 'rejected', note: 'Rounding differences are not written off here. Dispute it instead.', breakVersion: await bump(mism2.id) });
  void p3;
  console.log('Created sample proposals: 1 approved, 1 rejected, 2 awaiting review.');
}
