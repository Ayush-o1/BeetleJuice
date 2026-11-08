'use strict';

const { RowChecker } = require('./row-fields');
const { excerpt } = require('./csv');
const { businessDateOf } = require('../../lib/dates');

const LEDGER_COLUMNS = ['ledger_id', 'reference', 'merchant', 'entry_type', 'amount', 'currency', 'recorded_at'];

/**
 * Ledger export: amounts are positive magnitudes and `entry_type` carries the direction.
 * Normalised to signed paise (PAYMENT +, REFUND -) so both sources share one convention
 * inside the system. (The processor file uses signed amounts; see settlement-parser.js.)
 */
function parseLedgerRows(header, records) {
  const entries = [];
  const errors = [];
  const seenIds = new Map();

  for (const rec of records) {
    const rowErrors = [];
    if (rec.values.length !== header.length) {
      rowErrors.push({ field: null, code: 'FIELD_COUNT', message: `Expected ${header.length} fields but found ${rec.values.length}` });
    } else {
      const obj = Object.fromEntries(header.map((h, i) => [h, rec.values[i]]));
      const c = new RowChecker(obj);
      const ledgerId = c.id('ledger_id');
      const reference = c.id('reference');
      const merchant = c.text('merchant', 120);
      const entryType = c.oneOf('entry_type', ['PAYMENT', 'REFUND']);
      const magnitude = c.money('amount', { sign: 'positive' });
      const currency = c.currency();
      const recordedAt = c.instant('recorded_at');
      if (ledgerId && seenIds.has(ledgerId)) {
        c.fail('ledger_id', 'DUPLICATE_ID', `ledger_id ${ledgerId} already appears on row ${seenIds.get(ledgerId)}`);
      }
      if (c.ok) {
        seenIds.set(ledgerId, rec.rowNumber);
        entries.push({
          rowNumber: rec.rowNumber, ledgerId, reference: reference.toUpperCase(), merchant, entryType, currency,
          amountPaise: entryType === 'REFUND' ? -magnitude : magnitude,
          recordedAt: recordedAt.toISOString(), businessDate: businessDateOf(recordedAt),
        });
      }
      rowErrors.push(...c.errors);
    }
    for (const e of rowErrors) {
      errors.push({ rowNumber: rec.rowNumber, lineNumber: rec.lineNumber, rawExcerpt: excerpt(rec.values), ...e });
    }
  }
  return { entries, errors, rejectedRows: new Set(errors.map((e) => e.rowNumber)).size };
}

module.exports = { LEDGER_COLUMNS, parseLedgerRows };
