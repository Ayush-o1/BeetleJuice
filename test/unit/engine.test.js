'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcile } = require('../../src/modules/engine');
const { led, line, batch, honestBatch, baseConfig } = require('../helpers/engine-fixtures');

const run = (ledger, settlement, over = {}, batches) =>
  reconcile({ ledger, settlement, batches: batches ?? [...new Set(settlement.map((s) => s.batchRef))].map((b) => honestBatch(b, settlement)), config: baseConfig(over) });
const tx = (res) => res.results.filter((r) => r.scope === 'TRANSACTION');
const only = (res) => { const t = tx(res); assert.equal(t.length, 1, `expected one transaction result, got ${t.length}`); return t[0]; };

test('R01 exact reference and amount match', () => {
  const r = only(run([led('L1', 'PAY-1', 100000)], [line('S1', 'PAY-1', 100000)]));
  assert.equal(r.outcome, 'MATCHED');
  assert.equal(r.ruleId, 'R01');
  assert.match(r.explanation, /Settlement matched/);
});

test('R02 a one-paisa difference is an amount mismatch, never a match', () => {
  const r = only(run([led('L1', 'PAY-1', 100000)], [line('S1', 'PAY-1', 100001, 'B1', { feePaise: 2000 })]));
  assert.equal(r.breakType, 'AMOUNT_MISMATCH');
  assert.equal(r.ruleId, 'R02');
  assert.equal(r.amountDiffPaise, 1);
  assert.equal(r.impactPaise, 1);
});

test('amount tolerance turns a small difference into a match and records the difference', () => {
  const r = only(run([led('L1', 'PAY-1', 100000)], [line('S1', 'PAY-1', 100050, 'B1', { feePaise: 2001 })], { amountTolerancePaise: 50 }));
  assert.equal(r.outcome, 'MATCHED');
  assert.equal(r.amountDiffPaise, 50);
  assert.match(r.explanation, /within the ₹0.50 tolerance/);
  const over = only(run([led('L1', 'PAY-1', 100000)], [line('S1', 'PAY-1', 100051, 'B1', { feePaise: 2001 })], { amountTolerancePaise: 50 }));
  assert.equal(over.breakType, 'AMOUNT_MISMATCH');
});

test('R03 the same transaction settled twice: one match plus one duplicate break', () => {
  const res = run([led('L1', 'PAY-1', 50000)], [line('S1', 'PAY-1', 50000), line('S2', 'PAY-1', 50000)]);
  const t = tx(res);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((r) => r.ruleId).sort(), ['R01', 'R03']);
  const dup = t.find((r) => r.ruleId === 'R03');
  assert.equal(dup.breakType, 'DUPLICATE_SETTLEMENT');
  assert.equal(dup.ledgerEntryId, null);
  assert.notEqual(dup.settlementLineId, null);
  assert.match(dup.explanation, /settled more than once/);
});

test('R03 a second settlement line with a different amount is still a duplicate, not a silent match', () => {
  const res = run([led('L1', 'PAY-1', 50000)], [line('S1', 'PAY-1', 50000), line('S2', 'PAY-1', 70000)]);
  const dup = tx(res).find((r) => r.breakType);
  assert.equal(dup.breakType, 'DUPLICATE_SETTLEMENT');
  assert.equal(dup.impactPaise, 70000);
});

test('R04 pending until the end of the settlement window, then R06 missing', () => {
  // Recorded 6 Nov, window 1 day -> deadline 7 Nov.
  const l = () => [led('L1', 'PAY-1', 10000, '2026-11-06')];
  const at = (asOf) => only(run(l(), [], { settlementWindowDays: 1, asOfDate: asOf }, []));
  assert.equal(at('2026-11-06').outcome, 'PENDING');
  assert.equal(at('2026-11-07').outcome, 'PENDING');         // deadline day itself is still pending
  const late = at('2026-11-08');
  assert.equal(late.breakType, 'MISSING_IN_SETTLEMENT');
  assert.equal(late.ruleId, 'R06');
  assert.match(late.explanation, /not settled by 2026-11-07/);
});

