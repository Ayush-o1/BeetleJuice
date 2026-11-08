'use strict';

/**
 * Percentage fee arithmetic with exact rationals (BigInt), so no binary-float error can
 * creep into a fee comparison.
 *
 * Rounding policy (single place, applies everywhere): the fee for a line is
 *   round_half_up(amount_paise * rate_percent / 100)
 * to a whole paisa, where "half up" means halves round away from zero. Example at 2.0000%:
 * ₹0.25 -> 25 paise * 0.02 = 0.5 paise -> 1 paisa.
 */

const PERCENT_RE = /^([0-9]{1,3})(?:\.([0-9]{1,4}))?$/;

/** Parses a percent string with up to four decimals into {num, den} such that rate = num/den. */
function parsePercent(input) {
  const s = String(input).trim();
  const m = PERCENT_RE.exec(s);
  if (!m) throw new Error(`Invalid percentage "${s}" (up to 4 decimal places)`);
  const scaled = BigInt(m[1] + (m[2] || '').padEnd(4, '0')); // percent * 10^4
  return { num: scaled, den: 1_000_000n };                    // / 10^4 (decimals) / 100 (percent)
}

/** Integer division with halves rounded away from zero. d must be positive. */
function roundDivHalfUp(n, d) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

function computeFeePaise(amountPaise, rate) {
  return Number(roundDivHalfUp(BigInt(amountPaise) * rate.num, rate.den));
}

module.exports = { parsePercent, roundDivHalfUp, computeFeePaise };
