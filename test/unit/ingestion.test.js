'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeUtf8, parseCsv, checkHeader } = require('../../src/modules/sources/csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('../../src/modules/sources/ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('../../src/modules/sources/settlement-parser');

const LH = 'ledger_id,reference,merchant,entry_type,amount,currency,recorded_at';
const SH = SETTLEMENT_COLUMNS.join(',');
const ledger = (rows) => { const { header, records } = parseCsv([LH, ...rows].join('\n'), { maxRows: 100 }); checkHeader(header, LEDGER_COLUMNS); return parseLedgerRows(header, records); };
const settle = (rows) => { const { header, records } = parseCsv([SH, ...rows].join('\n'), { maxRows: 100 }); checkHeader(header, SETTLEMENT_COLUMNS); return parseSettlementRows(header, records); };
const codes = (r) => r.errors.map((e) => e.code);

test('ledger: valid rows normalise to signed paise and IST business date', () => {
  const r = ledger([
    'L-1,pay-001,Kaveri Brew Co.,PAYMENT,1250.50,INR,2026-11-06T23:45:00+05:30',
    'L-2,PAY-002,Namma Market,refund,300,inr,2026-11-06T18:45:00Z',
  ]);
  assert.equal(r.errors.length, 0);
  assert.equal(r.entries[0].amountPaise, 125050);
  assert.equal(r.entries[0].reference, 'PAY-001');
  assert.equal(r.entries[0].businessDate, '2026-11-06');
  assert.equal(r.entries[1].amountPaise, -30000);
  assert.equal(r.entries[1].businessDate, '2026-11-07'); // 00:15 IST
});

test('ledger: every invalid row is reported with a reason, none silently skipped', () => {
  const r = ledger([
    'L-1,PAY-1,Shop,PAYMENT,0,INR,2026-11-06T10:00:00+05:30',            // zero
    'L-2,PAY-2,Shop,PAYMENT,-5.00,INR,2026-11-06T10:00:00+05:30',        // negative payment
    'L-3,PAY-3,Shop,PAYMENT,10.005,INR,2026-11-06T10:00:00+05:30',       // 3 decimals
    'L-4,PAY-4,Shop,PAYMENT,10,USD,2026-11-06T10:00:00+05:30',           // currency
    'L-5,PAY-5,Shop,PAYMENT,10,INR,2026-11-06 10:00:00',                 // no offset
    'L-6,=PAY6,Shop,PAYMENT,10,INR,2026-11-06T10:00:00+05:30',           // formula-like ref
    'L-7,PAY-7,Shop,SALE,10,INR,2026-11-06T10:00:00+05:30',              // bad type
    'L-8,PAY-8,Shop,PAYMENT,1,00,000.00,INR,2026-11-06T10:00:00+05:30',  // wrong field count (comma)
    'L-9,PAY-9,Shop,PAYMENT,99999999.99,INR,2026-11-06T10:00:00+05:30',  // > ₹1 crore
    'L-10,PAY-10,Shop,PAYMENT,10,INR,2026-02-30T10:00:00+05:30',         // impossible date
    'L-11,PAY-11,Shop,PAYMENT,10,INR,2026-11-06T10:00:00+05:30',         // valid
  ]);
  assert.equal(r.entries.length, 1);
  assert.equal(r.rejectedRows, 10);
  assert.deepEqual(codes(r), ['AMOUNT_ZERO', 'AMOUNT_SIGN', 'AMOUNT_PRECISION', 'CURRENCY', 'DATETIME_FORMAT', 'ID_FORMAT', 'ENUM', 'FIELD_COUNT', 'AMOUNT_RANGE', 'DATETIME_FORMAT']);
  assert.ok(r.errors.every((e) => e.rowNumber >= 1 && e.message && e.lineNumber >= 2));
});

test('ledger: duplicate ledger_id inside a file rejects the later row; repeated references are legitimate', () => {
  const r = ledger([
    'L-1,PAY-1,Shop,PAYMENT,10,INR,2026-11-06T10:00:00+05:30',
    'L-1,PAY-2,Shop,PAYMENT,10,INR,2026-11-06T10:00:00+05:30',
    'L-3,PAY-1,Shop,PAYMENT,10,INR,2026-11-06T10:00:00+05:30',
  ]);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(codes(r), ['DUPLICATE_ID']);
  assert.equal(r.errors[0].rowNumber, 2);
});

test('settlement: TXN and BATCH rows parse; refunds are negative; sign must agree with type', () => {
  const r = settle([
    'TXN,B-1,S-1,PAY-1,SALE,1000.00,20.00,INR,2026-11-07,,,',
    'TXN,B-1,S-2,PAY-2,REFUND,-250.00,0.00,INR,2026-11-07,,,',
    'BATCH,B-1,,,,,,INR,2026-11-07,750.00,20.00,730.00',
    'TXN,B-1,S-3,PAY-3,REFUND,250.00,0.00,INR,2026-11-07,,,',          // refund with positive sign
    'TXN,B-1,S-4,PAY-4,SALE,-250.00,0.00,INR,2026-11-07,,,',           // sale with negative sign
    'TXN,B-1,S-5,PAY-5,SALE,100.00,200.00,INR,2026-11-07,,,',          // fee > amount
    'TXN,B-1,S-1,PAY-6,SALE,100.00,2.00,INR,2026-11-07,,,',            // duplicate line_id
    'BATCH,B-1,,,,,,INR,2026-11-07,1.00,0.00,1.00',                    // duplicate batch summary
    'TXN,B-2,S-7,PAY-7,SALE,100.00,2.00,INR,2026-11-07,100.00,,',      // batch totals on TXN row
    'BATCH,B-2,S-8,,,,,INR,2026-11-07,1.00,0.00,1.00',                 // line fields on BATCH row
    'FOO,B-2,,,,,,INR,2026-11-07,,,',
  ]);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[1].amountPaise, -25000);
  assert.equal(r.batches.length, 1);
  assert.equal(r.batches[0].declaredPayoutPaise, 73000);
  assert.deepEqual(codes(r), ['AMOUNT_SIGN', 'AMOUNT_SIGN', 'FEE_EXCEEDS_AMOUNT', 'DUPLICATE_ID', 'DUPLICATE_ID', 'NOT_ALLOWED', 'NOT_ALLOWED', 'ENUM']);
});

