'use strict';

/**
 * Deterministic scenario library for BeetleJuice (all data is fictional).
 *
 * Every scenario is a small recipe over a builder. The builder produces the two CSV files AND the expected
 * reconciliation outcome. The expectation is counted at the moment each situation is injected ("this item is a
 * clean match", "this one is a fee variance"), never by running the engine, so tests can compare the engine
 * against ground truth that did not come from the engine.
 *
 * Reproducibility: a scenario is fully determined by (name, size, seed). Output is byte-identical across runs
 * and machines (no clock, no Math.random).
 *
 * All scenarios assume the default settings (2% fee, 1 paisa fee tolerance, no amount tolerance, 2-day
 * settlement window) and are judged as of ASOF. See docs/data-scenarios.md.
 */
const { computeFeePaise, parsePercent } = require('../../src/lib/rate');
const { toRupeesString } = require('../../src/lib/money');
const { addDays } = require('../../src/lib/dates');

const ASOF = '2026-11-08';
const WINDOW_DAYS = 2;
const RATE = parsePercent('2.0000');
const MERCHANTS = ['Kaveri Brew Co.', 'Namma Market', 'Deccan Outfitters', 'Western Ledger Services', 'Malabar Spice Traders', 'Konkan Cycle Works', 'Hampi Handloom House', 'Nilgiri Tea Estates'];
const SIZES = Object.freeze({ small: 10, normal: 150, large: 1500, xl: 15000 });
const BREAK_KEYS = ['AMOUNT_MISMATCH', 'DUPLICATE_SETTLEMENT', 'MISSING_IN_LEDGER', 'MISSING_IN_SETTLEMENT', 'BATCH_PAYOUT_MISMATCH', 'FEE_VARIANCE', 'AMBIGUOUS_REFERENCE'];

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
const pct = (n, p, min = 1) => Math.max(min, Math.round(n * p));

