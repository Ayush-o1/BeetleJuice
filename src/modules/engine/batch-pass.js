'use strict';

const { formatPaise, sumPaise } = require('../../lib/money');
const { computeFeePaise } = require('../../lib/rate');

/**
 * R07 — batch payout reconciliation.
 *
 * For every processor batch the engine recomputes, from the settlement LINES:
 *   gross  = sum(line amount)         (sales positive, refunds negative)
 *   fees   = sum(line fee)            (as charged by the processor)
 *   net    = gross - fees             (expected payout)
 * and compares them with the figures the processor declared on the batch summary row.
 * All three must agree exactly (no tolerance: a payout is a real transfer of money).
 * Each settlement line belongs to exactly one batch (its batch_ref), so no line is counted twice.
 * A batch with lines but no summary row, or a summary row with no lines, is also a break.
 */
function passBatches(settlement, batches, cfg, rate, out) {
  const linesByBatch = new Map();
  for (const s of settlement) {
    if (!linesByBatch.has(s.batchRef)) linesByBatch.set(s.batchRef, []);
    linesByBatch.get(s.batchRef).push(s);
  }
  const summaryByRef = new Map(batches.map((b) => [b.batchRef, b]));
  const refs = [...new Set([...linesByBatch.keys(), ...summaryByRef.keys()])].sort();

  for (const ref of refs) {
    const lines = linesByBatch.get(ref) || [];
    const summary = summaryByRef.get(ref);
    const gross = sumPaise(lines.map((s) => s.amountPaise));
    const fees = sumPaise(lines.map((s) => s.feePaise));
    const net = gross - fees;
    const rateExpectedFees = sumPaise(lines.map((s) => (s.amountPaise > 0 ? computeFeePaise(s.amountPaise, rate) : 0)));
    const computed = { grossPaise: gross, feesPaise: fees, expectedNetPaise: net, rateExpectedFeesPaise: rateExpectedFees, lineCount: lines.length };
    const referenceDate = summary ? summary.settledOn : lines.reduce((m, s) => (s.settledOn < m ? s.settledOn : m), lines[0].settledOn);

    if (!summary) {
      out.push({
        scope: 'BATCH', outcome: 'BREAK', breakType: 'BATCH_PAYOUT_MISMATCH', ruleId: 'R07',
        ledgerEntryId: null, settlementLineId: null, batchRef: ref, reference: ref, groupKey: `batch|${ref}`,
        amountDiffPaise: null, impactPaise: Math.abs(net), referenceDate,
        explanation: `Settlement lines reference batch ${ref} (${lines.length} line(s), expected payout ${formatPaise(net)}) `
          + 'but the file has no batch summary row, so the payout cannot be verified.',
        details: { computed, declared: null },
      });
      continue;
    }

    const declared = {
      grossPaise: summary.declaredGrossPaise, feesPaise: summary.declaredFeePaise, payoutPaise: summary.declaredPayoutPaise,
    };
    const diffs = {
      grossPaise: declared.grossPaise - gross,
      feesPaise: declared.feesPaise - fees,
      payoutPaise: declared.payoutPaise - net,
    };
    const problems = [];
    if (diffs.grossPaise !== 0) problems.push(`gross declared ${formatPaise(declared.grossPaise)} vs lines ${formatPaise(gross)}`);
    if (diffs.feesPaise !== 0) problems.push(`fees declared ${formatPaise(declared.feesPaise)} vs lines ${formatPaise(fees)}`);
    if (diffs.payoutPaise !== 0) problems.push(`payout declared ${formatPaise(declared.payoutPaise)} vs expected ${formatPaise(net)}`);

    if (problems.length === 0) {
      out.push({
        scope: 'BATCH', outcome: 'MATCHED', breakType: null, ruleId: 'R07',
        ledgerEntryId: null, settlementLineId: null, batchRef: ref, reference: ref, groupKey: `batch|${ref}`,
        amountDiffPaise: 0, impactPaise: 0, referenceDate,
        explanation: `Batch ${ref} reconciles: ${lines.length} line(s), gross ${formatPaise(gross)} less fees ${formatPaise(fees)} `
          + `equals payout ${formatPaise(net)}.`,
        details: { computed, declared, diffs },
      });
    } else {
      out.push({
        scope: 'BATCH', outcome: 'BREAK', breakType: 'BATCH_PAYOUT_MISMATCH', ruleId: 'R07',
        ledgerEntryId: null, settlementLineId: null, batchRef: ref, reference: ref, groupKey: `batch|${ref}`,
        amountDiffPaise: diffs.payoutPaise, impactPaise: Math.max(...Object.values(diffs).map(Math.abs)), referenceDate,
        explanation: `Batch payout does not reconcile for ${ref}: ${problems.join('; ')}.`,
        details: { computed, declared, diffs },
      });
    }
  }
}

module.exports = { passBatches };
