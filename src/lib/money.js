'use strict';

/**
 * Money is always an integer number of paise (1 INR = 100 paise). Floating point is never
 * used: amounts are parsed from decimal strings by string manipulation, summed with a
 * safe-integer guard, and formatted by integer division.
 */

const MAX_ENTRY_PAISE = 1_000_000_000; // ₹1 crore per transaction line

class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

const RUPEES_RE = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;

/** Parses "1234.50" / "-99" into integer paise. Rejects separators, symbols, exponents, >2 decimals. */
function parseRupees(input) {
  if (typeof input !== 'string') throw new MoneyError('AMOUNT_FORMAT', 'Amount must be text such as 1250.00');
  const s = input.trim();
  const m = RUPEES_RE.exec(s);
  if (!m) {
    if (/^-?[0-9]+\.[0-9]{3,}$/.test(s)) {
      throw new MoneyError('AMOUNT_PRECISION', `Amount "${s}" has more than two decimal places`);
    }
    if (/[,₹$\s]/.test(s)) {
      throw new MoneyError('AMOUNT_FORMAT', `Amount "${s}" must not contain thousands separators, spaces or currency symbols`);
    }
    throw new MoneyError('AMOUNT_FORMAT', `Amount "${s}" is not a valid decimal such as 1250.00`);
  }
  const paise = BigInt(m[2]) * 100n + BigInt((m[3] || '').padEnd(2, '0'));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('AMOUNT_RANGE', 'Amount is too large');
  const n = Number(paise);
  return m[1] === '-' && n !== 0 ? -n : n;
}

/** Sums integer paise, failing loudly instead of silently losing precision. */
function sumPaise(values) {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new MoneyError('AMOUNT_RANGE', 'Sum exceeds the safe integer range');
  }
  return total;
}

/** "1,23,456.50" — Indian digit grouping (last three digits, then pairs). */
function formatPaise(paise, { symbol = true } = {}) {
  if (!Number.isSafeInteger(paise)) throw new MoneyError('AMOUNT_RANGE', 'Not a safe integer amount');
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = String(Math.trunc(abs / 100));
  const head = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = head ? `${head},${rupees.slice(-3)}` : rupees;
  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${grouped}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain decimal rupees ("1234.50") for CSV export and machine-readable output. */
function toRupeesString(paise) {
  return formatPaise(paise, { symbol: false }).replace(/,/g, '');
}

module.exports = { MAX_ENTRY_PAISE, MoneyError, parseRupees, sumPaise, formatPaise, toRupeesString };
