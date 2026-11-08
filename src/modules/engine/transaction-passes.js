'use strict';

const { formatPaise } = require('../../lib/money');
const { addDays } = require('../../lib/dates');

/**
 * Transaction-level passes (R01–R06, R09).
 *
 * Uniqueness scope: a record's match key is (reference, direction). A payment and a refund
 * may legitimately share a reference, so direction is part of the key. Within a key, several
 * records on either side are normal (repeated references, processor duplicates) and are
 * resolved by the passes below, never by taking the first candidate.
 *
 * Each pass only looks at records still unclaimed by earlier passes, which is what makes the
 * precedence order meaningful and the output deterministic. Inputs are pre-sorted by the
 * caller (business date / settled date, then file row), so "in order" is reproducible.
 */

const ledgerLabel = (l) => `ledger ${l.sourceId} (${formatPaise(l.amountPaise)})`;
const lineLabel = (s) => `settlement line ${s.sourceId} (${formatPaise(s.amountPaise)})`;

function groupByKey(ledger, settlement) {
  const groups = new Map();
  const get = (k) => {
    if (!groups.has(k)) groups.set(k, { key: k, L: [], S: [], paired: [] });
    return groups.get(k);
  };
  for (const l of ledger) get(`${l.reference}|${l.direction}`).L.push(l);
  for (const s of settlement) get(`${s.reference}|${s.direction}`).S.push(s);
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function deadlineOf(l, windowDays) {
  return addDays(l.businessDate, windowDays);
}

/** R01 — same key and same amount (or a lone pair within the configured tolerance). */
function passExact(groups, cfg, out) {
  for (const g of groups) {
    // 1a. Bucket by exact amount. Equal counts pair off in file order; surplus stays unclaimed.
    const amounts = new Set([...g.L.map((l) => l.amountPaise), ...g.S.map((s) => s.amountPaise)]);
    for (const amount of [...amounts].sort((a, b) => a - b)) {
      const ls = g.L.filter((l) => l.amountPaise === amount);
      const ss = g.S.filter((s) => s.amountPaise === amount);
      const n = Math.min(ls.length, ss.length);
      for (let i = 0; i < n; i++) {
        const repeated = ls.length > 1 || ss.length > 1;
        g.paired.push({ l: ls[i], s: ss[i], rule: 'R01', repeated, group: g });
      }
      const claimedL = new Set(ls.slice(0, n));
      const claimedS = new Set(ss.slice(0, n));
      g.L = g.L.filter((l) => !claimedL.has(l));
      g.S = g.S.filter((s) => !claimedS.has(s));
    }
    // 1b. A single leftover pair that differs by no more than the tolerance still matches.
    if (cfg.amountTolerancePaise > 0 && g.L.length === 1 && g.S.length === 1) {
      const diff = g.S[0].amountPaise - g.L[0].amountPaise;
      if (Math.abs(diff) <= cfg.amountTolerancePaise) {
        g.paired.push({ l: g.L[0], s: g.S[0], rule: 'R01', repeated: false, withinTolerance: diff, group: g });
        g.L = [];
        g.S = [];
      }
    }
  }
  void out;
}

/** R02 — exactly one unclaimed record on each side: the reference identifies the pair, the amount differs. */
function passAmountMismatch(groups, cfg, out) {
  for (const g of groups) {
    if (g.L.length !== 1 || g.S.length !== 1) continue;
    const [l] = g.L;
    const [s] = g.S;
    const diff = s.amountPaise - l.amountPaise;
    out.push({
      scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'AMOUNT_MISMATCH', ruleId: 'R02',
      ledgerEntryId: l.id, settlementLineId: s.id, reference: l.reference, groupKey: g.key,
      amountDiffPaise: diff, impactPaise: Math.abs(diff), referenceDate: l.businessDate,
      explanation: `Reference ${l.reference} is in both sources but the amounts differ: ledger ${formatPaise(l.amountPaise)}, `
        + `settlement ${formatPaise(s.amountPaise)} (difference ${formatPaise(diff)}).`,
      details: { ledgerAmountPaise: l.amountPaise, settlementAmountPaise: s.amountPaise, batchRef: s.batchRef },
    });
    g.L = [];
    g.S = [];
  }
}

/**
 * R09 — guard. Anything left with candidates on both sides (e.g. two ledger entries and
 * one settlement line that equals neither) cannot be paired without guessing, so every
 * involved record gets an explicit AMBIGUOUS_REFERENCE break for a human to untangle.
 */
function passAmbiguous(groups, cfg, out) {
  for (const g of groups) {
    if (g.L.length === 0 || g.S.length === 0) continue;
    const summary = `Reference ${g.L[0].reference} has ${g.L.length} unpaired ledger and ${g.S.length} unpaired settlement `
      + 'record(s) whose amounts do not line up one-to-one, so no automatic pairing was made.';
    for (const l of g.L) {
      out.push({
        scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'AMBIGUOUS_REFERENCE', ruleId: 'R09',
        ledgerEntryId: l.id, settlementLineId: null, reference: l.reference, groupKey: g.key,
        amountDiffPaise: null, impactPaise: Math.abs(l.amountPaise), referenceDate: l.businessDate,
        explanation: `${summary} This is ${ledgerLabel(l)}.`,
        details: { candidateSettlementLines: g.S.map((s) => s.sourceId) },
      });
    }
    for (const s of g.S) {
      out.push({
        scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'AMBIGUOUS_REFERENCE', ruleId: 'R09',
        ledgerEntryId: null, settlementLineId: s.id, reference: s.reference, groupKey: g.key,
        amountDiffPaise: null, impactPaise: Math.abs(s.amountPaise), referenceDate: s.settledOn,
        explanation: `${summary} This is ${lineLabel(s)}.`,
        details: { candidateLedgerEntries: g.L.map((l) => l.sourceId), batchRef: s.batchRef },
      });
    }
    g.L = [];
    g.S = [];
  }
}

/** R03 — settlement lines left over for a reference whose ledger entries were already settled. */
function passDuplicates(groups, cfg, out) {
  for (const g of groups) {
    if (g.L.length > 0 || g.S.length === 0 || g.paired.length === 0) continue;
    const settledBy = g.paired.map((p) => p.s.sourceId).join(', ');
    for (const s of g.S) {
      out.push({
        scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'DUPLICATE_SETTLEMENT', ruleId: 'R03',
        ledgerEntryId: null, settlementLineId: s.id, reference: s.reference, groupKey: g.key,
        amountDiffPaise: null, impactPaise: Math.abs(s.amountPaise), referenceDate: s.settledOn,
        explanation: `Reference ${s.reference} is settled more than once. The ledger has ${g.paired.length} matching `
          + `entr${g.paired.length === 1 ? 'y' : 'ies'}, already settled by line ${settledBy}; ${lineLabel(s)} is an extra.`,
        details: { settledByLines: g.paired.map((p) => p.s.sourceId), batchRef: s.batchRef },
      });
    }
    g.S = [];
  }
}

/** R04 — ledger entries with no settlement yet, still inside the settlement window. */
function passPending(groups, cfg, out) {
  for (const g of groups) {
    if (g.S.length > 0) continue;
    const stillPending = [];
    for (const l of g.L) {
      const deadline = deadlineOf(l, cfg.settlementWindowDays);
      if (cfg.asOfDate <= deadline) {
        out.push({
          scope: 'TRANSACTION', outcome: 'PENDING', breakType: null, ruleId: 'R04',
          ledgerEntryId: l.id, settlementLineId: null, reference: l.reference, groupKey: g.key,
          amountDiffPaise: null, impactPaise: Math.abs(l.amountPaise), referenceDate: l.businessDate,
          explanation: `Awaiting processor settlement. Recorded ${l.businessDate}; the settlement window runs to ${deadline} `
            + `and the run is as of ${cfg.asOfDate}.`,
          details: { settlementDeadline: deadline, asOfDate: cfg.asOfDate },
        });
      } else {
        stillPending.push(l);
      }
    }
    g.L = stillPending;
  }
}

/** R05 — settlement lines with no ledger counterpart under this reference at all. */
function passMissingLedger(groups, cfg, out) {
  for (const g of groups) {
    if (g.L.length > 0 || g.S.length === 0) continue;
    for (const s of g.S) {
      out.push({
        scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'MISSING_IN_LEDGER', ruleId: 'R05',
        ledgerEntryId: null, settlementLineId: s.id, reference: s.reference, groupKey: g.key,
        amountDiffPaise: null, impactPaise: Math.abs(s.amountPaise), referenceDate: s.settledOn,
        explanation: `No internal ledger record exists for reference ${s.reference}, but the processor settled `
          + `${formatPaise(s.amountPaise)} (${lineLabel(s)}) on ${s.settledOn}.`,
        details: { batchRef: s.batchRef, settledOn: s.settledOn },
      });
    }
    g.S = [];
  }
}

/** R06 — ledger entries still unsettled after the window has closed. */
function passMissingSettlement(groups, cfg, out) {
  for (const g of groups) {
    for (const l of g.L) {
      const deadline = deadlineOf(l, cfg.settlementWindowDays);
      out.push({
        scope: 'TRANSACTION', outcome: 'BREAK', breakType: 'MISSING_IN_SETTLEMENT', ruleId: 'R06',
        ledgerEntryId: l.id, settlementLineId: null, reference: l.reference, groupKey: g.key,
        amountDiffPaise: null, impactPaise: Math.abs(l.amountPaise), referenceDate: l.businessDate,
        explanation: `Ledger ${ledgerLabel(l).slice('ledger '.length)} recorded ${l.businessDate} was not settled by ${deadline}, the end of its `
          + `${cfg.settlementWindowDays}-day settlement window (run as of ${cfg.asOfDate}).`,
        details: { settlementDeadline: deadline, asOfDate: cfg.asOfDate },
      });
    }
    g.L = [];
  }
}

module.exports = {
  groupByKey, passExact, passAmountMismatch, passAmbiguous, passDuplicates, passPending,
  passMissingLedger, passMissingSettlement,
};
