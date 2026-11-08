// "What to check" guidance shown on a break. This is static, reviewed advice per break type, not generated output:
// it says where to look and which resolutions usually apply. The resolution list itself is never restricted.
export const GUIDANCE = {
  AMOUNT_MISMATCH: {
    summary: 'The reference exists on both sides but the amounts differ.',
    checks: [
      'Compare both amounts with the customer receipt or order. Whichever side differs from it is the wrong one.',
      'Look for a partial capture, a partial refund or a currency conversion at the processor.',
      'A difference of a few paise is usually rounding; check how each side rounds before disputing.',
    ],
    usually: ['CORRECT_LEDGER', 'DISPUTE_WITH_PROCESSOR', 'WRITE_OFF'],
  },
  FEE_VARIANCE: {
    summary: 'The amounts match but the processor charged a different fee from the configured rate.',
    checks: [
      'Check the contracted rate for this merchant and payment type; the configured rate is one number for everything.',
      'Refunds and some payment methods are often priced differently.',
      'If the rate in Settings is stale, change it for future runs rather than approving many one-off write-offs.',
    ],
    usually: ['DISPUTE_WITH_PROCESSOR', 'WRITE_OFF', 'NO_ACTION'],
  },
  DUPLICATE_SETTLEMENT: {
    summary: 'The processor settled this reference more than once; the ledger accounts for one payment.',
    checks: [
      'Confirm the second line is not a legitimate second payment that was recorded under the same reference.',
      'Check whether both lines sit in the same batch: if the batch was paid out, the money has already moved.',
      'Ask the processor to reverse the surplus line.',
    ],
    usually: ['RECOVER_DUPLICATE', 'DISPUTE_WITH_PROCESSOR'],
  },
  MISSING_IN_SETTLEMENT: {
    summary: 'The ledger has a payment that the processor did not settle within the settlement window.',
    checks: [
      'Run again with a later as-of date or a newer settlement file: it may simply have settled after the file was cut.',
      'Check the processor dashboard for the payment status (failed, held, reversed).',
      'If it was never captured, the ledger entry may need correcting.',
    ],
    usually: ['DISPUTE_WITH_PROCESSOR', 'CORRECT_LEDGER'],
  },
  MISSING_IN_LEDGER: {
    summary: 'The processor settled a payment that has no ledger entry.',
    checks: [
      'Search the ledger by amount and date: the reference may have been keyed differently.',
      'Check whether the payment belongs to another merchant account or file period.',
      'If it is genuine, the ledger needs the entry.',
    ],
    usually: ['CORRECT_LEDGER', 'DISPUTE_WITH_PROCESSOR'],
  },
  AMBIGUOUS_REFERENCE: {
    summary: 'Several records share this reference and they cannot be paired safely, so the engine did not guess.',
    checks: [
      'Open each record in the list below and match them by amount and time yourself.',
      'Ask the merchant system why one reference was reused.',
      'Record which pairing you decided on in a note so the decision is traceable.',
    ],
    usually: ['CORRECT_LEDGER', 'NO_ACTION'],
  },
  BATCH_PAYOUT_MISMATCH: {
    summary: 'The payout the processor declared does not equal the settled lines less their fees.',
    checks: [
      'Compare declared gross, fees and payout with the computed column; the highlighted row is where they diverge.',
      'A gross difference means lines are missing or extra in the file; a fee difference points to the fee column.',
      'Check the bank credit for the batch before disputing with the processor.',
    ],
    usually: ['DISPUTE_WITH_PROCESSOR', 'WRITE_OFF'],
  },
};
