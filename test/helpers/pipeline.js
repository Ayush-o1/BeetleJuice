'use strict';
// CSV text -> the real parsers -> the real engine, exactly as the server does it (minus the database).
const { parseCsv, checkHeader } = require('../../src/modules/sources/csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('../../src/modules/sources/ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('../../src/modules/sources/settlement-parser');
const { reconcile } = require('../../src/modules/engine');

const DEFAULT_CONFIG = { amountTolerancePaise: 0, feeRatePercent: '2.0000', feeTolerancePaise: 1, settlementWindowDays: 2, asOfDate: '2026-11-08' };

function parseFiles(ledgerCsv, settlementCsv) {
  const l = parseCsv(ledgerCsv, { maxRows: 500000 }); checkHeader(l.header, LEDGER_COLUMNS);
  const s = parseCsv(settlementCsv, { maxRows: 500000 }); checkHeader(s.header, SETTLEMENT_COLUMNS);
  const led = parseLedgerRows(l.header, l.records); const set = parseSettlementRows(s.header, s.records);
  const ledger = led.entries.map((x, i) => ({ id: i + 1, sourceId: x.ledgerId, reference: x.reference, amountPaise: x.amountPaise, businessDate: x.businessDate, rowNumber: x.rowNumber, direction: x.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  const settlement = set.lines.map((x, i) => ({ id: 1000000 + i, sourceId: x.lineId, reference: x.reference, amountPaise: x.amountPaise, feePaise: x.feePaise, batchRef: x.batchRef, settledOn: x.settledOn, rowNumber: x.rowNumber, direction: x.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  return { led, set, ledger, settlement, batches: set.batches };
}

function runPipeline(ledgerCsv, settlementCsv, config = DEFAULT_CONFIG) {
  const parsed = parseFiles(ledgerCsv, settlementCsv);
  const out = reconcile({ ledger: parsed.ledger, settlement: parsed.settlement, batches: parsed.batches, config });
  return { ...parsed, out, config };
}

module.exports = { parseFiles, runPipeline, DEFAULT_CONFIG };