test('R04 window of zero days: pending only on the recording day', () => {
  const l = [led('L1', 'PAY-1', 10000, '2026-11-06')];
  assert.equal(only(run(l, [], { settlementWindowDays: 0, asOfDate: '2026-11-06' }, [])).outcome, 'PENDING');
  assert.equal(only(run(l, [], { settlementWindowDays: 0, asOfDate: '2026-11-07' }, [])).breakType, 'MISSING_IN_SETTLEMENT');
});

test('R05 settlement line with no ledger record', () => {
  const r = only(run([], [line('S1', 'PAY-9', 20000)]));
  assert.equal(r.breakType, 'MISSING_IN_LEDGER');
  assert.equal(r.ruleId, 'R05');
});

test('refund and payment sharing a reference are different keys and both match', () => {
  const res = run(
    [led('L1', 'PAY-1', 100000), led('L2', 'PAY-1', -30000, '2026-11-02')],
    [line('S1', 'PAY-1', 100000), line('S2', 'PAY-1', -30000)],
  );
  assert.deepEqual(tx(res).map((r) => r.outcome), ['MATCHED', 'MATCHED']);
});

test('refund sign conventions: a refund only matches a refund of the same magnitude', () => {
  const r = only(run([led('L1', 'RF-1', -25000)], [line('S1', 'RF-1', -25000)]));
  assert.equal(r.outcome, 'MATCHED');
  const mismatch = tx(run([led('L1', 'PAY-1', 25000)], [line('S1', 'PAY-1', -25000)]));
  assert.equal(mismatch.length, 2); // different direction => different keys => two separate breaks
  assert.deepEqual(mismatch.map((r) => r.breakType).sort(), ['MISSING_IN_LEDGER', 'MISSING_IN_SETTLEMENT']);
});

test('R09 ambiguity: repeated reference whose amounts do not pair is never guessed', () => {
  const res = run(
    [led('L1', 'PAY-7', 10000), led('L2', 'PAY-7', 20000)],
    [line('S1', 'PAY-7', 15000)],
  );
  const t = tx(res);
  assert.equal(t.length, 3);
  assert.ok(t.every((r) => r.breakType === 'AMBIGUOUS_REFERENCE' && r.ruleId === 'R09'));
});

test('R09 one ledger entry vs two settlement lines that equal neither is ambiguous, not "mismatch plus duplicate"', () => {
  const t = tx(run([led('L1', 'PAY-8', 10000)], [line('S1', 'PAY-8', 15000), line('S2', 'PAY-8', 15000)]));
  assert.equal(t.length, 3);
  assert.ok(t.every((r) => r.breakType === 'AMBIGUOUS_REFERENCE'));
});

test('repeated reference where one amount is exact: pair the exact one, leave the other to the window rules', () => {
  const l1 = led('L1', 'PAY-7', 10000, '2026-11-07');
  const l2 = led('L2', 'PAY-7', 20000, '2026-11-07');
  const res = run([l1, l2], [line('S1', 'PAY-7', 20000)]);
  const t = tx(res);
  assert.equal(t.find((r) => r.outcome === 'MATCHED').ledgerEntryId, l2.id);
  assert.equal(t.find((r) => r.outcome === 'PENDING').ledgerEntryId, l1.id);
});

test('identical repeated records pair off in file order and say so', () => {
  const res = run(
    [led('L1', 'PAY-5', 5000), led('L2', 'PAY-5', 5000)],
    [line('S1', 'PAY-5', 5000), line('S2', 'PAY-5', 5000)],
  );
  const t = tx(res);
  assert.equal(t.length, 2);
  assert.ok(t.every((r) => r.outcome === 'MATCHED' && /paired in file order/.test(r.explanation)));
  assert.notEqual(t[0].settlementLineId, t[1].settlementLineId);
});

