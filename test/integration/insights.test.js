'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../helpers/app');
const { runScenario, ledgerCsv, settlementCsv } = require('../helpers/scenario');

let app; let analyst; let sup; let auditor;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => {
  await app.reset();
  analyst = await app.as('analyst'); sup = await app.as('supervisor'); auditor = await app.as('auditor');
});

test('trace: a matched reference shows both records and the run decision; lookup is case-insensitive', async () => {
  const { runId } = await runScenario(app, analyst);
  const r = await analyst.get('/api/trace?reference=pay-1001');
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.reference, 'PAY-1001');
  assert.equal(d.ledger.length, 1);
  assert.equal(d.ledger[0].amountPaise, 500000);
  assert.equal(d.settlement.length, 1);
  assert.equal(d.settlement[0].feePaise, 10000);
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].outcome, 'MATCHED');
  assert.equal(d.results[0].runId, runId);
  assert.equal(d.results[0].breakId, null);
});

test('trace: a duplicated reference lists every line and one result per record, with break ids', async () => {
  await runScenario(app, analyst);
  const d = (await analyst.get('/api/trace?reference=PAY-1003')).body.data;
  assert.equal(d.ledger.length, 1);
  assert.equal(d.settlement.length, 2);
  assert.equal(d.results.length, 2);
  assert.deepEqual(d.results.map((x) => x.outcome).sort(), ['BREAK', 'MATCHED']);
  assert.ok(d.results.find((x) => x.outcome === 'BREAK').breakId > 0);
});

test('trace: unreconciled and unknown references, validation and permissions', async () => {
  const l = await analyst.upload('ledger', 'ledger-nov.csv', ledgerCsv);
  await analyst.upload('settlement', 'settlement-nov.csv', settlementCsv);
  assert.equal(l.status, 201);
  const before = (await analyst.get('/api/trace?reference=PAY-1001')).body.data;
  assert.equal(before.ledger.length, 1);
  assert.equal(before.results.length, 0, 'no completed run yet: records exist but nothing has classified them');
  const none = (await analyst.get('/api/trace?reference=DOES-NOT-EXIST')).body.data;
  assert.deepEqual([none.ledger.length, none.settlement.length, none.results.length], [0, 0, 0]);
  assert.equal((await analyst.get('/api/trace?reference=')).status, 400);
  assert.equal((await analyst.get('/api/trace?reference=x')).status, 400);
  assert.equal((await analyst.get(`/api/trace?reference=${'A'.repeat(65)}`)).status, 400);
  assert.equal((await auditor.get('/api/trace?reference=PAY-1001')).status, 200, 'read-only roles can trace');
  assert.equal((await app.client().get('/api/trace?reference=PAY-1001')).status, 401);
});

test('trace: SQL metacharacters in the reference are data, not syntax', async () => {
  await runScenario(app, analyst);
  const r = await analyst.get(`/api/trace?reference=${encodeURIComponent("PAY-1001' OR '1'='1")}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.ledger.length, 0);
});

test('overview: ageing buckets sum to the unresolved breaks; recent activity comes from business tables, newest first', async () => {
  await runScenario(app, analyst);
  const d = (await sup.get('/api/overview')).body.data;
  const unresolved = d.breaks.open + d.breaks.pendingReview;
  assert.deepEqual(d.ageing.map((b) => b.bucket), ['d0_1', 'd2_3', 'd4_7', 'd8_plus']);
  assert.equal(d.ageing.reduce((t, b) => t + b.count, 0), unresolved);
  assert.equal(d.ageing.reduce((t, b) => t + b.impactPaise, 0), d.breaks.unresolvedImpactPaise);
  const types = d.recentActivity.map((a) => a.type);
  assert.ok(types.includes('upload') && types.includes('run_completed'));
  const at = d.recentActivity.map((a) => Date.parse(a.at));
  assert.deepEqual(at, [...at].sort((a, b) => b - a), 'newest first');
  assert.ok(d.recentActivity.find((a) => a.type === 'upload').actor, 'upload names the person');
  assert.deepEqual(d.recentFailures, []);
});

test('overview: recent activity includes decisions and never leaks audit-only data to analysts', async () => {
  await runScenario(app, analyst);
  const b = (await analyst.get('/api/breaks?q=PAY-1002')).body.data[0];
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, { resolutionCode: 'CORRECT_LEDGER', note: 'Ledger keyed the wrong amount; receipt shows 1250.', breakVersion: b.version });
  assert.equal(p.status, 201);
  const fresh = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  const pending = fresh.proposals.find((x) => x.status === 'pending');
  const dec = await sup.post(`/api/proposals/${pending.id}/decision`, { decision: 'approved', breakVersion: fresh.version });
  assert.equal(dec.status, 200);
  const d = (await analyst.get('/api/overview')).body.data;
  const decision = d.recentActivity.find((a) => a.type === 'decision_approved');
  assert.ok(decision);
  assert.equal(decision.actor, 'Meera Iyer');
  assert.equal(decision.label, 'PAY-1002');
  assert.ok(!d.recentActivity.some((a) => /^auth\./.test(a.type)), 'sign-ins are not part of the feed');
});

test('overview: a failed run is reported as a recent failure even when an earlier run completed', async () => {
  const { runId } = await runScenario(app, analyst);
  // second run on the same files but a different as-of date so the fingerprint differs
  const files = await analyst.get('/api/runs/' + runId);
  const r2 = await analyst.post('/api/runs', { ledgerFileId: files.body.data.ledgerFileId, settlementFileId: files.body.data.settlementFileId, asOfDate: '2026-11-09' });
  assert.equal(r2.status, 202);
  // the state machine only allows queued -> running -> failed; walk it the way the worker would
  await app.pool.query("UPDATE reconciliation_runs SET status = 'running', started_at = now(), attempts = 1, locked_by = 'test', lease_expires_at = now() + interval '1 minute' WHERE id = $1", [r2.body.data.id]);
  await app.pool.query("UPDATE reconciliation_runs SET status = 'failed', finished_at = now(), error_code = 'TEST_FAILURE', locked_by = NULL, lease_expires_at = NULL WHERE id = $1", [r2.body.data.id]);
  const d = (await sup.get('/api/overview')).body.data;
  assert.equal(d.recentFailures.length, 1);
  assert.equal(d.recentFailures[0].errorCode, 'TEST_FAILURE');
  assert.ok(d.latestRun, 'the earlier completed run is still the latest completed');
});

test('audit: actor display names are returned, and the sign-in filter hides only authentication events', async () => {
  await runScenario(app, analyst);
  const all = (await auditor.get('/api/audit?pageSize=100')).body;
  const withName = all.data.find((e) => e.actor === 'analyst');
  assert.equal(withName.actorName, 'Priya Nair');
  assert.ok(all.data.some((e) => e.action.startsWith('auth.')));
  const hidden = (await auditor.get('/api/audit?pageSize=100&hide=auth')).body;
  assert.ok(hidden.data.length > 0);
  assert.ok(!hidden.data.some((e) => e.action.startsWith('auth.')));
  assert.equal(hidden.page.total, all.page.total - all.data.filter((e) => e.action.startsWith('auth.')).length);
  assert.equal((await auditor.get('/api/audit?hide=everything')).status, 400, 'unknown values are rejected, not ignored');
  const csv = await auditor.get('/api/audit/export.csv?hide=auth');
  assert.equal(csv.status, 200);
  assert.ok(!/auth\.login/.test(csv.text));
  assert.equal((await analyst.get('/api/audit')).status, 403);
});
