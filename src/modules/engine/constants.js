'use strict';

const ENGINE_VERSION = '1.0.0';

/** Rule catalogue. Ids are stored on every result and documented in docs/reconciliation-rules.md. */
const RULES = Object.freeze({
  R01: { id: 'R01', name: 'Exact reference and amount match' },
  R02: { id: 'R02', name: 'Reference match with amount mismatch' },
  R03: { id: 'R03', name: 'Duplicate settlement reference' },
  R04: { id: 'R04', name: 'Pending within settlement window' },
  R05: { id: 'R05', name: 'Missing internal ledger record' },
  R06: { id: 'R06', name: 'Missing settlement after window' },
  R07: { id: 'R07', name: 'Batch payout reconciliation' },
  R08: { id: 'R08', name: 'Fee variance' },
  R09: { id: 'R09', name: 'Ambiguous reference (guard)' },
});

/**
 * Order in which passes claim records. R09 sits between R02 and R03 on purpose: whatever is
 * still unpaired after the exact and mismatch passes but has candidates on BOTH sides is
 * ambiguous and must not be resolved by guesswork. R08 runs last because it only re-labels
 * pairs that R01 already produced.
 */
const RULE_SEQUENCE = Object.freeze(['R01', 'R02', 'R09', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08']);

const BREAK_TYPES = Object.freeze({
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  DUPLICATE_SETTLEMENT: 'DUPLICATE_SETTLEMENT',
  MISSING_IN_LEDGER: 'MISSING_IN_LEDGER',
  MISSING_IN_SETTLEMENT: 'MISSING_IN_SETTLEMENT',
  BATCH_PAYOUT_MISMATCH: 'BATCH_PAYOUT_MISMATCH',
  FEE_VARIANCE: 'FEE_VARIANCE',
  AMBIGUOUS_REFERENCE: 'AMBIGUOUS_REFERENCE',
});

module.exports = { ENGINE_VERSION, RULES, RULE_SEQUENCE, BREAK_TYPES };
