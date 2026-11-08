'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, checkHeader } = require('../../src/modules/sources/csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('../../src/modules/sources/ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('../../src/modules/sources/settlement-parser');

// The downloadable templates are shown to users as "this is valid". Prove it with the same parsers the server uses.
// (public/ is browser ES modules while the package is CommonJS, so the pure-data module is imported from its source text.)
const loadTemplates = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'templates.js'), 'utf8'))}`);

test('the ledger template is accepted in full by the ledger parser', async () => {
  const { LEDGER_TEMPLATE, toCsvText } = await loadTemplates();
  assert.deepEqual(LEDGER_TEMPLATE.header, LEDGER_COLUMNS);
  const csv = parseCsv(toCsvText(LEDGER_TEMPLATE), { maxRows: 100 });
  checkHeader(csv.header, LEDGER_COLUMNS);
  const out = parseLedgerRows(csv.header, csv.records);
  assert.equal(out.rejectedRows, 0, JSON.stringify(out.errors));
  assert.equal(out.entries.length, LEDGER_TEMPLATE.rows.length);
});

test('the settlement template is accepted in full and its batch reconciles by construction', async () => {
  const { SETTLEMENT_TEMPLATE, toCsvText } = await loadTemplates();
  assert.deepEqual(SETTLEMENT_TEMPLATE.header, SETTLEMENT_COLUMNS);
  const csv = parseCsv(toCsvText(SETTLEMENT_TEMPLATE), { maxRows: 100 });
  checkHeader(csv.header, SETTLEMENT_COLUMNS);
  const out = parseSettlementRows(csv.header, csv.records);
  assert.equal(out.rejectedRows, 0, JSON.stringify(out.errors));
  assert.equal(out.lines.length, 2);
  assert.equal(out.batches.length, 1);
  const gross = out.lines.reduce((t, l) => t + l.amountPaise, 0);
  const fees = out.lines.reduce((t, l) => t + l.feePaise, 0);
  assert.equal(out.batches[0].declaredGrossPaise, gross);
  assert.equal(out.batches[0].declaredFeePaise, fees);
  assert.equal(out.batches[0].declaredPayoutPaise, gross - fees);
});
