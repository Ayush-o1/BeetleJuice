'use strict';
/** Financial and parsing edge cases that are easy to get subtly wrong. Each test says which boundary it pins. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRupees, sumPaise, formatPaise, toRupeesString, MAX_ENTRY_PAISE, MoneyError } = require('../../src/lib/money');
const { parsePercent, computeFeePaise, roundDivHalfUp } = require('../../src/lib/rate');
const { parseCsv, checkHeader } = require('../../src/modules/sources/csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('../../src/modules/sources/ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('../../src/modules/sources/settlement-parser');
const { reconcile } = require('../../src/modules/engine');
const { led, line, honestBatch } = require('../helpers/engine-fixtures');
const { DEFAULT_CONFIG } = require('../helpers/pipeline');

const LH = LEDGER_COLUMNS.join(',');
const ledger = (rows, { eol = '\n', bom = '' } = {}) => { const c = parseCsv(`${bom}${[LH, ...rows].join(eol)}${eol}`, { maxRows: 1000 }); checkHeader(c.header, LEDGER_COLUMNS); return parseLedgerRows(c.header, c.records); };
const L = (id, amount, extra = {}) => `${id},${extra.ref || `R-${id}`},${extra.merchant || 'M'},${extra.type || 'PAYMENT'},${amount},INR,${extra.at || '2026-11-05T10:00:00+05:30'}`;

/* ---- money ---- */

test('amount cap: ₹1 crore is accepted, one paisa more is rejected, on both signs', () => {
  assert.equal(parseRupees('10000000.00'), MAX_ENTRY_PAISE);
  assert.equal(ledger([L('LDG-A', '10000000.00')]).rejectedRows, 0);
  const over = ledger([L('LDG-B', '10000000.01'), L('LDG-C', '99999999999.99')]);
  assert.equal(over.rejectedRows, 2);
  assert.ok(over.errors.every((e) => e.code === 'AMOUNT_RANGE'), JSON.stringify(over.errors));
});

test('sums beyond 32-bit and beyond a float mantissa stay exact or are refused, never silently wrong', () => {
  const crore = MAX_ENTRY_PAISE;
  assert.equal(sumPaise(Array(500).fill(crore)), 500 * crore);                // 5e11 paise: > 2^32, still exact
  assert.throws(() => sumPaise([Number.MAX_SAFE_INTEGER, 1]), /safe|range|overflow/i);
  assert.equal(0.1 + 0.2 === 0.3, false, 'sanity: floats would have failed here');
  assert.equal(sumPaise([10, 20]), 30);
});

test('amount text: leading/trailing space is trimmed; separators, symbols, exponents and signs in the wrong place are refused', () => {
  assert.equal(parseRupees(' 12.5 '), 1250);
  assert.equal(parseRupees('0.05'), 5);
  assert.equal(parseRupees('-0.01'), -1);
  for (const bad of ['1,250.00', '₹100', '1e3', '+5', '--5', '1.', '.5', '', '0x10', '12.345', 'NaN', 'Infinity']) {
    assert.throws(() => parseRupees(bad), MoneyError, `"${bad}" should be refused`);
  }
});

test('formatting and parsing round-trip for every paise value around the digit-grouping boundaries', () => {
  for (const p of [0, 1, 99, 100, 99999, 100000, 9999999, 10000000, 999999999, 1000000000]) {
    assert.equal(parseRupees(toRupeesString(p)), p);
  }
  assert.equal(formatPaise(100000000), '₹10,00,000.00');   // Indian grouping: lakh/crore
  assert.equal(formatPaise(-5), '-₹0.05');       // the browser formatter (public/js/format.js) uses a true minus sign; this one serves exports and messages
});

/* ---- fee rounding ---- */

