'use strict';

const { parsePercent, computeFeePaise } = require('../../lib/rate');
const { formatPaise } = require('../../lib/money');
const { isValidDateOnly } = require('../../lib/dates');
const { RULE_SEQUENCE, ENGINE_VERSION } = require('./constants');
const tx = require('./transaction-passes');
const { passBatches } = require('./batch-pass');

/**
 * Deterministic, explainable reconciliation of one ledger extract against one settlement extract.
 *
 * This is a pure function: no database, no clock, no randomness. The same inputs and the same
 * config always yield byte-identical output (the "as of" date is part of the config precisely
 * so that wall-clock time never leaks in). Rule precedence is the order of the passes below;
 * see docs/reconciliation-rules.md.
 *
 * @param {object} input
 * @param {Array}  input.ledger      {id, sourceId, reference, direction, amountPaise, businessDate, rowNumber}
 * @param {Array}  input.settlement  {id, sourceId, reference, direction, amountPaise, feePaise, batchRef, settledOn, rowNumber}
 * @param {Array}  input.batches     {batchRef, settledOn, declaredGrossPaise, declaredFeePaise, declaredPayoutPaise}
 * @param {object} input.config      {amountTolerancePaise, feeRatePercent, feeTolerancePaise, settlementWindowDays, asOfDate}
 */
function reconcile({ ledger, settlement, batches, config }) {
  if (!isValidDateOnly(config.asOfDate)) throw new Error('config.asOfDate must be YYYY-MM-DD');
  const cfg = {
    amountTolerancePaise: config.amountTolerancePaise,
    feeTolerancePaise: config.feeTolerancePaise,
    settlementWindowDays: config.settlementWindowDays,
    asOfDate: config.asOfDate,
  };
  const rate = parsePercent(config.feeRatePercent);

  // Stable processing order: date, then position in the source file.
  const L = [...ledger].sort((a, b) => cmp(a.businessDate, b.businessDate) || a.rowNumber - b.rowNumber);
  const S = [...settlement].sort((a, b) => cmp(a.settledOn, b.settledOn) || a.rowNumber - b.rowNumber);

  const groups = tx.groupByKey(L, S);
  const results = [];

  tx.passExact(groups, cfg, results);                  // R01
  tx.passAmountMismatch(groups, cfg, results);         // R02
  tx.passAmbiguous(groups, cfg, results);              // R09 guard
  tx.passDuplicates(groups, cfg, results);             // R03
  tx.passPending(groups, cfg, results);                // R04
  tx.passMissingLedger(groups, cfg, results);          // R05
  tx.passMissingSettlement(groups, cfg, results);      // R06
  emitPairs(groups, cfg, rate, results);               // R01 matches, with R08 fee check applied
  passBatches(S, batches, cfg, rate, results);         // R07

  results.sort(resultOrder);
  return { results, summary: summarise(L, S, batches, results), engineVersion: ENGINE_VERSION, ruleSequence: RULE_SEQUENCE };
}

/**
 * R08 — fee variance. Applied to every pair produced by R01: the expected fee is the exact
 * rational fee on the settlement amount for sales, and zero for refunds (processors in this
 * model do not charge on refunds). A pair whose charged fee is further than the tolerance
 * from the expected fee is relabelled from MATCHED to a FEE_VARIANCE break.
 */
function emitPairs(groups, cfg, rate, out) {
  for (const g of groups) {
    for (const p of g.paired) {
      const { l, s } = p;
      const expectedFee = s.amountPaise > 0 ? computeFeePaise(s.amountPaise, rate) : 0;
      const feeDiff = s.feePaise - expectedFee;
      const base = {
        scope: 'TRANSACTION', ledgerEntryId: l.id, settlementLineId: s.id, reference: l.reference, groupKey: g.key,
        expectedFeePaise: expectedFee, actualFeePaise: s.feePaise, referenceDate: l.businessDate,
      };
      if (Math.abs(feeDiff) > cfg.feeTolerancePaise) {
        out.push({
          ...base, outcome: 'BREAK', breakType: 'FEE_VARIANCE', ruleId: 'R08',
          amountDiffPaise: feeDiff, impactPaise: Math.abs(feeDiff),
          explanation: `Fee variance detected on ${l.reference}: processor charged ${formatPaise(s.feePaise)}, `
            + `expected ${formatPaise(expectedFee)} at ${trimRate(rate)}% (difference ${formatPaise(feeDiff)}).`,
          details: { settlementAmountPaise: s.amountPaise, batchRef: s.batchRef, feeTolerancePaise: cfg.feeTolerancePaise },
        });
      } else {
        const diff = s.amountPaise - l.amountPaise;
        const notes = [];
        if (p.withinTolerance) notes.push(`amounts differ by ${formatPaise(diff)}, within the ${formatPaise(cfg.amountTolerancePaise)} tolerance`);
        if (p.repeated) notes.push('reference occurs more than once with identical amounts; paired in file order');
        out.push({
          ...base, outcome: 'MATCHED', breakType: null, ruleId: 'R01',
          amountDiffPaise: diff, impactPaise: Math.abs(l.amountPaise),
          explanation: `Settlement matched: ${l.reference} for ${formatPaise(l.amountPaise)} appears in both sources`
            + `${notes.length ? ` (${notes.join('; ')})` : ''}.`,
          details: { settlementAmountPaise: s.amountPaise, batchRef: s.batchRef },
        });
      }
    }
  }
}

const trimRate = (rate) => (Number(rate.num) / 10000).toString();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function resultOrder(a, b) {
  return cmp(a.scope, b.scope) || cmp(a.reference, b.reference) || cmp(a.ruleId, b.ruleId)
    || ((a.ledgerEntryId ?? 0) - (b.ledgerEntryId ?? 0)) || ((a.settlementLineId ?? 0) - (b.settlementLineId ?? 0));
}

function summarise(L, S, batches, results) {
  const byType = {};
  const counts = { matched: 0, pending: 0, breaks: 0, batchesMatched: 0, batchesBroken: 0 };
  let breakImpactPaise = 0;
  let pendingPaise = 0;
  for (const r of results) {
    if (r.scope === 'BATCH') {
      if (r.outcome === 'MATCHED') counts.batchesMatched++; else counts.batchesBroken++;
    } else if (r.outcome === 'MATCHED') counts.matched++;
    else if (r.outcome === 'PENDING') { counts.pending++; pendingPaise += r.impactPaise; }
    if (r.outcome === 'BREAK') {
      if (r.scope === 'TRANSACTION') counts.breaks++;
      byType[r.breakType] = (byType[r.breakType] || 0) + 1;
      breakImpactPaise += r.impactPaise;
    }
  }
  const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  return {
    inputs: { ledgerEntries: L.length, settlementLines: S.length, settlementBatches: batches.length },
    ...counts,
    totalBreaks: counts.breaks + counts.batchesBroken,
    breaksByType: byType,
    breakImpactPaise,
    pendingPaise,
    ledgerTotalPaise: sum(L, (l) => l.amountPaise),
    settlementGrossPaise: sum(S, (s) => s.amountPaise),
    settlementFeesPaise: sum(S, (s) => s.feePaise),
  };
}

module.exports = { reconcile };
