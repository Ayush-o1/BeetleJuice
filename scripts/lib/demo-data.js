'use strict';

/**
 * Deterministic synthetic data for demos and tests. Everything here is fictional.
 * The generator injects a known number of each scenario and returns that ground truth, so tests
 * can check the reconciliation engine against what was *constructed*, not against its own output.
 *
 * Period: transactions recorded 1–8 Nov 2026; run as of 2026-11-08 with default settings
 * (2-day settlement window, 2% fee, 1 paisa fee tolerance, no amount tolerance).
 */
const { computeFeePaise, parsePercent } = require('../../src/lib/rate');
const { toRupeesString } = require('../../src/lib/money');
const { addDays } = require('../../src/lib/dates');

const MERCHANTS = ['Kaveri Brew Co.', 'Namma Market', 'Deccan Outfitters', 'Western Ledger Services', 'Malabar Spice Traders'];
const RATE = parsePercent('2.0000');
const AS_OF = '2026-11-08';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w) => String(n).padStart(w, '0');
const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function generateDemo(seed = 20261108) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];

  const ledger = [];      // {id, ref, merchant, type, paise, recordedAt, date}
  const lines = [];       // {id, ref, type, paise, fee, settledOn}
  let ledgerSeq = 0; let lineSeq = 0; let refSeq = 0;
  const day = (d) => `2026-11-${pad(d, 2)}`;

  const stamp = (d) => {
    // Mostly +05:30 timestamps; every 7th is expressed in UTC (may fall on the next IST day).
    const hour = int(9, 20); const minute = int(0, 59);
    if (int(1, 7) === 1) {
      const utcMs = Date.UTC(2026, 10, d, hour, minute) - 5.5 * 3600 * 1000;
      return `${new Date(utcMs).toISOString().slice(0, 19)}Z`;
    }
    return `2026-11-${pad(d, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(int(0, 59), 2)}+05:30`;
  };
  const addLedger = (ref, paise, d, over = {}) => {
    const row = { id: `LDG-${pad(++ledgerSeq, 6)}`, ref, merchant: over.merchant || pick(MERCHANTS), type: paise < 0 ? 'REFUND' : 'PAYMENT', paise, recordedAt: over.recordedAt || stamp(d), date: day(d) };
    ledger.push(row);
    return row;
  };
  const feeFor = (paise) => (paise > 0 ? computeFeePaise(paise, RATE) : 0);
  const addLine = (ref, paise, settledOn, over = {}) => {
    const row = { id: `NP-L-${pad(++lineSeq, 6)}`, ref, type: paise < 0 ? 'REFUND' : 'SALE', paise, fee: over.fee ?? feeFor(paise), settledOn };
    lines.push(row);
    return row;
  };
  const newRef = (prefix = 'PAY') => `${prefix}-2611-${pad(++refSeq, 5)}`;
  const randomPaise = () => int(15000, 2500000) + (rnd() < 0.5 ? 0 : int(0, 99) - 50);
  const settleDay = (d) => day(d + (rnd() < 0.8 ? 1 : 2));

  // A. clean matches (days 1–5 so every settlement lands by 7 Nov)
  for (let i = 0; i < 260; i++) {
    const d = int(1, 5); const ref = newRef(); const p = Math.abs(randomPaise()) + 100;
    addLedger(ref, p, d); addLine(ref, p, settleDay(d));
  }
  // A2. timezone boundaries: 23:58 IST stays on 3 Nov; 18:31 UTC is 00:01 IST on 4 Nov
  { const r1 = newRef(); addLedger(r1, 88800, 3, { recordedAt: '2026-11-03T23:58:00+05:30' }); addLine(r1, 88800, day(4));
    const r2 = newRef(); addLedger(r2, 99900, 4, { recordedAt: '2026-11-03T18:31:00Z' }); addLine(r2, 99900, day(5)); }
  // K. fee rounding boundaries: amounts whose 2% fee lands exactly on x.5 paise
  for (const p of [2525, 7525, 12525, 25, 375]) { const d = int(1, 5); const ref = newRef(); addLedger(ref, p, d); addLine(ref, p, settleDay(d)); }
  // B. refunds
  for (let i = 0; i < 12; i++) { const d = int(1, 5); const ref = newRef('RFD'); const p = -(int(20000, 600000)); addLedger(ref, p, d); addLine(ref, p, settleDay(d)); }
  // C. legitimate repeated references (identical pairs on both sides)
  for (let i = 0; i < 3; i++) { const d = int(1, 5); const ref = `PAY-REP-${pad(i + 1, 3)}`; const p = int(30000, 90000); for (let k = 0; k < 2; k++) { addLedger(ref, p, d); addLine(ref, p, settleDay(d)); } }
  // D. amount mismatches (settlement differs from ledger)
  const diffs = [1, -1, 5000, -2500, 10000, 150, -7500, 99];
  diffs.forEach((diff) => { const d = int(1, 5); const ref = newRef(); const p = int(80000, 400000); addLedger(ref, p, d); addLine(ref, p + diff, settleDay(d)); });
  // E. duplicate settlement lines
  for (let i = 0; i < 6; i++) { const d = int(1, 4); const ref = newRef(); const p = int(50000, 300000); addLedger(ref, p, d); addLine(ref, p, day(d + 1)); addLine(ref, p, day(d + 2)); }
  // F. fee variances
  for (let i = 0; i < 6; i++) { const d = int(1, 5); const ref = newRef(); const p = int(100000, 500000); addLedger(ref, p, d); addLine(ref, p, settleDay(d), { fee: feeFor(p) + int(500, 6000) }); }
  // G. settled but missing in ledger
  for (let i = 0; i < 5; i++) addLine(`PAY-ORPHAN-${pad(i + 1, 3)}`, int(40000, 350000), day(int(3, 7)));
  // H. pending (recorded 6–8 Nov, still inside their window on 8 Nov)
  for (let i = 0; i < 14; i++) addLedger(newRef(), Math.abs(randomPaise()) + 100, int(6, 8));
  // I. missing in settlement after the window closed (recorded 1–5 Nov)
  for (let i = 0; i < 7; i++) addLedger(newRef(), Math.abs(randomPaise()) + 100, int(1, 5));
  // J. ambiguous references: two ledger amounts, one settlement amount equal to neither
  for (let i = 0; i < 2; i++) { const d = int(2, 4); const ref = `PAY-AMB-${pad(i + 1, 3)}`; addLedger(ref, 120000 + i * 1000, d); addLedger(ref, 180000 + i * 1000, d); addLine(ref, 150000 + i * 1000, day(d + 1)); }

  // Batches: one per settlement date. Two are made to disagree with their lines.
  const dates = [...new Set(lines.map((l) => l.settledOn))].sort();
  const batchOf = (d) => `NP-${d.replace(/-/g, '')}`;
  const batchRows = dates.map((d) => {
    const inB = lines.filter((l) => l.settledOn === d);
    const gross = inB.reduce((t, l) => t + l.paise, 0); const fee = inB.reduce((t, l) => t + l.fee, 0);
    return { batch: batchOf(d), date: d, gross, fee, payout: gross - fee };
  });
  const brokenBatches = [batchRows[2].batch, batchRows[4].batch];
  batchRows[2].payout -= 720;      // payout short by ₹7.20
  batchRows[4].gross += 10000;     // declared gross ₹100 higher than the lines; payout follows the declared gross
  batchRows[4].payout += 10000;

  // ---- ledger CSV (with invalid rows appended at fixed positions) ----
  ledger.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  const ledgerLines = ['ledger_id,reference,merchant,entry_type,amount,currency,recorded_at'];
  for (const l of ledger) ledgerLines.push([l.id, l.ref, q(l.merchant), l.type, toRupeesString(Math.abs(l.paise)), 'INR', l.recordedAt].join(','));
  const badLedger = [
    'LDG-BAD-01,PAY-BAD-0001,Namma Market,PAYMENT,0.00,INR,2026-11-03T10:00:00+05:30',              // zero amount
    'LDG-BAD-02,PAY-BAD-0002,Kaveri Brew Co.,PAYMENT,125.50,USD,2026-11-03T10:05:00+05:30',         // wrong currency
    'LDG-BAD-03,PAY-BAD-0003,Deccan Outfitters,PAYMENT,99.999,INR,2026-11-03T10:10:00+05:30',       // 3 decimals
    'LDG-BAD-04,PAY-BAD-0004,Namma Market,PAYMENT,310.00,INR,2026-11-03 10:15:00',                  // no UTC offset
  ];
  ledgerLines.splice(40, 0, badLedger[0]); ledgerLines.splice(120, 0, badLedger[1]); ledgerLines.splice(200, 0, badLedger[2], badLedger[3]);

  // ---- settlement CSV ----
  lines.sort((a, b) => a.settledOn.localeCompare(b.settledOn) || a.id.localeCompare(b.id));
  const sLines = ['record_type,batch_id,line_id,reference,txn_type,amount,fee,currency,settled_on,batch_gross,batch_fee,batch_payout'];
  for (const d of dates) {
    for (const l of lines.filter((x) => x.settledOn === d)) sLines.push(['TXN', batchOf(d), l.id, l.ref, l.type, toRupeesString(l.paise), toRupeesString(l.fee), 'INR', d, '', '', ''].join(','));
    const b = batchRows.find((x) => x.date === d);
    sLines.push(['BATCH', b.batch, '', '', '', '', '', 'INR', d, toRupeesString(b.gross), toRupeesString(b.fee), toRupeesString(b.payout)].join(','));
  }
  const badSettlement = [
    `TXN,${batchOf(dates[0])},NP-BAD-01,PAY-BAD-1001,REFUND,250.00,0.00,INR,${dates[0]},,,`,               // refund must be negative
    `TXN,${batchOf(dates[0])},${lines[0].id},PAY-BAD-1002,SALE,250.00,5.00,INR,${dates[0]},,,`,       // repeats the first line's id; the later row is rejected
    `TXN,${batchOf(dates[0])},NP-BAD-03,PAY-BAD-1003,SALE,250.00,5.00,INR,2026-02-30,,,`,                  // impossible date
  ];
  sLines.splice(30, 0, badSettlement[0]); sLines.splice(90, 0, badSettlement[1], badSettlement[2]);

  const count = (arr, f) => arr.filter(f).length;
  return {
    ledgerCsv: `${ledgerLines.join('\n')}\n`,
    settlementCsv: `${sLines.join('\n')}\n`,
    expected: {
      asOfDate: AS_OF,
      ledgerRows: { total: ledger.length + badLedger.length, accepted: ledger.length, rejected: badLedger.length },
      settlementRows: { total: lines.length + batchRows.length + badSettlement.length, accepted: lines.length + batchRows.length, rejected: badSettlement.length },
      transactions: { matched: 260 + 2 + 5 + 12 + 6 + 6, pending: 14, breaks: 8 + 6 + 6 + 5 + 7 + 6 },
      breaksByType: { AMOUNT_MISMATCH: 8, DUPLICATE_SETTLEMENT: 6, FEE_VARIANCE: 6, MISSING_IN_LEDGER: 5, MISSING_IN_SETTLEMENT: 7, AMBIGUOUS_REFERENCE: 6, BATCH_PAYOUT_MISMATCH: 2 },
      batches: { total: batchRows.length, matched: batchRows.length - 2, broken: 2, brokenIds: brokenBatches },
      totalBreaks: 8 + 6 + 6 + 5 + 7 + 6 + 2,
      _count: count(ledger, () => true),
    },
  };
}

module.exports = { generateDemo, AS_OF, addDays };