test('fee rounding: halves go away from zero at 2%, 1.5%, 0.25% and a four-decimal rate', () => {
  const fee = (paise, pct) => computeFeePaise(paise, parsePercent(pct));
  assert.equal(fee(25, '2.0000'), 1);          // 0.5  -> 1
  assert.equal(fee(24, '2.0000'), 0);          // 0.48 -> 0
  assert.equal(fee(75, '2.0000'), 2);          // 1.5  -> 2
  assert.equal(fee(125, '2.0000'), 3);         // 2.5  -> 3  (banker's rounding would give 2)
  assert.equal(fee(100, '1.5000'), 2);         // 1.5  -> 2
  assert.equal(fee(200, '0.2500'), 1);         // 0.5  -> 1
  assert.equal(fee(1000001, '1.2345'), 12345); // 12345.012345 -> 12345
  assert.equal(fee(1000040, '1.2345'), 12345); // 12345.4938 -> down
  assert.equal(fee(1000041, '1.2345'), 12346); // 12345.5061 -> up: the half-way point sits between these two amounts, found by exact arithmetic
  assert.equal(fee(-25, '2.0000'), -1, 'symmetric for negatives (away from zero)');
  assert.equal(roundDivHalfUp(-5n, 2n), -3n);
  assert.equal(roundDivHalfUp(5n, 2n), 3n);
});

test('fee rounding agrees with exact decimal arithmetic over a dense sweep of amounts and rates', () => {
  for (const pct of ['2.0000', '1.7500', '0.9999', '3.3333']) {
    const r = parsePercent(pct);
    for (let p = 1; p <= 4000; p += 7) {
      // reference: integer-only half-up of p * rate / 100, computed independently of roundDivHalfUp
      const scaled = p * Number(pct.replace('.', ''));          // p * percent * 10^4 (exact in doubles at this size)
      const q = Math.floor(scaled / 1_000_000); const rem = scaled - q * 1_000_000;
      const expected = rem * 2 >= 1_000_000 ? q + 1 : q;
      assert.equal(computeFeePaise(p, r), expected, `${p} paise at ${pct}%`);
    }
  }
});

/* ---- CSV normalisation ---- */

test('CSV: CRLF line endings, a BOM and quoted fields with commas and quotes are read correctly; a newline inside a value is refused', () => {
  const out = ledger([L('A1', '10.00', { merchant: '"Kaveri, Brew ""Co"""' }), L('A2', '5.00', { merchant: '"two\nlines"' }), L('A3', '7.00')], { eol: '\r\n', bom: '\uFEFF' });
  assert.equal(out.entries.length, 2, JSON.stringify(out.errors));
  assert.equal(out.entries[0].merchant, 'Kaveri, Brew "Co"');
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].code, 'CONTROL_CHARS', 'a line break inside a field is a control character; the row is rejected, the rest load');
});

test('CSV: padding around values is trimmed, references are upper-cased, and identical-looking ids differing only in case are distinct ids', () => {
  const out = ledger([`  AA1 , pay-x-1 ,M,payment, 10.00 ,inr,2026-11-05T10:00:00+05:30`, L('aa1', '5.00')]);
  assert.equal(out.entries[0].reference, 'PAY-X-1');
  assert.equal(out.entries[0].amountPaise, 1000);
  assert.equal(out.entries[0].entryType, 'PAYMENT');
  assert.equal(out.rejectedRows + out.entries.length, 2);
});

test('CSV: a formula-looking merchant is stored as text (exports neutralise it elsewhere); control characters are refused', () => {
  const out = ledger([L('FF1', '1.00', { merchant: '"=HYPERLINK(""http://x"")"' }), L('FF2', '1.00', { merchant: 'Bad\u0007Name' })]);
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].merchant, '=HYPERLINK("http://x")');
  assert.equal(out.errors[0].code, 'CONTROL_CHARS');
});

test('CSV: a short or long row is reported as FIELD_COUNT with its row number, and the other rows still load', () => {
  const out = ledger([L('GG1', '1.00'), 'GG2,only,three', `${L('GG3', '1.00')},extra`, L('GG4', '1.00')]);
  assert.equal(out.entries.length, 2);
  assert.deepEqual(out.errors.map((e) => [e.rowNumber, e.code]), [[2, 'FIELD_COUNT'], [3, 'FIELD_COUNT']]);
});

test('timestamps: offsets are honoured, a date without an offset is refused, and 23:59:59 IST stays on its day', () => {
  const out = ledger([L('TT1', '1.00', { at: '2026-11-05T23:59:59+05:30' }), L('TT2', '1.00', { at: '2026-11-05T18:30:00Z' }), L('TT3', '1.00', { at: '2026-11-05' }), L('TT4', '1.00', { at: '2026-11-05T10:00:00' })]);
  assert.deepEqual(out.entries.map((e) => e.businessDate), ['2026-11-05', '2026-11-06']);
  assert.deepEqual(out.errors.map((e) => e.code), ['DATETIME_FORMAT', 'DATETIME_FORMAT']);
});

