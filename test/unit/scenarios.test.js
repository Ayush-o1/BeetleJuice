'use strict';
/**
 * The scenario library builds files AND their expected outcome by construction. These tests run every scenario
 * through the real parsers and the real engine and require the engine to reproduce the constructed truth, then
 * check engine-wide invariants on the same data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateScenario, listScenarios, SIZES } = require('../../scripts/lib/scenario-library');
const { runPipeline, DEFAULT_CONFIG } = require('../helpers/pipeline');
const { reconcile } = require('../../src/modules/engine');

const names = listScenarios().map((s) => s.name);
const SEED = 20261108;

function checkAgainstExpected(name, size, seed = SEED) {
  const g = generateScenario(name, { size, seed });
  const e = g.expected;
  const r = runPipeline(g.ledgerCsv, g.settlementCsv);
  const label = `${name}/${size}`;
  // upload layer
  assert.equal(r.ledger.length, e.ledgerRows.accepted, `${label}: accepted ledger rows`);
  assert.equal(r.led.rejectedRows, e.ledgerRows.rejected, `${label}: rejected ledger rows`);
  assert.equal(r.settlement.length + r.batches.length, e.settlementRows.accepted, `${label}: accepted settlement rows`);
  assert.equal(r.set.rejectedRows, e.settlementRows.rejected, `${label}: rejected settlement rows`);
  assert.deepEqual([...new Set(r.led.errors.map((x) => x.code))].sort(), e.rejectedCodes.ledger, `${label}: ledger rejection codes`);
  assert.deepEqual([...new Set(r.set.errors.map((x) => x.code))].sort(), e.rejectedCodes.settlement, `${label}: settlement rejection codes`);
  // reconciliation layer
  const s = r.out.summary;
  assert.equal(s.matched, e.transactions.matched, `${label}: matched`);
  assert.equal(s.pending, e.transactions.pending, `${label}: pending`);
  assert.equal(s.breaks, e.transactions.breaks, `${label}: transaction breaks`);
  for (const [type, n] of Object.entries(e.breaksByType)) assert.equal(s.breaksByType[type] ?? 0, n, `${label}: ${type}`);
  assert.equal(s.batchesMatched, e.batches.matched, `${label}: batches matched`);
  assert.equal(s.batchesBroken, e.batches.broken, `${label}: batches broken`);
  assert.deepEqual(r.out.results.filter((x) => x.scope === 'BATCH' && x.outcome === 'BREAK').map((x) => x.batchRef).sort(), e.batches.brokenIds, `${label}: which batches`);
  assert.equal(s.totalBreaks, e.totalBreaks, `${label}: total breaks`);
  return { g, r };
}

for (const size of ['small', 'normal', 'large']) {
  for (const name of names) {
    test(`scenario ${name} (${size}): engine reproduces the constructed expectation`, () => { checkAgainstExpected(name, size); });
  }
}

test('scenario xl: the largest size stays within upload limits and still reproduces its expectation', () => {
  for (const name of ['clean-day', 'break-storm']) {
    const { g } = checkAgainstExpected(name, 'xl');
    const rows = Math.max(g.expected.ledgerRows.total, g.expected.settlementRows.total);
    assert.ok(rows <= 50000, `${name}/xl has ${rows} rows; the default upload limit is 50,000`);
  }
});

test('different seeds give different data but the same constructed expectation shape; the same seed is byte-identical', () => {
  const a = generateScenario('break-storm', { size: 'normal', seed: 1 });
  const a2 = generateScenario('break-storm', { size: 'normal', seed: 1 });
  const b = generateScenario('break-storm', { size: 'normal', seed: 2 });
  assert.equal(a.ledgerCsv, a2.ledgerCsv);
  assert.equal(a.settlementCsv, a2.settlementCsv);
  assert.notEqual(a.ledgerCsv, b.ledgerCsv);
  assert.deepEqual(a.expected.breaksByType, b.expected.breaksByType, 'counts depend on size, not on the seed');
  checkAgainstExpected('break-storm', 'normal', 2);
  checkAgainstExpected('invalid-rows', 'normal', 99);
});

test('scenario sizes are what the documentation says', () => {
  assert.deepEqual(SIZES, { small: 10, normal: 150, large: 1500, xl: 15000 });
  const rows = (name, size) => generateScenario(name, { size }).expected.ledgerRows.total;
  assert.ok(rows('clean-day', 'small') < 30);
  assert.ok(rows('clean-day', 'normal') > 100 && rows('clean-day', 'normal') < 400);
  assert.ok(rows('clean-day', 'large') > 1000 && rows('clean-day', 'large') < 4000);
});

test('unknown scenario or size is a clear error, not a silent default', () => {
  assert.throws(() => generateScenario('nope'), /Unknown scenario/);
  assert.throws(() => generateScenario('clean-day', { size: 'huge' }), /Unknown size/);
});

test('every scenario exercises what its description promises', () => {
  const expected = (name) => generateScenario(name, { size: 'normal' }).expected;
  assert.equal(expected('clean-day').totalBreaks, 0);
  assert.ok(expected('clean-day').transactions.matched > 100);
  assert.ok(expected('missing-settlements').breaksByType.MISSING_IN_SETTLEMENT >= 10);
  assert.ok(expected('duplicate-references').breaksByType.DUPLICATE_SETTLEMENT >= 5);
  assert.ok(expected('duplicate-references').breaksByType.AMBIGUOUS_REFERENCE >= 3);
  assert.ok(expected('fee-variances').breaksByType.FEE_VARIANCE >= 10);
  assert.ok(expected('late-settlements').transactions.pending >= 10 && expected('late-settlements').breaksByType.MISSING_IN_SETTLEMENT >= 10);
  assert.ok(expected('refund-heavy').breaksByType.AMOUNT_MISMATCH >= 3 && expected('refund-heavy').breaksByType.MISSING_IN_LEDGER >= 1);
  assert.ok(expected('multi-batch').batches.total >= 4 * 4, 'four batches per settlement day');
  assert.ok(expected('invalid-rows').ledgerRows.rejected >= 10 && expected('invalid-rows').settlementRows.rejected >= 10);
  assert.ok(expected('invalid-rows').rejectedCodes.ledger.length >= 5);
  const storm = expected('break-storm');
  assert.ok(storm.totalBreaks / (storm.transactions.matched + storm.totalBreaks + storm.transactions.pending) > 0.3, 'a break-storm has a high break rate');
  const batch = expected('batch-payout-difference');
  assert.equal(batch.transactions.breaks, 0);
  assert.equal(batch.batches.broken, 2);
});

test('refunds in the refund-heavy scenario are negative on the settlement side and carry no fee', () => {
  const { g } = checkAgainstExpected('refund-heavy', 'normal');
  const refundLines = g.settlementCsv.split('\n').filter((l) => /^TXN,.*,REFUND,/.test(l));
  assert.ok(refundLines.length > 30);
  for (const l of refundLines) { const c = l.split(','); assert.ok(c[5].startsWith('-'), `refund amount is negative: ${l}`); assert.equal(c[6], '0.00', `refund fee is zero: ${l}`); }
});

test('committed small scenarios in demo-data/scenarios are exactly what the generator produces', () => {
  const dir = path.join(__dirname, '..', '..', 'demo-data', 'scenarios');
  for (const name of names) {
    const g = generateScenario(name, { size: 'small' });
    assert.equal(fs.readFileSync(path.join(dir, name, 'ledger.csv'), 'utf8'), g.ledgerCsv, `${name} ledger.csv is stale: run npm run demo:scenarios`);
    assert.equal(fs.readFileSync(path.join(dir, name, 'settlement.csv'), 'utf8'), g.settlementCsv, `${name} settlement.csv is stale`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, name, 'expected.json'), 'utf8')), g.expected, `${name} expected.json is stale`);
  }
});

/* ---------------- engine invariants over generated datasets ---------------- */

