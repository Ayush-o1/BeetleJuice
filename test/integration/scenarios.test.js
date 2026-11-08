'use strict';
/** The scenario library through the whole stack: HTTP upload -> database -> worker -> API, against constructed truth. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('../helpers/app');
const { generateScenario, listScenarios } = require('../../scripts/lib/scenario-library');

let app; let analyst; let auditor;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => { await app.reset(); analyst = await app.as('analyst'); auditor = await app.as('auditor'); });

async function load(name, size) {
  const g = generateScenario(name, { size });
  const l = await analyst.upload('ledger', `${name}-ledger.csv`, g.ledgerCsv);
  const s = await analyst.upload('settlement', `${name}-settlement.csv`, g.settlementCsv);
  assert.equal(l.status, 201, l.text); assert.equal(s.status, 201, s.text);
  const run = await analyst.post('/api/runs', { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id, asOfDate: g.expected.asOfDate });
  assert.equal(run.status, 202, run.text);
  await app.worker().processNext();
  const detail = (await analyst.get(`/api/runs/${run.body.data.id}`)).body.data;
  return { g, l: l.body.data, s: s.body.data, detail };
}

for (const { name } of listScenarios()) {
  test(`scenario ${name} (small) end to end: upload counts, run summary and break queue match the constructed truth`, async () => {
    const { g, l, s, detail } = await load(name, 'small');
    const e = g.expected;
    assert.equal(l.file.acceptedRows, e.ledgerRows.accepted);
    assert.equal(l.file.rejectedRows, e.ledgerRows.rejected);
    assert.equal(s.file.acceptedRows, e.settlementRows.accepted);
    assert.equal(s.file.rejectedRows, e.settlementRows.rejected);
    assert.equal(detail.status, 'completed');
    assert.equal(detail.summary.matched, e.transactions.matched);
    assert.equal(detail.summary.pending, e.transactions.pending);
    assert.equal(detail.summary.totalBreaks, e.totalBreaks);
    const queue = await analyst.get('/api/breaks?pageSize=100');
    assert.equal(queue.body.page.total, e.totalBreaks);
    for (const [type, n] of Object.entries(e.breaksByType)) {
      assert.equal((await analyst.get(`/api/breaks?type=${type}`)).body.page.total, n, type);
    }
  });
}

test('break-storm (normal): a large queue paginates consistently and its counts add up', async () => {
  const { g } = await load('break-storm', 'normal');
  const total = g.expected.totalBreaks;
  assert.ok(total > 60, 'a break storm is big enough to need several pages');
  const seen = new Set();
  let pages = 0;
  for (let p = 1; ; p++) {
    const r = await analyst.get(`/api/breaks?page=${p}&pageSize=25&sort=impact:desc`);
    assert.equal(r.status, 200);
    r.body.data.forEach((b) => { assert.ok(!seen.has(b.id), `break ${b.id} appears on two pages`); seen.add(b.id); });
    pages += 1;
    if (p >= r.body.page.pages) break;
  }
  assert.equal(seen.size, total);
  assert.equal(pages, Math.ceil(total / 25));
  const overview = (await auditor.get('/api/overview')).body.data;
  assert.equal(overview.breaks.open + overview.breaks.pendingReview, total);
  assert.equal(overview.ageing.reduce((t, b) => t + b.count, 0), total);
});

test('invalid-rows (normal): every rejected row is stored with its code and the clean rows still reconcile', async () => {
  const { g, l } = await load('invalid-rows', 'normal');
  const errors = await analyst.get(`/api/sources/${l.file.id}/errors?pageSize=100`);
  assert.equal(errors.body.page.total, g.expected.ledgerRows.rejected);
  assert.deepEqual([...new Set(errors.body.data.map((x) => x.code))].sort(), g.expected.rejectedCodes.ledger);
});

test('re-uploading a scenario file is rejected as a duplicate, and an identical run is refused', async () => {
  const { g, l, s } = await load('clean-day', 'small');
  const again = await analyst.upload('ledger', 'copy.csv', g.ledgerCsv);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'DUPLICATE_FILE');
  const dupRun = await analyst.post('/api/runs', { ledgerFileId: l.file.id, settlementFileId: s.file.id, asOfDate: g.expected.asOfDate });
  assert.equal(dupRun.status, 409);
});
