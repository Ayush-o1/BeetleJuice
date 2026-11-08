'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../helpers/app');
const { runScenario } = require('../helpers/scenario');

let app;
let analyst; let analyst2; let sup; let sup2; let auditor; let runId;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => {
  await app.reset();
  analyst = await app.as('analyst'); analyst2 = await app.as('analyst2');
  sup = await app.as('supervisor'); sup2 = await app.as('supervisor2'); auditor = await app.as('auditor');
  ({ runId } = await runScenario(app, analyst));
});

const findBreak = async (ref, type) => {
  const r = await analyst.get(`/api/breaks?q=${ref}${type ? `&type=${type}` : ''}`);
  assert.ok(r.body.data.length >= 1, `break ${ref} ${type || ''}`);
  return r.body.data[0];
};
const proposal = (b, code = 'DISPUTE_WITH_PROCESSOR') => ({ resolutionCode: code, note: 'Raised with the processor; awaiting credit note.', breakVersion: b.version });

test('break queue: filters, sorting, pagination and ageing', async () => {
  const all = await analyst.get('/api/breaks?pageSize=4&page=1&sort=impact:desc');
  assert.equal(all.body.page.total, 6);
  assert.equal(all.body.page.pages, 2);
  assert.equal(all.body.data.length, 4);
  const impacts = all.body.data.map((b) => b.impactPaise);
  assert.deepEqual(impacts, [...impacts].sort((a, b) => b - a));
  assert.equal((await analyst.get('/api/breaks?type=FEE_VARIANCE')).body.page.total, 1);
  assert.equal((await analyst.get('/api/breaks?side=ledger')).body.page.total, 1);           // MISSING_IN_SETTLEMENT
  assert.equal((await analyst.get('/api/breaks?side=both')).body.page.total, 2);             // amount mismatch + fee variance
  assert.equal((await analyst.get('/api/breaks?batch=B-1002')).body.page.total, 2);          // missing-in-ledger line + batch mismatch
  assert.equal((await analyst.get('/api/breaks?minAmount=500&maxAmount=1000')).body.page.total, 2); // 640.00 missing in ledger, 800.00 duplicate
  assert.equal((await analyst.get('/api/breaks?q=pay-1005')).body.page.total, 1);             // case-insensitive contains
  assert.equal((await analyst.get('/api/breaks?from=2026-11-04&to=2026-11-04')).body.page.total, 2);
  assert.equal((await analyst.get('/api/breaks?status=unresolved')).body.page.total, 6);
  assert.equal((await analyst.get('/api/breaks?status=resolved')).body.page.total, 0);
  const aged = await analyst.get('/api/breaks?minAge=0&sort=age:desc');
  assert.ok(aged.body.data[0].ageDays >= aged.body.data.at(-1).ageDays);
  assert.equal((await analyst.get('/api/breaks?minAmount=abc')).status, 400);
  assert.equal((await analyst.get('/api/breaks?type=NOPE')).status, 400);
  assert.equal((await analyst.get('/api/breaks?sort=password;drop')).status, 200); // unknown sort keys fall back, never reach SQL
});

test('break detail is fully traceable: result, both source records, batch context, run snapshot', async () => {
  const b = await findBreak('PAY-1002');
  const d = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  assert.equal(d.type, 'AMOUNT_MISMATCH');
  assert.equal(d.result.ruleId, 'R02');
  assert.equal(d.result.ruleName, 'Reference match with amount mismatch');
  assert.equal(d.ledger.ledgerId, 'L-2');
  assert.equal(d.ledger.amountPaise, 120000);
  assert.equal(d.settlement.lineId, 'S-2');
  assert.equal(d.settlement.amountPaise, 125000);
  assert.equal(d.result.amountDiffPaise, 5000);
  assert.equal(d.batch.summary.batchRef, 'B-1001');
  assert.equal(d.batch.result.outcome, 'MATCHED');
  assert.equal(d.run.id, runId);
  assert.equal(d.run.settingsVersion, 1);
  assert.equal(d.status, 'open');
  assert.equal(d.timeline[0].action, 'break.created');

  const dup = (await analyst.get(`/api/breaks/${(await findBreak('PAY-1003', 'DUPLICATE_SETTLEMENT')).id}`)).body.data;
  assert.equal(dup.related.settlement.length, 1);       // the line that actually settled it
  assert.equal(dup.ledger, null);
  const batch = (await analyst.get(`/api/breaks/${(await findBreak('B-1002', 'BATCH_PAYOUT_MISMATCH')).id}`)).body.data;
  assert.equal(batch.result.details.diffs.payoutPaise, -720)  // declared 620.00 vs 627.20 implied by the lines;
  assert.equal(batch.batch.summary.declaredPayoutPaise, 62000);
  assert.equal((await analyst.get('/api/breaks/999999')).status, 404);
  assert.equal((await analyst.get('/api/breaks/abc')).status, 400);
});

