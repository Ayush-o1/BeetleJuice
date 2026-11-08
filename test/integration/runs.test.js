'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../helpers/app');
const { ledgerCsv, settlementCsv, runScenario, EXPECTED } = require('../helpers/scenario');

let app;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => { await app.reset(); });

test('a queued run completes with the documented outcomes, breaks and audit trail', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst, { process: false });
  assert.equal((await analyst.get(`/api/runs/${runId}`)).body.data.status, 'queued');
  assert.equal(await app.worker().processNext(), runId);

  const run = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(run.status, 'completed');
  assert.equal(run.asOfDate, EXPECTED.asOfDate);   // default = latest date in either source
  assert.equal(run.summary.matched, EXPECTED.transactionOutcomes.matched);
  assert.equal(run.summary.pending, EXPECTED.transactionOutcomes.pending);
  assert.equal(run.summary.breaks, EXPECTED.transactionOutcomes.breaks);
  assert.equal(run.summary.totalBreaks, EXPECTED.totalBreaks);
  assert.deepEqual(run.summary.breaksByType, EXPECTED.breaksByType);
  assert.equal(run.config.settingsVersion, 1);
  assert.equal(run.config.inputs.ledger.sha256.length, 64);

  const byRef = async (ref) => (await analyst.get(`/api/runs/${runId}/results?q=${ref}`)).body.data;
  assert.equal((await byRef('PAY-1002'))[0].amountDiffPaise, 5000);
  assert.equal((await byRef('PAY-1004'))[0].outcome, 'PENDING');
  assert.equal((await byRef('PAY-1006'))[0].breakType, 'FEE_VARIANCE');
  const batch = (await analyst.get(`/api/runs/${runId}/results?scope=BATCH`)).body.data;
  assert.deepEqual(batch.map((b) => [b.batchRef, b.outcome]), [['B-1001', 'MATCHED'], ['B-1002', 'BREAK']]);

  const breaks = (await analyst.get('/api/breaks')).body;
  assert.equal(breaks.page.total, 6);
  const events = (await app.pool.query('SELECT action, count(*)::int n FROM audit_events GROUP BY action')).rows;
  const count = (a) => events.find((e) => e.action === a)?.n;
  assert.equal(count('run.created'), 1);
  assert.equal(count('run.completed'), 1);
  assert.equal(count('break.created'), 6);
});

test('every ledger and settlement record has exactly one result (database-enforced)', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst);
  const q = async (sql) => (await app.pool.query(sql, [runId])).rows[0].n;
  assert.equal(await q('SELECT count(DISTINCT ledger_entry_id)::int n FROM match_results WHERE run_id=$1'), 7);
  assert.equal(await q('SELECT count(DISTINCT settlement_line_id)::int n FROM match_results WHERE run_id=$1'), 7);
  await assert.rejects(app.pool.query(
    `INSERT INTO match_results (run_id, scope, outcome, rule_id, explanation, ledger_entry_id, reference, reference_date)
     SELECT run_id, 'TRANSACTION', 'PENDING', 'R04', 'dup', ledger_entry_id, reference, reference_date FROM match_results WHERE run_id=$1 AND ledger_entry_id IS NOT NULL LIMIT 1`, [runId]),
  /duplicate key/);
});

