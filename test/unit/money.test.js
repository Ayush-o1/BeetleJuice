'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRupees, sumPaise, formatPaise, toRupeesString, MoneyError } = require('../../src/lib/money');
const { parsePercent, computeFeePaise, roundDivHalfUp } = require('../../src/lib/rate');

test('parseRupees converts decimal strings to integer paise without floats', () => {
  assert.equal(parseRupees('100.25'), 10025);
  assert.equal(parseRupees('0.01'), 1);
  assert.equal(parseRupees('7'), 700);
  assert.equal(parseRupees('7.5'), 750);
  assert.equal(parseRupees('-1250.00'), -125000);
  assert.equal(parseRupees(' 19.99 '), 1999);
  // 0.1 + 0.2 style traps: 4.35 * 100 === 434.99999999999994 in floating point.
  assert.equal(parseRupees('4.35'), 435);
  assert.equal(parseRupees('1.15'), 115);
  assert.equal(Object.is(parseRupees('-0.00'), 0), true);
});

test('parseRupees rejects malformed amounts with specific codes', () => {
  const code = (s) => { try { parseRupees(s); } catch (e) { return e instanceof MoneyError ? e.code : 'other'; } return 'none'; };
  assert.equal(code('1.234'), 'AMOUNT_PRECISION');
  assert.equal(code('1,00,000.00'), 'AMOUNT_FORMAT');
  assert.equal(code('₹100'), 'AMOUNT_FORMAT');
  assert.equal(code('1e5'), 'AMOUNT_FORMAT');
  assert.equal(code(''), 'AMOUNT_FORMAT');
  assert.equal(code('abc'), 'AMOUNT_FORMAT');
  assert.equal(code('007.00'), 'AMOUNT_FORMAT');
  assert.equal(code('.50'), 'AMOUNT_FORMAT');
  assert.equal(code('99999999999999999999'), 'AMOUNT_RANGE');
  assert.equal(code(12.5), 'AMOUNT_FORMAT');
});

test('sumPaise is exact and guards the safe-integer range', () => {
  assert.equal(sumPaise([10, 20, -5]), 25);
  assert.throws(() => sumPaise([Number.MAX_SAFE_INTEGER, 1]), MoneyError);
});

test('formatPaise uses Indian digit grouping', () => {
  assert.equal(formatPaise(0), '₹0.00');
  assert.equal(formatPaise(5), '₹0.05');
  assert.equal(formatPaise(10025), '₹100.25');
  assert.equal(formatPaise(123456789), '₹12,34,567.89');
  assert.equal(formatPaise(100000000), '₹10,00,000.00');
  assert.equal(formatPaise(-125000), '-₹1,250.00');
  assert.equal(formatPaise(99999900, { symbol: false }), '9,99,999.00');
  assert.equal(toRupeesString(123456789), '1234567.89');
});

test('fee rounding is half-up (away from zero) on exact rationals', () => {
  const r2 = parsePercent('2.0000');
  assert.equal(computeFeePaise(25, r2), 1);      // 0.50 paise -> 1
  assert.equal(computeFeePaise(24, r2), 0);      // 0.48 paise -> 0
  assert.equal(computeFeePaise(75, r2), 2);      // 1.50 -> 2
  assert.equal(computeFeePaise(74, r2), 1);      // 1.48 -> 1
  assert.equal(computeFeePaise(100000, r2), 2000);
  assert.equal(computeFeePaise(1, r2), 0);
  const r175 = parsePercent('1.7500');
  assert.equal(computeFeePaise(10000, r175), 175);
  assert.equal(computeFeePaise(28, r175), 0);    // 0.49
  assert.equal(computeFeePaise(29, r175), 1);    // 0.5075
  const r0 = parsePercent('0');
  assert.equal(computeFeePaise(999999, r0), 0);
  // Large value stays exact: ₹1 crore at 2.5%.
  assert.equal(computeFeePaise(1_000_000_000, parsePercent('2.5')), 25_000_000);
  assert.equal(roundDivHalfUp(-5n, 2n), -3n);
  assert.equal(roundDivHalfUp(5n, 2n), 3n);
});

test('parsePercent validates format', () => {
  assert.throws(() => parsePercent('2.12345'));
  assert.throws(() => parsePercent('-1'));
  assert.throws(() => parsePercent('abc'));
  assert.deepEqual(parsePercent('2'), { num: 20000n, den: 1_000_000n });
});