test('maker-checker: propose, review, approve; history is preserved and audited atomically', async () => {
  const b = await findBreak('PAY-1002');
  const note = await analyst.post(`/api/breaks/${b.id}/notes`, { body: 'Called processor; they confirm the higher amount.' });
  assert.equal(note.status, 201);
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b, 'CORRECT_LEDGER'));
  assert.equal(p.status, 201);
  assert.equal(p.body.data.status, 'pending');
  let d = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  assert.equal(d.status, 'pending_review');
  assert.equal(d.version, b.version + 1);

  assert.equal((await sup.get('/api/proposals')).body.page.total, 1);
  const decision = await sup.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', note: 'Agreed.', breakVersion: d.version });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.data.status, 'approved');
  assert.equal(decision.body.data.decidedBy, 'supervisor');

  d = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  assert.equal(d.status, 'resolved');
  assert.equal(d.resolutionCode, 'CORRECT_LEDGER');
  assert.ok(d.resolvedAt);
  assert.deepEqual(d.timeline.map((e) => e.action), ['break.created', 'break.note_added', 'proposal.created', 'proposal.approved', 'break.resolved']);
  assert.equal(d.proposals[0].proposedBy, 'analyst');
  // resolved is final
  assert.equal((await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(d))).status, 409);
  assert.equal((await analyst.post(`/api/breaks/${b.id}/notes`, { body: 'late note' })).status, 409);
});

test('rejection keeps the proposal, reopens the break, and allows a new proposal', async () => {
  const b = await findBreak('PAY-1006');
  const p1 = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b, 'WRITE_OFF'));
  const v = (await analyst.get(`/api/breaks/${b.id}`)).body.data.version;
  assert.equal((await sup.post(`/api/proposals/${p1.body.data.id}/decision`, { decision: 'rejected', breakVersion: v })).status, 400); // reason required
  const rej = await sup.post(`/api/proposals/${p1.body.data.id}/decision`, { decision: 'rejected', note: 'Fee dispute, do not write off.', breakVersion: v });
  assert.equal(rej.status, 200);
  const d = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  assert.equal(d.status, 'open');
  const p2 = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(d, 'DISPUTE_WITH_PROCESSOR'));
  assert.equal(p2.status, 201);
  const after = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  assert.deepEqual(after.proposals.map((x) => [x.status, x.resolutionCode]), [['rejected', 'WRITE_OFF'], ['pending', 'DISPUTE_WITH_PROCESSOR']]);
  assert.equal(after.proposals[0].decisionNote, 'Fee dispute, do not write off.');
});

test('self-approval is impossible: service refuses, audit records it, and the database also refuses', async () => {
  // Make a supervisor the author of a proposal by using the DB directly (analysts cannot hold both roles through the API).
  const b = await findBreak('PAY-1005');
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const v = (await analyst.get(`/api/breaks/${b.id}`)).body.data.version;
  // 1) The author (analyst) is not a supervisor.
  assert.equal((await analyst.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: v })).status, 403);
  // 2) Promote the author to supervisor to test the "not your own" rule specifically.
  await app.pool.query("UPDATE users SET role = 'supervisor' WHERE username = 'analyst'");
  const promoted = await app.as('analyst');
  const self = await promoted.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: v });
  assert.equal(self.status, 403);
  assert.equal(self.body.error.code, 'SELF_DECISION_FORBIDDEN');
  const { rows } = await app.pool.query("SELECT count(*)::int n FROM audit_events WHERE action = 'proposal.self_decision_blocked'");
  assert.equal(rows[0].n, 1);
  // 3) Defence in depth: even a direct INSERT bypassing the service is rejected by the trigger.
  await assert.rejects(app.pool.query(
    "INSERT INTO resolution_decisions (proposal_id, decided_by, decision) VALUES ($1, (SELECT id FROM users WHERE username='analyst'), 'approved')", [p.body.data.id]),
  /cannot be decided by its author/);
  assert.equal((await analyst.get(`/api/breaks/${b.id}`)).body.data.status, 'pending_review');
});