test('an identical run cannot be queued twice, even concurrently', async () => {
  const a = await app.as('analyst');
  const b = await app.as('analyst2');
  const l = await a.upload('ledger', 'l.csv', ledgerCsv);
  const s = await a.upload('settlement', 's.csv', settlementCsv);
  const body = { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id };
  const results = await Promise.all([a.post('/api/runs', body), b.post('/api/runs', body), a.post('/api/runs', body)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [202, 409, 409]);
  assert.equal(results.find((r) => r.status === 409).body.error.code, 'DUPLICATE_RUN');
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM reconciliation_runs')).rows[0].n, 1);
});

test('run creation validates its inputs', async () => {
  const a = await app.as('analyst');
  const l = await a.upload('ledger', 'l.csv', ledgerCsv);
  const s = await a.upload('settlement', 's.csv', settlementCsv);
  const L = l.body.data.file.id; const S = s.body.data.file.id;
  assert.equal((await a.post('/api/runs', { ledgerFileId: S, settlementFileId: L })).body.error.code, 'INVALID_LEDGER_SOURCE');
  assert.equal((await a.post('/api/runs', { ledgerFileId: L, settlementFileId: 999 })).body.error.code, 'INVALID_SETTLEMENT_SOURCE');
  assert.equal((await a.post('/api/runs', { ledgerFileId: L, settlementFileId: S, asOfDate: '2026-02-30' })).status, 400);
  assert.equal((await a.post('/api/runs', { ledgerFileId: L, settlementFileId: S, status: 'completed' })).status, 400); // mass-assignment: unknown keys refused
});

test('settings changes never rewrite a finished run (frozen snapshot), and a new run uses the new settings', async () => {
  const analyst = await app.as('analyst');
  const { runId, ledgerFileId, settlementFileId } = await runScenario(app, analyst);
  const before = (await analyst.get(`/api/runs/${runId}/results`)).body;
  const sup = await app.as('supervisor');
  const upd = await sup.put('/api/settings', { amountTolerancePaise: 10000, feeRatePercent: '3.5', feeTolerancePaise: 500, settlementWindowDays: 10, expectedVersion: 1, note: 'test' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.version, 2);

  const afterRun = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(afterRun.config.settingsVersion, 1);
  assert.equal(afterRun.config.feeRatePercent, '2.0000');
  assert.deepEqual((await analyst.get(`/api/runs/${runId}/results`)).body, before);

  const rerun = await analyst.post('/api/runs', { ledgerFileId, settlementFileId });
  assert.equal(rerun.status, 202);                   // different rules => different fingerprint
  await app.worker().processNext();
  const run2 = (await analyst.get(`/api/runs/${rerun.body.data.id}`)).body.data;
  assert.equal(run2.config.settingsVersion, 2);
  assert.equal(run2.summary.pending, 2);             // wider window: PAY-1005 now pending too
  assert.equal(run2.summary.breaksByType.AMOUNT_MISMATCH, undefined); // ₹50 difference is now inside the ₹100 tolerance
  assert.equal(run2.config.amountTolerancePaise, 10000);
});

test('stale settings edits are refused; only supervisors may edit; validation applies', async () => {
  const sup = await app.as('supervisor');
  const good = { amountTolerancePaise: 0, feeRatePercent: '2', feeTolerancePaise: 1, settlementWindowDays: 2 };
  assert.equal((await sup.put('/api/settings', { ...good, expectedVersion: 1 })).status, 200);
  const stale = await sup.put('/api/settings', { ...good, expectedVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'SETTINGS_STALE');
  assert.equal((await sup.put('/api/settings', { ...good, feeRatePercent: '2.00001', expectedVersion: 2 })).status, 400);
  assert.equal((await sup.put('/api/settings', { ...good, feeRatePercent: '25', expectedVersion: 2 })).status, 400);
  assert.equal((await sup.put('/api/settings', { ...good, settlementWindowDays: -1, expectedVersion: 2 })).status, 400);
  assert.equal((await (await app.as('analyst')).put('/api/settings', { ...good, expectedVersion: 2 })).status, 403);
  const hist = await sup.get('/api/settings/history');
  assert.equal(hist.body.page.total, 2);
  assert.equal((await app.pool.query("SELECT count(*)::int n FROM audit_events WHERE action='settings.updated'")).rows[0].n, 1);
});

test('two workers racing for one queued run: exactly one executes it', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst, { process: false });
  const results = await Promise.all([app.worker().processNext(), app.worker().processNext(), app.worker().processNext()]);
  assert.deepEqual(results.filter((r) => r !== null), [runId]);
  const { rows } = await app.pool.query('SELECT status, attempts FROM reconciliation_runs');
  assert.deepEqual(rows, [{ status: 'completed', attempts: 1 }]);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM breaks')).rows[0].n, 6);
});

test('a failing attempt is retried, then the run is failed after max attempts, with a safe message', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst, { process: false });
  const boom = () => { throw Object.assign(new Error('simulated engine crash'), { code: 'ENGINE_BOOM' }); };
  const worker = app.worker({ engine: boom });
  await worker.processNext();
  let run = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(run.status, 'queued');
  assert.equal(run.attempts, 1);
  assert.equal(run.errorCode, 'ENGINE_BOOM');
  await worker.processNext();
  await worker.processNext();
  run = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(run.status, 'failed');
  assert.equal(run.attempts, 3);
  assert.equal(run.errorMessage, 'simulated engine crash');
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM match_results')).rows[0].n, 0); // no partial output
  const actions = (await app.pool.query("SELECT action FROM audit_events WHERE action LIKE 'run.%' ORDER BY id")).rows.map((r) => r.action);
  assert.deepEqual(actions, ['run.created', 'run.retry_scheduled', 'run.retry_scheduled', 'run.failed']);
  // A failed run frees its fingerprint so the analyst can try again.
  const again = await analyst.post('/api/runs', { ledgerFileId: run.ledgerFileId, settlementFileId: run.settlementFileId });
  assert.equal(again.status, 202);
});

