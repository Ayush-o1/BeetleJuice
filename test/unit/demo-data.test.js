'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateDemo } = require('../../scripts/lib/demo-data');
const { parseCsv, checkHeader } = require('../../src/modules/sources/csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('../../src/modules/sources/ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('../../src/modules/sources/settlement-parser');
const { reconcile } = require('../../src/modules/engine');

const demo = generateDemo();
const load = () => {
  const l = parseCsv(demo.ledgerCsv, { maxRows: 50000 }); checkHeader(l.header, LEDGER_COLUMNS);
  const s = parseCsv(demo.settlementCsv, { maxRows: 50000 }); checkHeader(s.header, SETTLEMENT_COLUMNS);
  return { led: parseLedgerRows(l.header, l.records), set: parseSettlementRows(s.header, s.records) };
};

test('demo files: parsers accept and reject exactly the rows the generator planted', () => {
  const { led, set } = load();
  const e = demo.expected;
  assert.equal(led.entries.length, e.ledgerRows.accepted);
  assert.equal(led.rejectedRows, e.ledgerRows.rejected);
  assert.equal(set.lines.length + set.batches.length, e.settlementRows.accepted);
  assert.equal(set.rejectedRows, e.settlementRows.rejected);
  assert.deepEqual([...new Set(led.errors.map((x) => x.code))].sort(), ['AMOUNT_PRECISION', 'AMOUNT_ZERO', 'CURRENCY', 'DATETIME_FORMAT']);
});

test('demo files: the engine reproduces the constructed ground truth exactly', () => {
  const { led, set } = load();
  const ledger = led.entries.map((x, i) => ({ id: i + 1, sourceId: x.ledgerId, reference: x.reference, amountPaise: x.amountPaise, businessDate: x.businessDate, rowNumber: x.rowNumber, direction: x.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  const settlement = set.lines.map((x, i) => ({ id: 10000 + i, sourceId: x.lineId, reference: x.reference, amountPaise: x.amountPaise, feePaise: x.feePaise, batchRef: x.batchRef, settledOn: x.settledOn, rowNumber: x.rowNumber, direction: x.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  const cfg = { amountTolerancePaise: 0, feeRatePercent: '2.0000', feeTolerancePaise: 1, settlementWindowDays: 2, asOfDate: demo.expected.asOfDate };
  const out = reconcile({ ledger, settlement, batches: set.batches, config: cfg });
  const e = demo.expected;
  assert.equal(out.summary.matched, e.transactions.matched);
  assert.equal(out.summary.pending, e.transactions.pending);
  assert.equal(out.summary.breaks, e.transactions.breaks);
  assert.deepEqual(out.summary.breaksByType, e.breaksByType);
  assert.equal(out.summary.batchesMatched, e.batches.matched);
  assert.equal(out.summary.batchesBroken, e.batches.broken);
  assert.deepEqual(out.results.filter((r) => r.scope === 'BATCH' && r.outcome === 'BREAK').map((r) => r.batchRef).sort(), [...e.batches.brokenIds].sort());
  // every ledger entry and settlement line is accounted for exactly once
  assert.equal(out.results.filter((r) => r.ledgerEntryId != null).length, ledger.length);
  assert.equal(out.results.filter((r) => r.settlementLineId != null).length, settlement.length);
  // a later as-of date turns pending items into missing-in-settlement breaks (status model over time)
  const later = reconcile({ ledger, settlement, batches: set.batches, config: { ...cfg, asOfDate: '2026-11-12' } });
  assert.equal(later.summary.pending, 0);
  assert.equal(later.summary.breaksByType.MISSING_IN_SETTLEMENT, e.breaksByType.MISSING_IN_SETTLEMENT + e.transactions.pending);
});

test('demo files committed in demo-data/ are exactly what the generator produces', () => {
  const dir = path.join(__dirname, '..', '..', 'demo-data');
  assert.equal(fs.readFileSync(path.join(dir, 'ledger-2026-11.csv'), 'utf8'), demo.ledgerCsv);
  assert.equal(fs.readFileSync(path.join(dir, 'nimbuspay-settlement-2026-11.csv'), 'utf8'), demo.settlementCsv);
  assert.equal(JSON.stringify(generateDemo().expected), JSON.stringify(demo.expected)); // deterministic
});