test('only supervisors can decide, and the decision cannot be made by an auditor or another analyst', async () => {
  const b = await findBreak('PAY-1005');
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const v = (await analyst.get(`/api/breaks/${b.id}`)).body.data.version;
  for (const c of [analyst2, auditor]) assert.equal((await c.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: v })).status, 403);
  assert.equal((await auditor.post(`/api/breaks/${b.id}/notes`, { body: 'x' })).status, 403);
  assert.equal((await sup.post(`/api/breaks/${b.id}/proposals`, proposal(b))).status, 403);
});

test('two supervisors deciding at once: exactly one decision is recorded, the other gets 409', async () => {
  const b = await findBreak('PAY-1005');
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const v = (await analyst.get(`/api/breaks/${b.id}`)).body.data.version;
  const results = await Promise.all([
    sup.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: v }),
    sup2.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'rejected', note: 'No, reject it.', breakVersion: v }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const loser = results.find((r) => r.status === 409);
  assert.ok(['BREAK_CHANGED', 'PROPOSAL_ALREADY_DECIDED'].includes(loser.body.error.code));
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM resolution_decisions')).rows[0].n, 1);
  const final = (await analyst.get(`/api/breaks/${b.id}`)).body.data;
  const winner = results.find((r) => r.status === 200).body.data.status;
  assert.equal(final.status, winner === 'approved' ? 'resolved' : 'open');
  assert.equal(final.version, v + 1);
});

test('a decision based on a stale view of the break is refused (no time-of-check/time-of-use gap)', async () => {
  const b = await findBreak('PAY-1005');
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const stale = await sup.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: b.version }); // version before the proposal
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'BREAK_CHANGED');
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM resolution_decisions')).rows[0].n, 0);
  assert.equal((await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b))).status, 409); // stale + not open
});

test('concurrent proposals for the same break: one wins', async () => {
  const b = await findBreak('PAY-1005');
  const res = await Promise.all([analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b)), analyst2.post(`/api/breaks/${b.id}/proposals`, proposal(b, 'NO_ACTION'))]);
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await app.pool.query("SELECT count(*)::int n FROM resolution_proposals WHERE status='pending'")).rows[0].n, 1);
});

test('request validation: proposals and decisions reject malformed or privileged input', async () => {
  const b = await findBreak('PAY-1005');
  const bad = [
    { resolutionCode: 'DELETE_EVERYTHING', note: 'long enough note', breakVersion: 1 },
    { resolutionCode: 'NO_ACTION', note: 'short', breakVersion: 1 },
    { resolutionCode: 'NO_ACTION', note: 'long enough note', breakVersion: 'x' },
    { resolutionCode: 'NO_ACTION', note: 'long enough note', breakVersion: 1, status: 'resolved' },
  ];
  for (const body of bad) assert.equal((await analyst.post(`/api/breaks/${b.id}/proposals`, body)).status, 400);
  assert.equal((await sup.post('/api/proposals/999/decision', { decision: 'approved', breakVersion: 1 })).status, 404);
  assert.equal((await analyst.get('/api/breaks')).status, 200);
});

test('database guarantees hold even when the service layer is bypassed', async () => {
  const q = (sql, p) => app.pool.query(sql, p);
  // audit history is append-only
  await assert.rejects(q("UPDATE audit_events SET action = 'tampered'"), /append-only/);
  await assert.rejects(q('DELETE FROM audit_events'), /append-only/);
  await assert.rejects(q('TRUNCATE audit_events'), /append-only/);
  // engine output and source data are immutable
  await assert.rejects(q('UPDATE match_results SET explanation = $1', ['x']), /append-only/);
  await assert.rejects(q('DELETE FROM ledger_entries'), /append-only/);
  await assert.rejects(q('UPDATE settlement_lines SET amount_paise = 1'), /append-only/);
  await assert.rejects(q('UPDATE source_files SET size_bytes = 1'), /append-only/);
  // a finished run is frozen; illegal transitions are rejected
  await assert.rejects(q("UPDATE reconciliation_runs SET status = 'queued'"), /can no longer change/);
  await assert.rejects(q('UPDATE reconciliation_runs SET as_of_date = as_of_date + 1'), /can no longer change/);
  await assert.rejects(q('DELETE FROM reconciliation_runs'), /cannot be deleted/);
  // break state machine
  await assert.rejects(q("UPDATE breaks SET status = 'resolved', resolved_at = now(), resolution_code = 'X' WHERE id = 1"), /illegal break transition/);
  await assert.rejects(q('DELETE FROM breaks'), /cannot be deleted/);
  // money rules
  await assert.rejects(q("UPDATE users SET role = 'root'"), /violates check/);
  // settings are append-only
  await assert.rejects(q('UPDATE settings_versions SET fee_rate_percent = 0'), /append-only/);
  await assert.rejects(q('DELETE FROM settings_versions'), /append-only/);
});