test('a crashed worker is recovered: expired lease is reclaimed, exhausted attempts are failed', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst, { process: false });
  // Simulate a worker that claimed the run and then died (lease still valid => nobody may take it).
  await app.pool.query("UPDATE reconciliation_runs SET status='running', attempts=1, locked_by='dead-worker', lease_expires_at = now() + interval '1 minute'");
  assert.equal(await app.worker().processNext(), null);
  await app.pool.query("UPDATE reconciliation_runs SET lease_expires_at = now() - interval '1 second'");
  assert.equal(await app.worker().processNext(), runId);
  const run = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(run.status, 'completed');
  assert.equal(run.attempts, 2);

  // Exhausted attempts + expired lease => failed rather than retried forever.
  const other = await runScenario(app, analyst, { process: false, ledger: ledgerCsv.replace('PAY-1001', 'PAY-7001'), settlement: settlementCsv.replace('PAY-1001', 'PAY-7001') });
  await app.pool.query("UPDATE reconciliation_runs SET status='running', attempts=max_attempts, locked_by='dead-worker', lease_expires_at = now() - interval '1 second' WHERE id=$1", [other.runId]);
  assert.equal(await app.worker().processNext(), null);
  const failed = (await analyst.get(`/api/runs/${other.runId}`)).body.data;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'WORKER_LOST');
});

test('a worker that lost its lease cannot write results', async () => {
  const analyst = await app.as('analyst');
  const { runId } = await runScenario(app, analyst, { process: false });
  const { reconcile } = require('../../src/modules/engine');
  const slow = (input) => {
    // While "computing", another worker takes over (lease expired and reclaimed).
    require('node:child_process'); // no-op to keep the function synchronous
    return reconcile(input);
  };
  const worker = app.worker({ engine: slow });
  // Take the lease away between claim and write by stealing it in the engine hook's place:
  const pool = app.pool;
  const original = pool.query.bind(pool);
  let stolen = false;
  pool.query = async (...args) => {
    const res = await original(...args);
    if (!stolen && typeof args[0] === 'string' && args[0].includes('FROM ledger_entries WHERE source_file_id')) {
      stolen = true;
      await original("UPDATE reconciliation_runs SET locked_by = 'thief' WHERE status = 'running'");
    }
    return res;
  };
  try { await worker.processNext(); } finally { pool.query = original; }
  const run = (await analyst.get(`/api/runs/${runId}`)).body.data;
  assert.equal(run.status, 'running');                     // still owned by the other worker
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM match_results')).rows[0].n, 0);
});