function createBuilder({ seed, scenario, size }) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];

  const ledger = []; const lines = [];
  const exp = { matched: 0, pending: 0, breaks: Object.fromEntries(BREAK_KEYS.map((k) => [k, 0])) };
  const planted = { ledger: [], settlement: [] };       // invalid rows appended after the valid ones
  const rejectedCodes = { ledger: new Set(), settlement: new Set() };
  let ledgerSeq = 0; let lineSeq = 0; const refSeq = {};

  const newRef = (prefix = 'PAY') => { refSeq[prefix] = (refSeq[prefix] || 0) + 1; return `${prefix}-2611-${pad(refSeq[prefix], 6)}`; };
  const dateAgo = (days) => addDays(ASOF, -days);
  const randomPaise = () => int(15000, 2500000) + (rnd() < 0.5 ? 0 : int(0, 99) - 50);   // ₹150–₹25,000, often with odd paise
  const feeFor = (paise) => (paise > 0 ? computeFeePaise(paise, RATE) : 0);

  // IST timestamp on `date`; roughly 1 in 7 is written in UTC to exercise offset handling (same IST calendar date).
  const stamp = (date) => {
    const hour = int(9, 20); const minute = int(0, 59); const second = int(0, 59);
    if (int(1, 7) === 1) {
      const [y, m, d] = date.split('-').map(Number);
      const utcMs = Date.UTC(y, m - 1, d, hour, minute, second) - 5.5 * 3600 * 1000;
      return `${new Date(utcMs).toISOString().slice(0, 19)}Z`;
    }
    return `${date}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}+05:30`;
  };
  const addLedger = (ref, paise, date, over = {}) => {
    const row = { id: `LDG-${pad(++ledgerSeq, 6)}`, ref, merchant: over.merchant || pick(MERCHANTS), paise, recordedAt: over.recordedAt || stamp(date), date };
    ledger.push(row); return row;
  };
  const addLine = (ref, paise, settledOn, over = {}) => {
    const row = { id: `NP-L-${pad(++lineSeq, 6)}`, ref, paise, fee: over.fee ?? feeFor(paise), settledOn };
    lines.push(row); return row;
  };
  // settlement lands 1–2 days after recording (or `lag` days), never after ASOF
  const settleDate = (recorded, lag) => { const d = addDays(recorded, lag ?? (rnd() < 0.8 ? 1 : 2)); return d > ASOF ? ASOF : d; };

  const api = {
    int, pick, rnd,
    /** Clean pairs. recorded 3–7 days before ASOF so the settlement always lands before it. */
    matched(n, { refunds = 0, lagMin = 1, lagMax = 2, minAge = 3 } = {}) {
      for (let i = 0; i < n; i++) {
        const refund = i < refunds;
        const date = dateAgo(int(minAge, Math.max(minAge, 7)));
        const paise = (refund ? -1 : 1) * (Math.abs(randomPaise()) + 100);
        const ref = newRef(refund ? 'RFD' : 'PAY');
        addLedger(ref, paise, date); addLine(ref, paise, settleDate(date, int(lagMin, lagMax)));
        exp.matched += 1;
      }
    },
    /** Payments recorded on an IST day boundary (23:58 IST and 00:01 IST expressed in UTC): still match. */
    timezoneEdges() {
      const d1 = dateAgo(5); const r1 = newRef(); addLedger(r1, 88800, d1, { recordedAt: `${d1}T23:58:00+05:30` }); addLine(r1, 88800, addDays(d1, 1));
      const d2 = dateAgo(4); const r2 = newRef();
      addLedger(r2, 99900, d2, { recordedAt: `${addDays(d2, -1)}T18:31:00Z` }); addLine(r2, 99900, addDays(d2, 1));   // 00:01 IST on d2
      exp.matched += 2;
    },
    /** Amounts whose 2% fee lands exactly on a half paisa; fee rounds half-up and still matches. */
    feeRoundingBoundaries() {
      for (const p of [2525, 7525, 12525, 25, 375]) { const d = dateAgo(int(3, 6)); const ref = newRef(); addLedger(ref, p, d); addLine(ref, p, settleDate(d)); exp.matched += 1; }
    },
    /** A reference that legitimately appears twice on both sides with identical amounts: two matched pairs. */
    legitimateRepeats(n) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(3, 6)); const ref = `PAY-REP-${pad(i + 1, 4)}`; const p = int(30000, 90000);
        for (let k = 0; k < 2; k++) { addLedger(ref, p, d); addLine(ref, p, settleDate(d)); exp.matched += 1; }
      }
    },
    amountMismatches(n, diffs = [1, -1, 5000, -2500, 10000, 150, -7500, 99]) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(3, 7)); const ref = newRef(); const p = int(80000, 400000);
        addLedger(ref, p, d); addLine(ref, p + diffs[i % diffs.length], settleDate(d));
        exp.breaks.AMOUNT_MISMATCH += 1;
      }
    },
    /** Refund settled for a different amount than the ledger recorded (both negative on the settlement side). */
    refundMismatches(n, diffs = [-100, 250, -1, 3000]) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(3, 7)); const ref = newRef('RFD'); const p = int(20000, 300000);
        addLedger(ref, -p, d); addLine(ref, -(p + diffs[i % diffs.length]), settleDate(d), { fee: 0 });
        exp.breaks.AMOUNT_MISMATCH += 1;
      }
    },
    /** Refund the processor paid out that the ledger never recorded. */
    orphanRefunds(n) {
      for (let i = 0; i < n; i++) { addLine(`RFD-ORPHAN-${pad(i + 1, 4)}`, -int(20000, 200000), dateAgo(int(1, 4)), { fee: 0 }); exp.breaks.MISSING_IN_LEDGER += 1; }
    },
    /** Processor settled the same payment twice: one match plus one DUPLICATE_SETTLEMENT break. */
    duplicateSettlements(n) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(4, 7)); const ref = newRef(); const p = int(50000, 300000);
        addLedger(ref, p, d); addLine(ref, p, addDays(d, 1)); addLine(ref, p, addDays(d, 2));
        exp.matched += 1; exp.breaks.DUPLICATE_SETTLEMENT += 1;
      }
    },
    /** `over` extra paise charged (≥ 2 over the 1 paisa tolerance). Negative = undercharged. */
    feeVariances(n, overs) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(3, 7)); const ref = newRef(); const p = int(100000, 500000); const over = overs ? overs[i % overs.length] : int(500, 6000);
        addLedger(ref, p, d); addLine(ref, p, settleDate(d), { fee: feeFor(p) + over });
        exp.breaks.FEE_VARIANCE += 1;
      }
    },
    /** Fee off by exactly the tolerance (±1 paisa): NOT reported, matches. */
    feeWithinTolerance(n) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(3, 7)); const ref = newRef(); const p = int(100000, 500000);
        addLedger(ref, p, d); addLine(ref, p, settleDate(d), { fee: feeFor(p) + (i % 2 === 0 ? 1 : -1) });
        exp.matched += 1;
      }
    },
    missingInLedger(n) {
      for (let i = 0; i < n; i++) { addLine(`PAY-ORPHAN-${pad(i + 1, 4)}`, int(40000, 350000), dateAgo(int(1, 5))); exp.breaks.MISSING_IN_LEDGER += 1; }
    },
    /** Never settled and past the window: MISSING_IN_SETTLEMENT. */
    missingInSettlement(n) {
      for (let i = 0; i < n; i++) { addLedger(newRef(), Math.abs(randomPaise()) + 100, dateAgo(int(WINDOW_DAYS + 1, 7))); exp.breaks.MISSING_IN_SETTLEMENT += 1; }
    },
    /** Unsettled but still inside the window on ASOF: PENDING, not a break. */
    pending(n) {
      for (let i = 0; i < n; i++) { addLedger(newRef(), Math.abs(randomPaise()) + 100, dateAgo(int(0, WINDOW_DAYS))); exp.pending += 1; }
    },
    /** Unsettled entries at an exact age, so window edges are covered precisely. */
    unsettledAtAge(age, n) {
      for (let i = 0; i < n; i++) {
        addLedger(newRef(), Math.abs(randomPaise()) + 100, dateAgo(age));
        if (age <= WINDOW_DAYS) exp.pending += 1; else exp.breaks.MISSING_IN_SETTLEMENT += 1;
      }
    },
    /** Two ledger amounts, one settlement amount equal to neither: three AMBIGUOUS_REFERENCE breaks per reference. */
    ambiguous(n) {
      for (let i = 0; i < n; i++) {
        const d = dateAgo(int(4, 6)); const ref = `PAY-AMB-${pad(i + 1, 4)}`;
        addLedger(ref, 120000 + i * 1000, d); addLedger(ref, 180000 + i * 1000, d); addLine(ref, 150000 + i * 1000, addDays(d, 1));
        exp.breaks.AMBIGUOUS_REFERENCE += 3;
      }
    },
    /** Invalid rows appended after the valid ones; each class is rejected with a known code. */
    invalidRows({ ledger: nl = 0, settlement: ns = 0 }) {
      const lk = [
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},Namma Market,PAYMENT,0.00,INR,${dateAgo(3)}T10:00:00+05:30`, code: 'AMOUNT_ZERO' }),
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},Kaveri Brew Co.,PAYMENT,125.50,USD,${dateAgo(3)}T10:05:00+05:30`, code: 'CURRENCY' }),
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},Deccan Outfitters,PAYMENT,99.999,INR,${dateAgo(3)}T10:10:00+05:30`, code: 'AMOUNT_PRECISION' }),
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},Namma Market,PAYMENT,310.00,INR,${dateAgo(3)} 10:15:00`, code: 'DATETIME_FORMAT' }),
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},,Namma Market,PAYMENT,310.00,INR,${dateAgo(3)}T10:15:00+05:30`, code: 'REQUIRED' }),
        (i) => ({ row: `LDG-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},Namma Market,CHARGEBACK,310.00,INR,${dateAgo(3)}T10:15:00+05:30`, code: 'ENUM' }),
      ];
      for (let i = 0; i < nl; i++) { const x = lk[i % lk.length](i + 1); planted.ledger.push(x.row); rejectedCodes.ledger.add(x.code); }
      const sk = [
        (i) => ({ kind: 'line', row: (b) => `TXN,${b},NP-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},REFUND,250.00,0.00,INR,${dateAgo(2)},,,`, code: 'AMOUNT_SIGN' }),
        (i) => ({ kind: 'line', row: (b) => `TXN,${b},NP-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},SALE,250.00,5.00,INR,2026-02-30,,,`, code: 'DATE_FORMAT' }),
        (i) => ({ kind: 'line', row: (b) => `TXN,${b},NP-BAD-${pad(i, 4)},PAY-BAD-${pad(i, 4)},SALE,250.00,400.00,INR,${dateAgo(2)},,,`, code: 'FEE_EXCEEDS_AMOUNT' }),
        (i) => ({ kind: 'dup', row: (b, first) => `TXN,${b},${first},PAY-BAD-${pad(i, 4)},SALE,250.00,5.00,INR,${dateAgo(2)},,,`, code: 'DUPLICATE_ID' }),
      ];
      for (let i = 0; i < ns; i++) { const x = sk[i % sk.length](i + 1); planted.settlement.push(x); rejectedCodes.settlement.add(x.code); }
    },
    expected: exp,
    lines, ledger, planted, rejectedCodes,
  };

  /** Turn the collected records into files + the final expectation. */
  api.build = ({ batchesPerDay = 1, brokenBatches = [] } = {}) => {
    const dates = [...new Set(lines.map((l) => l.settledOn))].sort();
    // split each day's lines across `batchesPerDay` batches, round-robin in line order
    const batchOfLine = new Map();
    const batchList = [];
    for (const d of dates) {
      const inDay = lines.filter((l) => l.settledOn === d);
      const k = Math.max(1, Math.min(batchesPerDay, inDay.length));
      const ids = Array.from({ length: k }, (_, i) => (k === 1 ? `NP-${d.replace(/-/g, '')}` : `NP-${d.replace(/-/g, '')}-${String.fromCharCode(65 + i)}`));
      ids.forEach((id) => batchList.push({ batch: id, date: d, gross: 0, fee: 0, payout: 0, lines: 0 }));
      inDay.forEach((l, i) => batchOfLine.set(l.id, ids[i % k]));
    }
    const byId = new Map(batchList.map((b) => [b.batch, b]));
    for (const l of lines) { const b = byId.get(batchOfLine.get(l.id)); b.gross += l.paise; b.fee += l.fee; b.lines += 1; }
    for (const b of batchList) b.payout = b.gross - b.fee;

    // deliberately wrong batches: spread over the list so they are not all adjacent
    const brokenIds = [];
    brokenBatches.forEach((spec, i) => {
      const b = batchList[Math.min(batchList.length - 1, Math.floor(((i + 1) * batchList.length) / (brokenBatches.length + 1)))];
      if (brokenIds.includes(b.batch)) return;
      if (spec.payoutDelta) b.payout += spec.payoutDelta;
      if (spec.grossDelta) { b.gross += spec.grossDelta; b.payout += spec.grossDelta; }
      brokenIds.push(b.batch);
    });
    exp.breaks.BATCH_PAYOUT_MISMATCH = brokenIds.length;

    ledger.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    const lRows = ['ledger_id,reference,merchant,entry_type,amount,currency,recorded_at'];
    for (const l of ledger) lRows.push([l.id, l.ref, q(l.merchant), l.paise < 0 ? 'REFUND' : 'PAYMENT', toRupeesString(Math.abs(l.paise)), 'INR', l.recordedAt].join(','));
    // planted bad rows are spread through the file rather than lumped at the end
    planted.ledger.forEach((row, i) => lRows.splice(1 + Math.floor(((i + 1) * (lRows.length - 1)) / (planted.ledger.length + 1)), 0, row));

    lines.sort((a, b) => a.settledOn.localeCompare(b.settledOn) || a.id.localeCompare(b.id));
    const sRows = ['record_type,batch_id,line_id,reference,txn_type,amount,fee,currency,settled_on,batch_gross,batch_fee,batch_payout'];
    for (const b of batchList) {
      for (const l of lines.filter((x) => batchOfLine.get(x.id) === b.batch)) sRows.push(['TXN', b.batch, l.id, l.ref, l.paise < 0 ? 'REFUND' : 'SALE', toRupeesString(l.paise), toRupeesString(l.fee), 'INR', l.settledOn, '', '', ''].join(','));
      sRows.push(['BATCH', b.batch, '', '', '', '', '', 'INR', b.date, toRupeesString(b.gross), toRupeesString(b.fee), toRupeesString(b.payout)].join(','));
    }
    const firstBatch = batchList[0]?.batch || 'NP-00000000';
    const firstLineId = lines[0]?.id || 'NP-L-000001';
    planted.settlement.forEach((x, i) => sRows.splice(Math.max(2, 1 + Math.floor(((i + 1) * (sRows.length - 1)) / (planted.settlement.length + 1))), 0, x.kind === 'dup' ? x.row(firstBatch, firstLineId) : x.row(firstBatch)));

    const txBreaks = BREAK_KEYS.filter((k) => k !== 'BATCH_PAYOUT_MISMATCH').reduce((t, k) => t + exp.breaks[k], 0);
    return {
      ledgerCsv: `${lRows.join('\n')}\n`,
      settlementCsv: `${sRows.join('\n')}\n`,
      expected: {
        scenario, size, seed, asOfDate: ASOF,
        settings: { settlementWindowDays: WINDOW_DAYS, feeRatePercent: '2.0000', feeTolerancePaise: 1, amountTolerancePaise: 0 },
        ledgerRows: { total: ledger.length + planted.ledger.length, accepted: ledger.length, rejected: planted.ledger.length },
        settlementRows: { total: lines.length + batchList.length + planted.settlement.length, accepted: lines.length + batchList.length, rejected: planted.settlement.length },
        rejectedCodes: { ledger: [...rejectedCodes.ledger].sort(), settlement: [...rejectedCodes.settlement].sort() },
        transactions: { matched: exp.matched, pending: exp.pending, breaks: txBreaks },
        breaksByType: { ...exp.breaks },
        batches: { total: batchList.length, matched: batchList.length - brokenIds.length, broken: brokenIds.length, brokenIds: [...brokenIds].sort() },
        totalBreaks: txBreaks + brokenIds.length,
      },
    };
  };
  return api;
}

/* ------------------------------ the scenarios ------------------------------ */

const SCENARIOS = {
  'clean-day': {
    title: 'Clean settlement day',
    description: 'Almost everything matches: ordinary payments, some refunds, a handful still inside the settlement window, and two payments on the IST midnight boundary. The reference case for a healthy day.',
    build(b, n) {
      b.matched(n, { refunds: pct(n, 0.06) });
      b.timezoneEdges(); b.feeRoundingBoundaries(); b.feeWithinTolerance(pct(n, 0.03));
      b.pending(pct(n, 0.03));
      return {};
    },
  },
  'missing-settlements': {
    title: 'Several missing settlements',
    description: 'The processor file is short: a meaningful share of ledger entries older than the settlement window never settled, plus a few that are still pending and a couple of orphan settlement lines.',
    build(b, n) {
      b.matched(n);
      b.missingInSettlement(pct(n, 0.12)); b.pending(pct(n, 0.04)); b.missingInLedger(pct(n, 0.02));
      return {};
    },
  },
  'duplicate-references': {
    title: 'Processor file with duplicate references',
    description: 'The processor lists some payments twice (duplicate settlement), a customer legitimately pays twice under one reference (both pairs match), and a few references are genuinely ambiguous (two ledger amounts, one settlement amount).',
    build(b, n) {
      b.matched(n); b.duplicateSettlements(pct(n, 0.08)); b.legitimateRepeats(pct(n, 0.03)); b.ambiguous(pct(n, 0.02));
      return { batchesPerDay: 2 };
    },
  },
  'fee-variances': {
    title: 'Multiple fee variances',
    description: 'Fees diverge from the configured 2%: over- and under-charges well past the tolerance, and exact ±1 paisa differences that must NOT be reported. Includes the exact boundary (+1 ok, +2 break).',
    build(b, n) {
      b.matched(n); b.feeWithinTolerance(pct(n, 0.05));
      b.feeVariances(pct(n, 0.12), [2, -2, 500, -750, 1500, 6000, 3]); b.feeRoundingBoundaries();
      return {};
    },
  },
  'late-settlements': {
    title: 'Late settlements',
    description: 'Tests the settlement window precisely: unsettled entries at every age from today back to 7 days (pending inside the window, missing outside), and payments that did settle, but 3–5 days late (still matched).',
    build(b, n) {
      b.matched(n, { lagMin: 3, lagMax: 5, minAge: 5 });
      for (let age = 0; age <= 7; age++) b.unsettledAtAge(age, pct(n, 0.03));
      return {};
    },
  },
  'refund-heavy': {
    title: 'Refund-heavy day',
    description: 'A promotion reversal: about a third of the activity is refunds (negative settlement amounts, no fee). Includes refunds settled for the wrong amount and refunds the processor paid that the ledger never recorded.',
    build(b, n) {
      b.matched(n, { refunds: pct(n, 0.35) }); b.refundMismatches(pct(n, 0.04)); b.orphanRefunds(pct(n, 0.02)); b.pending(pct(n, 0.03));
      return {};
    },
  },
  'multi-batch': {
    title: 'Multiple payout batches',
    description: 'Each settlement day is paid out in four batches. Every batch total is consistent with its lines, so all batches reconcile; transaction-level outcomes are unaffected by how lines are grouped.',
    build(b, n) { b.matched(n, { refunds: pct(n, 0.05) }); b.feeVariances(pct(n, 0.03)); b.pending(pct(n, 0.03)); return { batchesPerDay: 4 }; },
  },
  'invalid-rows': {
    title: 'Files with invalid CSV rows',
    description: 'About one row in ten is malformed in both files (zero or malformed amounts, wrong currency, missing timestamp offset, missing reference, unknown entry type, refunds with the wrong sign, impossible dates, repeated line ids, fee above amount). Valid rows reconcile normally.',
    build(b, n) {
      b.matched(n); b.amountMismatches(pct(n, 0.02)); b.pending(pct(n, 0.03));
      b.invalidRows({ ledger: pct(n, 0.1), settlement: pct(n, 0.1) });
      return {};
    },
  },
  'break-storm': {
    title: 'Unusually many breaks',
    description: 'A bad day: roughly four in ten transactions need attention across every transaction break type, and two batches are short on payout. Stress for the break queue, filters and pagination.',
    build(b, n) {
      b.matched(pct(n, 0.55));
      b.amountMismatches(pct(n, 0.08)); b.duplicateSettlements(pct(n, 0.06)); b.feeVariances(pct(n, 0.08)); b.missingInLedger(pct(n, 0.05));
      b.missingInSettlement(pct(n, 0.1)); b.ambiguous(pct(n, 0.03)); b.pending(pct(n, 0.04));
      return { batchesPerDay: 2, brokenBatches: [{ payoutDelta: -1250 }, { grossDelta: 20000 }] };
    },
  },
  'batch-payout-difference': {
    title: 'One batch pays out the wrong amount',
    description: 'Every transaction matches, but two payout batches disagree with their own lines: one short on payout, one with a declared gross that is too high. The break is entirely at batch level.',
    build(b, n) { b.matched(n, { refunds: pct(n, 0.05) }); return { batchesPerDay: 3, brokenBatches: [{ payoutDelta: -720 }, { grossDelta: 10000 }] }; },
  },
};

function generateScenario(name, { size = 'normal', seed = 20261108 } = {}) {
  const def = SCENARIOS[name];
  if (!def) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  const n = SIZES[size];
  if (!n) throw new Error(`Unknown size "${size}". Known: ${Object.keys(SIZES).join(', ')}`);
  const b = createBuilder({ seed, scenario: name, size });
  const buildOptions = def.build(b, n);
  return b.build(buildOptions);
}

const listScenarios = () => Object.entries(SCENARIOS).map(([name, d]) => ({ name, title: d.title, description: d.description }));

module.exports = { generateScenario, listScenarios, SIZES, ASOF, WINDOW_DAYS, BREAK_KEYS };