test('approved proposals are final at the database level (one approved per break, content frozen)', async () => {
  const b = await findBreak('PAY-1005');
  const p = await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const v = (await analyst.get(`/api/breaks/${b.id}`)).body.data.version;
  await sup.post(`/api/proposals/${p.body.data.id}/decision`, { decision: 'approved', breakVersion: v });
  await assert.rejects(app.pool.query('UPDATE resolution_proposals SET note = $1 WHERE id = $2', ['rewritten history', p.body.data.id]), /already approved/);
  await assert.rejects(app.pool.query("INSERT INTO resolution_proposals (break_id, proposed_by, resolution_code, note, break_version, status, decided_at) VALUES ($1,1,'NO_ACTION','another approved one',1,'approved',now())", [b.id]), /duplicate key/);
  await assert.rejects(app.pool.query('DELETE FROM resolution_decisions'), /append-only/);
});

test('exports neutralise spreadsheet formulas and respect filters; auditors can export', async () => {
  const csv = await auditor.get('/api/breaks/export.csv?type=MISSING_IN_SETTLEMENT');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /^break_id,run_id,type,status/);
  assert.equal(csv.text.trim().split('\r\n').length, 2);
  assert.match(csv.text, /PAY-1005/);
  assert.match(csv.text, /,300\.00,/);           // numeric cells are untouched
  const { toCsv, cell } = require('../../src/lib/csv-export');
  assert.equal(toCsv(['a'], [['=SUM(A1)'], ['+1'], ['-1'], ['@x'], ['ok'], ['say "hi", ok']]),
    'a\r\n\'=SUM(A1)\r\n\'+1\r\n\'-1\r\n\'@x\r\nok\r\n"say ""hi"", ok"\r\n');
  assert.equal(cell('\tcmd'), "'\tcmd");
  assert.equal(cell('＝1+1'), "'＝1+1");
});

test('audit log: readable by supervisors and auditors only, filterable, exportable', async () => {
  assert.equal((await analyst.get('/api/audit')).status, 403);
  const all = await auditor.get('/api/audit?pageSize=100');
  assert.equal(all.status, 200);
  assert.ok(all.body.page.total >= 10);
  assert.ok(all.body.data.every((e) => !JSON.stringify(e).includes('password')));
  assert.ok(all.body.data[0].occurredAt >= all.body.data.at(-1).occurredAt);
  assert.ok((await sup.get('/api/audit?action=auth.')).body.page.total >= 5);
  assert.equal((await sup.get('/api/audit?action=run.completed')).body.page.total, 1);
  assert.equal((await sup.get(`/api/audit?runId=${runId}&entityType=break`)).body.page.total, 6);
  assert.equal((await sup.get('/api/audit?from=2026-01-01&to=2026-01-02')).body.page.total, 0);
  assert.equal((await sup.get('/api/audit?from=nonsense')).status, 400);
  const exp = await auditor.get('/api/audit/export.csv?action=run.completed');
  assert.equal(exp.status, 200);
  assert.match(exp.text, /run\.completed/);
  assert.ok((await auditor.get('/api/audit/actions')).body.data.includes('proposal.created') === false); // none yet in this test
});

test('overview figures come from persisted data', async () => {
  const o = (await analyst.get('/api/overview')).body.data;
  assert.equal(o.sources.ledgerFiles, 1);
  assert.equal(o.runs.completed, 1);
  assert.equal(o.breaks.open, 6);
  assert.equal(o.latestRun.id, runId);
  assert.equal(o.latestRun.summary.matched, 3);
  assert.equal(o.awaitingReview, 0);
  const b = await findBreak('PAY-1005');
  await analyst.post(`/api/breaks/${b.id}/proposals`, proposal(b));
  const o2 = (await sup.get('/api/overview')).body.data;
  assert.equal(o2.breaks.pendingReview, 1);
  assert.equal(o2.awaitingReview, 1);
});