test('invariant: every ledger entry and settlement line gets exactly one result; batches get exactly one', () => {
  for (const name of names) {
    const { r } = checkAgainstExpected(name, 'normal');
    const ledgerIds = r.out.results.filter((x) => x.ledgerEntryId != null).map((x) => x.ledgerEntryId);
    const lineIds = r.out.results.filter((x) => x.settlementLineId != null).map((x) => x.settlementLineId);
    assert.equal(new Set(ledgerIds).size, ledgerIds.length, `${name}: a ledger entry appears in two results`);
    assert.equal(new Set(lineIds).size, lineIds.length, `${name}: a settlement line appears in two results`);
    assert.deepEqual([...new Set(ledgerIds)].sort((a, b) => a - b), r.ledger.map((x) => x.id), `${name}: some ledger entry has no result`);
    assert.deepEqual([...new Set(lineIds)].sort((a, b) => a - b), r.settlement.map((x) => x.id), `${name}: some settlement line has no result`);
    const batchResults = r.out.results.filter((x) => x.scope === 'BATCH').map((x) => x.batchRef);
    assert.equal(new Set(batchResults).size, r.batches.length);
  }
});

test('invariant: a MATCHED pair has equal amount (within tolerance), the same reference and a fee within tolerance; nothing else is MATCHED', () => {
  for (const name of names) {
    const { r } = checkAgainstExpected(name, 'normal');
    const L = new Map(r.ledger.map((x) => [x.id, x])); const S = new Map(r.settlement.map((x) => [x.id, x]));
    for (const res of r.out.results.filter((x) => x.scope === 'TRANSACTION')) {
      if (res.outcome === 'MATCHED') {
        const l = L.get(res.ledgerEntryId); const s = S.get(res.settlementLineId);
        assert.ok(l && s, `${name}: a match needs both sides`);
        assert.equal(l.reference, s.reference);
        assert.equal(Math.abs(l.amountPaise - s.amountPaise) <= DEFAULT_CONFIG.amountTolerancePaise, true, `${name}: matched pair ${l.sourceId}/${s.sourceId} differs in amount`);
        assert.equal(l.direction, s.direction);
        const expectedFee = s.amountPaise > 0 ? Math.round(s.amountPaise * 0.02) : 0;     // test-side recomputation; half-up == Math.round for positives
        assert.ok(Math.abs(expectedFee - s.feePaise) <= DEFAULT_CONFIG.feeTolerancePaise, `${name}: matched pair with fee off by ${expectedFee - s.feePaise}`);
      } else if (res.outcome === 'PENDING') {
        assert.ok(res.ledgerEntryId != null && res.settlementLineId == null, 'pending is a ledger entry with no settlement');
      } else {
        assert.ok(res.breakType, `${name}: a break has a type`);
        assert.ok(res.explanation && res.explanation.length > 10, `${name}: a break explains itself`);
        assert.ok(res.ruleId, `${name}: a break names its rule`);
      }
    }
  }
});

