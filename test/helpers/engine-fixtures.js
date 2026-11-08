'use strict';

let seq = 0;
const nextId = () => ++seq;

/** Ledger entry builder. Amount is signed paise. */
function led(sourceId, reference, amountPaise, businessDate = '2026-11-01', extra = {}) {
  const id = extra.id ?? nextId();
  return {
    id, sourceId, reference, amountPaise, businessDate,
    direction: amountPaise < 0 ? 'REFUND' : 'PAYMENT',
    rowNumber: extra.rowNumber ?? id,
    ...extra,
  };
}

/** Settlement line builder. Fee defaults to the 2% rate on sales. */
function line(sourceId, reference, amountPaise, batchRef = 'B1', extra = {}) {
  const id = extra.id ?? nextId();
  const defaultFee = amountPaise > 0 ? Math.round(amountPaise * 0.02) : 0;
  return {
    id, sourceId, reference, amountPaise, batchRef,
    direction: amountPaise < 0 ? 'REFUND' : 'PAYMENT',
    feePaise: extra.feePaise ?? defaultFee,
    settledOn: extra.settledOn ?? '2026-11-02',
    rowNumber: extra.rowNumber ?? id,
    ...extra,
  };
}

function batch(batchRef, gross, fee, payout, settledOn = '2026-11-02') {
  return { batchRef, settledOn, declaredGrossPaise: gross, declaredFeePaise: fee, declaredPayoutPaise: payout };
}

/** Summary row that exactly reflects the given lines (a batch that reconciles). */
function honestBatch(batchRef, lines, settledOn = '2026-11-02') {
  const inBatch = lines.filter((l) => l.batchRef === batchRef);
  const gross = inBatch.reduce((t, l) => t + l.amountPaise, 0);
  const fee = inBatch.reduce((t, l) => t + l.feePaise, 0);
  return batch(batchRef, gross, fee, gross - fee, settledOn);
}

const baseConfig = (over = {}) => ({
  amountTolerancePaise: 0, feeRatePercent: '2.0000', feeTolerancePaise: 1,
  settlementWindowDays: 2, asOfDate: '2026-11-08', ...over,
});

module.exports = { led, line, batch, honestBatch, baseConfig };