test('R08 fee variance at the tolerance boundary', () => {
  // 2% of ₹1,000.00 = 2000 paise. Tolerance 1.
  const f = (fee) => only(run([led('L1', 'PAY-1', 100000)], [line('S1', 'PAY-1', 100000, 'B1', { feePaise: fee })]));
  assert.equal(f(2000).outcome, 'MATCHED');
  assert.equal(f(2001).outcome, 'MATCHED');
  assert.equal(f(1999).outcome, 'MATCHED');
  const hi = f(2002);
  assert.equal(hi.breakType, 'FEE_VARIANCE');
  assert.equal(hi.ruleId, 'R08');
  assert.equal(hi.amountDiffPaise, 2);
  assert.equal(hi.expectedFeePaise, 2000);
  assert.equal(f(1998).breakType, 'FEE_VARIANCE');
});

test('R08 uses half-up rounding for the expected fee', () => {
  // ₹0.25 * 2% = 0.5 paise -> expected 1 paisa.
  const r = only(run([led('L1', 'PAY-1', 25)], [line('S1', 'PAY-1', 25, 'B1', { feePaise: 1 })], { feeTolerancePaise: 0 }));
  assert.equal(r.outcome, 'MATCHED');
  assert.equal(r.expectedFeePaise, 1);
});

test('R08 refunds carry no expected fee', () => {
  const ok = only(run([led('L1', 'RF-1', -10000)], [line('S1', 'RF-1', -10000, 'B1', { feePaise: 0 })]));
  assert.equal(ok.outcome, 'MATCHED');
  const bad = only(run([led('L1', 'RF-1', -10000)], [line('S1', 'RF-1', -10000, 'B1', { feePaise: 200 })]));
  assert.equal(bad.breakType, 'FEE_VARIANCE');
});

test('R07 batch reconciles when lines, fees and payout agree', () => {
  const lines = [line('S1', 'A', 100000), line('S2', 'B', 50000)];
  const res = run([led('L1', 'A', 100000), led('L2', 'B', 50000)], lines);
  const b = res.results.filter((r) => r.scope === 'BATCH');
  assert.equal(b.length, 1);
  assert.equal(b[0].outcome, 'MATCHED');
  assert.equal(b[0].details.computed.expectedNetPaise, 150000 - 3000);
});

test('R07 payout mismatch is a batch-level break distinct from transaction breaks', () => {
  const lines = [line('S1', 'A', 100000), line('S2', 'B', 50000)];
  const bad = batch('B1', 150000, 3000, 146500); // payout short by ₹5
  const res = run([led('L1', 'A', 100000), led('L2', 'B', 50000)], lines, {}, [bad]);
  const b = res.results.find((r) => r.scope === 'BATCH');
  assert.equal(b.breakType, 'BATCH_PAYOUT_MISMATCH');
  assert.equal(b.amountDiffPaise, -500);
  assert.equal(b.impactPaise, 500);
  assert.match(b.explanation, /Batch payout does not reconcile/);
  assert.ok(tx(res).every((r) => r.outcome === 'MATCHED')); // transaction side is clean
});

test('R07 declared gross or fee that disagrees with the lines is also flagged', () => {
  const lines = [line('S1', 'A', 100000)];
  const gross = reconcile({ ledger: [], settlement: lines, batches: [batch('B1', 100100, 2000, 98100)], config: baseConfig() });
  assert.equal(gross.results.find((r) => r.scope === 'BATCH').breakType, 'BATCH_PAYOUT_MISMATCH');
  const fee = reconcile({ ledger: [], settlement: lines, batches: [batch('B1', 100000, 2100, 97900)], config: baseConfig() });
  assert.match(fee.results.find((r) => r.scope === 'BATCH').explanation, /fees declared/);
});

test('R07 a duplicated settlement line is counted once per line, as the processor listed it', () => {
  const lines = [line('S1', 'A', 100000), line('S2', 'A', 100000)];
  const res = run([led('L1', 'A', 100000)], lines);
  const b = res.results.find((r) => r.scope === 'BATCH');
  assert.equal(b.outcome, 'MATCHED');
  assert.equal(b.details.computed.grossPaise, 200000);
});