test('file-level problems are rejected with specific codes', () => {
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  assert.equal(code(() => parseCsv('', { maxRows: 10 })), 'CSV_EMPTY');
  assert.equal(code(() => parseCsv(LH + '\n', { maxRows: 10 })), 'CSV_EMPTY');
  assert.equal(code(() => parseCsv(`${LH}\na,"b\n`, { maxRows: 10 })), 'CSV_MALFORMED');
  assert.equal(code(() => parseCsv(`${LH}\n1\n2\n3\n`, { maxRows: 2 })), 'CSV_TOO_MANY_ROWS');
  assert.equal(code(() => decodeUtf8(Buffer.from([0x61, 0x00, 0x62]))), 'CSV_NOT_TEXT');
  assert.equal(code(() => decodeUtf8(Buffer.from([0xff, 0xfe, 0x41]))), 'CSV_ENCODING');
  const wrong = parseCsv(`${SH}\n`.concat('TXN,B,S,P,SALE,1,0,INR,2026-11-07,,,'), { maxRows: 10 });
  assert.equal(code(() => checkHeader(wrong.header, LEDGER_COLUMNS)), 'CSV_HEADER_INVALID');
});

test('header matching is case-insensitive, tolerates a BOM, and rejects duplicates', () => {
  const p = parseCsv(`﻿${LH.toUpperCase()}\nL-1,P-1,S,PAYMENT,1,INR,2026-11-06T10:00:00Z`, { maxRows: 10 });
  checkHeader(p.header, LEDGER_COLUMNS);
  assert.throws(() => checkHeader([...LEDGER_COLUMNS, 'amount'], LEDGER_COLUMNS), /duplicated: amount/);
});
