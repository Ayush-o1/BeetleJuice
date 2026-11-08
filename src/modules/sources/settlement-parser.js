'use strict';

const { RowChecker } = require('./row-fields');
const { excerpt } = require('./csv');

const SETTLEMENT_COLUMNS = [
  'record_type', 'batch_id', 'line_id', 'reference', 'txn_type', 'amount', 'fee', 'currency', 'settled_on',
  'batch_gross', 'batch_fee', 'batch_payout',
];
const BATCH_LIMIT = 100_000_000_000_000;
const TXN_ONLY = ['batch_gross', 'batch_fee', 'batch_payout'];
const BATCH_ONLY = ['line_id', 'reference', 'txn_type', 'amount', 'fee'];

/**
 * Processor settlement export. Two record kinds share one file:
 *   TXN   one settled transaction line; `amount` is SIGNED (sale +, refund -), `fee` is the
 *         non-negative fee the processor charged on that line.
 *   BATCH one payout summary per batch with the declared gross, fee and payout totals.
 * A line's `txn_type` must agree with the sign of its amount.
 */
function parseSettlementRows(header, records) {
  const lines = [];
  const batches = [];
  const errors = [];
  const seenLines = new Map();
  const seenBatches = new Map();

  for (const rec of records) {
    const rowErrors = [];
    if (rec.values.length !== header.length) {
      rowErrors.push({ field: null, code: 'FIELD_COUNT', message: `Expected ${header.length} fields but found ${rec.values.length}` });
    } else {
      const obj = Object.fromEntries(header.map((h, i) => [h, rec.values[i]]));
      const c = new RowChecker(obj);
      const recordType = c.oneOf('record_type', ['TXN', 'BATCH']);
      const batchRef = c.id('batch_id');
      const currency = c.currency();
      const settledOn = c.date('settled_on');

      if (recordType === 'TXN') {
        TXN_ONLY.forEach((f) => c.mustBeEmpty(f));
        const lineId = c.id('line_id');
        const reference = c.id('reference');
        const txnType = c.oneOf('txn_type', ['SALE', 'REFUND']);
        const amount = c.money('amount', { sign: txnType === 'SALE' ? 'positive' : txnType === 'REFUND' ? 'negative' : 'any' });
        const fee = c.money('fee', { sign: 'positive', allowZero: true });
        if (amount !== undefined && fee !== undefined && fee > Math.abs(amount)) {
          c.fail('fee', 'FEE_EXCEEDS_AMOUNT', 'fee must not exceed the transaction amount');
        }
        if (lineId && seenLines.has(lineId)) c.fail('line_id', 'DUPLICATE_ID', `line_id ${lineId} already appears on row ${seenLines.get(lineId)}`);
        if (c.ok) {
          seenLines.set(lineId, rec.rowNumber);
          lines.push({ rowNumber: rec.rowNumber, lineId, batchRef, reference: reference.toUpperCase(), txnType, amountPaise: amount, feePaise: fee, currency, settledOn });
        }
      } else if (recordType === 'BATCH') {
        BATCH_ONLY.forEach((f) => c.mustBeEmpty(f));
        const gross = c.money('batch_gross', { allowZero: true, max: BATCH_LIMIT });
        const fee = c.money('batch_fee', { sign: 'positive', allowZero: true, max: BATCH_LIMIT });
        const payout = c.money('batch_payout', { allowZero: true, max: BATCH_LIMIT });
        if (batchRef && seenBatches.has(batchRef)) c.fail('batch_id', 'DUPLICATE_ID', `batch_id ${batchRef} already has a summary on row ${seenBatches.get(batchRef)}`);
        if (c.ok) {
          seenBatches.set(batchRef, rec.rowNumber);
          batches.push({ rowNumber: rec.rowNumber, batchRef, settledOn, declaredGrossPaise: gross, declaredFeePaise: fee, declaredPayoutPaise: payout, currency });
        }
      }
      rowErrors.push(...c.errors);
    }
    for (const e of rowErrors) {
      errors.push({ rowNumber: rec.rowNumber, lineNumber: rec.lineNumber, rawExcerpt: excerpt(rec.values), ...e });
    }
  }
  return { lines, batches, errors, rejectedRows: new Set(errors.map((e) => e.rowNumber)).size };
}

module.exports = { SETTLEMENT_COLUMNS, parseSettlementRows };