test('invariant: no amount difference is ever silently matched or hidden', () => {
  const { r } = checkAgainstExpected('break-storm', 'large');
  const L = new Map(r.ledger.map((x) => [x.id, x])); const S = new Map(r.settlement.map((x) => [x.id, x]));
  const mismatches = r.out.results.filter((x) => x.breakType === 'AMOUNT_MISMATCH');
  assert.ok(mismatches.length > 20);
  for (const m of mismatches) {
    const l = L.get(m.ledgerEntryId); const s = S.get(m.settlementLineId);
    assert.notEqual(l.amountPaise, s.amountPaise, 'an AMOUNT_MISMATCH really differs');
    assert.equal(m.amountDiffPaise, s.amountPaise - l.amountPaise, 'the recorded difference is settlement minus ledger');
  }
});

test('invariant: batch results are computed from the batch\'s own lines', () => {
  const { r } = checkAgainstExpected('multi-batch', 'normal');
  const byBatch = new Map();
  for (const s of r.settlement) { const b = byBatch.get(s.batchRef) || { gross: 0, fee: 0 }; b.gross += s.amountPaise; b.fee += s.feePaise; byBatch.set(s.batchRef, b); }
  for (const decl of r.batches) {
    const lines = byBatch.get(decl.batchRef) || { gross: 0, fee: 0 };
    assert.equal(decl.declaredGrossPaise, lines.gross, `${decl.batchRef} gross`);
    assert.equal(decl.declaredFeePaise, lines.fee, `${decl.batchRef} fee`);
    assert.equal(decl.declaredPayoutPaise, lines.gross - lines.fee, `${decl.batchRef} payout`);
  }
});

test('invariant: identical inputs give identical output, and input ORDER does not change the result', () => {
  for (const name of ['break-storm', 'duplicate-references', 'late-settlements']) {
    const { r } = checkAgainstExpected(name, 'normal');
    const again = reconcile({ ledger: r.ledger, settlement: r.settlement, batches: r.batches, config: r.config });
    assert.deepEqual(again.results, r.out.results, `${name}: not repeatable`);
    // deterministic shuffle (reverse + interleave): rowNumber is preserved, so file order is still known to the engine
    const shuffle = (arr) => [...arr].reverse().sort((a, b) => (a.id % 7) - (b.id % 7));
    const shuffled = reconcile({ ledger: shuffle(r.ledger), settlement: shuffle(r.settlement), batches: shuffle(r.batches), config: r.config });
    const key = (res) => `${res.scope}|${res.ledgerEntryId}|${res.settlementLineId}|${res.batchRef}`;
    const norm = (res) => [...res].sort((a, b) => key(a).localeCompare(key(b)));
    assert.deepEqual(norm(shuffled.results), norm(r.out.results), `${name}: result depends on input order`);
  }
});

test('invariant: moving the as-of date forward only ever turns pending items into missing-in-settlement breaks', () => {
  const g = generateScenario('late-settlements', { size: 'normal' });
  const now = runPipeline(g.ledgerCsv, g.settlementCsv);
  const later = runPipeline(g.ledgerCsv, g.settlementCsv, { ...DEFAULT_CONFIG, asOfDate: '2026-11-20' });
  assert.equal(later.out.summary.pending, 0);
  assert.equal(later.out.summary.breaksByType.MISSING_IN_SETTLEMENT, now.out.summary.breaksByType.MISSING_IN_SETTLEMENT + now.out.summary.pending);
  assert.equal(later.out.summary.matched, now.out.summary.matched);
});

test('the fee tolerance boundary is exact: +1 paisa matches, +2 paisa is a break', () => {
  const g = generateScenario('fee-variances', { size: 'normal' });
  const r = runPipeline(g.ledgerCsv, g.settlementCsv);
  assert.equal(r.out.summary.breaksByType.FEE_VARIANCE, g.expected.breaksByType.FEE_VARIANCE);
  const strict = runPipeline(g.ledgerCsv, g.settlementCsv, { ...DEFAULT_CONFIG, feeTolerancePaise: 0 });
  assert.ok(strict.out.summary.breaksByType.FEE_VARIANCE > r.out.summary.breaksByType.FEE_VARIANCE, 'a stricter tolerance reports the ±1 paisa items too');
});