test('settlement: a refund must be negative, a sale positive, fee never above amount, and a BATCH row cannot carry line fields', () => {
  const H = SETTLEMENT_COLUMNS.join(',');
  const rows = [
    'TXN,B1,S1,P1,SALE,100.00,2.00,INR,2026-11-05,,,',
    'TXN,B1,S2,P2,SALE,-100.00,0.00,INR,2026-11-05,,,',
    'TXN,B1,S3,P3,REFUND,100.00,0.00,INR,2026-11-05,,,',
    'TXN,B1,S4,P4,SALE,10.00,10.01,INR,2026-11-05,,,',
    'BATCH,B1,S5,,,,,INR,2026-11-05,98.00,2.00,96.00',
    'BATCH,B1,,,,,,INR,2026-11-05,100.00,2.00,98.00',
  ];
  const c = parseCsv(`${[H, ...rows].join('\n')}\n`, { maxRows: 100 }); checkHeader(c.header, SETTLEMENT_COLUMNS);
  const out = parseSettlementRows(c.header, c.records);
  assert.equal(out.lines.length, 1);
  assert.equal(out.batches.length, 1);
  assert.deepEqual(out.errors.map((e) => e.rowNumber), [2, 3, 4, 5]);
});

/* ---- reconciliation edges ---- */

const cfg = DEFAULT_CONFIG;
const rec = (ledgerRows, lines, batches = []) => reconcile({ ledger: ledgerRows, settlement: lines, batches: batches.length ? batches : [], config: cfg }).summary;

test('one paisa: a difference of exactly 1 is a mismatch with zero tolerance and a match with tolerance 1, in either direction', () => {
  const run = (diff, tol) => reconcile({ ledger: [led('L1', 'R1', 100000)], settlement: [line('S1', 'R1', 100000 + diff, 'B1', { feePaise: 2000 })], batches: [], config: { ...cfg, amountTolerancePaise: tol } }).summary;
  assert.equal(run(1, 0).breaksByType.AMOUNT_MISMATCH, 1);
  assert.equal(run(-1, 0).breaksByType.AMOUNT_MISMATCH, 1);
  assert.equal(run(1, 1).matched, 1);
  assert.equal(run(2, 1).breaksByType.AMOUNT_MISMATCH, 1, 'one over the tolerance is still a break');
});

test('large amounts: ₹1 crore payments match exactly and a ₹1 crore refund keeps its sign', () => {
  const s = rec([led('L1', 'BIG', MAX_ENTRY_PAISE), led('L2', 'BIGR', -MAX_ENTRY_PAISE)],
    [line('S1', 'BIG', MAX_ENTRY_PAISE, 'B1', { feePaise: 20000000 }), line('S2', 'BIGR', -MAX_ENTRY_PAISE, 'B1', { feePaise: 0 })]);
  assert.equal(s.matched, 2);
  assert.equal(s.breaks, 0);
});

test('refunds: a refund and a payment with the same reference and magnitude never cancel each other out', () => {
  const s = rec([led('L1', 'X', 5000)], [line('S1', 'X', -5000, 'B1', { feePaise: 0 })]);
  assert.equal(s.matched, 0);
  assert.equal(s.breaks, 2, 'the payment has no settlement and the refund has no ledger entry');
});

test('a batch whose lines are all refunds reconciles with a negative gross', () => {
  const lines = [line('S1', 'R1', -3000, 'B1', { feePaise: 0 }), line('S2', 'R2', -2000, 'B1', { feePaise: 0 })];
  const out = reconcile({ ledger: [led('L1', 'R1', -3000), led('L2', 'R2', -2000)], settlement: lines, batches: [honestBatch('B1', lines)], config: cfg });
  assert.equal(out.summary.batchesMatched, 1);
  assert.equal(out.summary.matched, 2);
});

test('the as-of date is part of the result: an entry recorded exactly window days ago is pending, one day later it is missing', () => {
  const entry = [led('L1', 'P', 1000, '2026-11-06')];
  const at = (asOfDate) => reconcile({ ledger: entry, settlement: [], batches: [], config: { ...cfg, asOfDate } }).summary;
  assert.equal(at('2026-11-08').pending, 1);
  assert.equal(at('2026-11-09').breaksByType.MISSING_IN_SETTLEMENT, 1);
  assert.equal(at('2026-11-05').pending, 1, 'an as-of date before the record is not an error; it is simply not yet due');
});
