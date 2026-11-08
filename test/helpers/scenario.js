'use strict';

/**
 * A small hand-computed scenario used by the integration tests. Settings: 2% fee, 1 paisa fee
 * tolerance, 2-day settlement window, no amount tolerance; run as of 2026-11-08.
 *
 *   PAY-1001  5000.00 vs 5000.00, fee 100.00 ............ matched
 *   PAY-1002  1200.00 vs 1250.00 ......................... AMOUNT_MISMATCH (+50.00)
 *   PAY-1003   800.00 vs 800.00 twice .................... matched + DUPLICATE_SETTLEMENT
 *   PAY-1004  2500.00 recorded 2026-11-08, unsettled ..... PENDING (deadline 2026-11-10)
 *   PAY-1005   300.00 recorded 2026-11-02, unsettled ..... MISSING_IN_SETTLEMENT
 *   PAY-1006  1000.00, fee 30.00 (expected 20.00) ........ FEE_VARIANCE (+10.00)
 *   RF-2001    400.00 refund vs -400.00, fee 0 ........... matched
 *   PAY-9009   640.00 settled, not in ledger ............. MISSING_IN_LEDGER
 *   Batch B-1001 reconciles; batch B-1002 declares payout 620.00 but lines imply 627.20 -> BATCH_PAYOUT_MISMATCH
 *   One ledger row has amount 0.00 and is rejected at upload.
 */
const LEDGER_HEADER = 'ledger_id,reference,merchant,entry_type,amount,currency,recorded_at';
const SETTLEMENT_HEADER = 'record_type,batch_id,line_id,reference,txn_type,amount,fee,currency,settled_on,batch_gross,batch_fee,batch_payout';

const ledgerCsv = [
  LEDGER_HEADER,
  'L-1,PAY-1001,Kaveri Brew Co.,PAYMENT,5000.00,INR,2026-11-02T10:15:00+05:30',
  'L-2,PAY-1002,Namma Market,PAYMENT,1200.00,INR,2026-11-02T11:00:00+05:30',
  'L-3,PAY-1003,Deccan Outfitters,PAYMENT,800.00,INR,2026-11-02T12:30:00+05:30',
  'L-4,PAY-1004,Kaveri Brew Co.,PAYMENT,2500.00,INR,2026-11-08T09:00:00+05:30',
  'L-5,PAY-1005,Namma Market,PAYMENT,300.00,INR,2026-11-02T14:45:00+05:30',
  'L-6,PAY-1006,Deccan Outfitters,PAYMENT,1000.00,INR,2026-11-02T16:20:00+05:30',
  'L-7,RF-2001,Kaveri Brew Co.,REFUND,400.00,INR,2026-11-02T17:05:00+05:30',
  'L-8,PAY-1008,Namma Market,PAYMENT,0.00,INR,2026-11-02T17:30:00+05:30',
].join('\n') + '\n';

const settlementCsv = [
  SETTLEMENT_HEADER,
  'TXN,B-1001,S-1,PAY-1001,SALE,5000.00,100.00,INR,2026-11-03,,,',
  'TXN,B-1001,S-2,PAY-1002,SALE,1250.00,25.00,INR,2026-11-03,,,',
  'TXN,B-1001,S-3,PAY-1003,SALE,800.00,16.00,INR,2026-11-03,,,',
  'TXN,B-1001,S-4,PAY-1003,SALE,800.00,16.00,INR,2026-11-03,,,',
  'TXN,B-1001,S-5,PAY-1006,SALE,1000.00,30.00,INR,2026-11-03,,,',
  'TXN,B-1001,S-6,RF-2001,REFUND,-400.00,0.00,INR,2026-11-03,,,',
  'BATCH,B-1001,,,,,,INR,2026-11-03,8450.00,187.00,8263.00',
  'TXN,B-1002,S-7,PAY-9009,SALE,640.00,12.80,INR,2026-11-04,,,',
  'BATCH,B-1002,,,,,,INR,2026-11-04,640.00,12.80,620.00',
].join('\n') + '\n';

const EXPECTED = {
  asOfDate: '2026-11-08',
  ledgerRows: { total: 8, accepted: 7, rejected: 1 },
  settlementRows: { total: 9, accepted: 9, rejected: 0 },
  transactionOutcomes: { matched: 3, pending: 1, breaks: 5 },
  breaksByType: { AMOUNT_MISMATCH: 1, DUPLICATE_SETTLEMENT: 1, MISSING_IN_SETTLEMENT: 1, FEE_VARIANCE: 1, MISSING_IN_LEDGER: 1, BATCH_PAYOUT_MISMATCH: 1 },
  totalBreaks: 6,
};

/** Upload both files as `analyst` and queue + process a run. Returns ids. */
async function runScenario(app, analyst, { process = true, ledger = ledgerCsv, settlement = settlementCsv } = {}) {
  const l = await analyst.upload('ledger', 'ledger-nov.csv', ledger);
  const s = await analyst.upload('settlement', 'settlement-nov.csv', settlement);
  if (l.status !== 201 || s.status !== 201) throw new Error(`scenario upload failed: ${l.status} ${s.status} ${l.text} ${s.text}`);
  const r = await analyst.post('/api/runs', { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id });
  if (r.status !== 202) throw new Error(`run create failed: ${r.status} ${r.text}`);
  if (process) await app.worker().processNext();
  return { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id, runId: r.body.data.id };
}

module.exports = { ledgerCsv, settlementCsv, EXPECTED, runScenario, LEDGER_HEADER, SETTLEMENT_HEADER };