test('R07 batch lines without a summary, and a summary without lines', () => {
  const noSummary = reconcile({ ledger: [], settlement: [line('S1', 'A', 100000)], batches: [], config: baseConfig() });
  assert.match(noSummary.results.find((r) => r.scope === 'BATCH').explanation, /no batch summary row/);
  const noLines = reconcile({ ledger: [], settlement: [], batches: [batch('B9', 500, 10, 490)], config: baseConfig() });
  assert.equal(noLines.results[0].breakType, 'BATCH_PAYOUT_MISMATCH');
});

test('determinism: input order does not change the output', () => {
  const ledger = [led('L1', 'A', 1000, '2026-11-01'), led('L2', 'B', 2000, '2026-11-02'), led('L3', 'B', 2000, '2026-11-02'),
    led('L4', 'C', 3000, '2026-11-03'), led('L5', 'D', 4000, '2026-11-07')];
  const settlement = [line('S1', 'A', 1000), line('S2', 'B', 2000), line('S3', 'C', 3500), line('S4', 'E', 900), line('S5', 'B', 2000)];
  const batches = [honestBatch('B1', settlement)];
  const a = reconcile({ ledger, settlement, batches, config: baseConfig() });
  const b = reconcile({ ledger: [...ledger].reverse(), settlement: [...settlement].reverse(), batches, config: baseConfig() });
  assert.deepEqual(b, a);
  assert.deepEqual(reconcile({ ledger, settlement, batches, config: baseConfig() }), a);
});

test('invariant: every record gets exactly one explicit outcome (seeded random inputs)', () => {
  let s = 12345;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  for (let round = 0; round < 200; round++) {
    const ledger = [];
    const settlement = [];
    const n = 1 + rnd(12);
    for (let i = 0; i < n; i++) {
      const ref = `R${rnd(5)}`;                                  // few refs => many collisions
      const amt = (1 + rnd(3)) * 1000 * (rnd(6) === 0 ? -1 : 1);
      const date = `2026-11-0${1 + rnd(8)}`;
      if (rnd(4) !== 0) ledger.push(led(`L${i}`, ref, amt, date, { id: 1000 * round + i }));
      if (rnd(4) !== 0) settlement.push(line(`S${i}`, ref, rnd(5) === 0 ? amt + 1 : amt, `B${rnd(2)}`, { id: 1000 * round + 500 + i, feePaise: rnd(3) }));
    }
    const batches = [...new Set(settlement.map((x) => x.batchRef))].map((b) => honestBatch(b, settlement));
    const res = reconcile({ ledger, settlement, batches, config: baseConfig({ asOfDate: `2026-11-0${1 + rnd(9)}` }) });
    const seenL = new Map();
    const seenS = new Map();
    for (const r of res.results) {
      if (r.ledgerEntryId != null) seenL.set(r.ledgerEntryId, (seenL.get(r.ledgerEntryId) || 0) + 1);
      if (r.settlementLineId != null) seenS.set(r.settlementLineId, (seenS.get(r.settlementLineId) || 0) + 1);
      assert.ok(r.explanation && r.ruleId);
    }
    for (const l of ledger) assert.equal(seenL.get(l.id), 1, `ledger ${l.id} in round ${round}`);
    for (const x of settlement) assert.equal(seenS.get(x.id), 1, `settlement ${x.id} in round ${round}`);
  }
});

test('the summary counts agree with the results', () => {
  const ledger = [led('L1', 'A', 1000), led('L2', 'B', 2000, '2026-11-08')];
  const settlement = [line('S1', 'A', 1000), line('S2', 'Z', 700)];
  const res = run(ledger, settlement);
  assert.equal(res.summary.matched, 1);
  assert.equal(res.summary.pending, 1);
  assert.equal(res.summary.breaks, 1);
  assert.equal(res.summary.breaksByType.MISSING_IN_LEDGER, 1);
  assert.equal(res.summary.ledgerTotalPaise, 3000);
});
