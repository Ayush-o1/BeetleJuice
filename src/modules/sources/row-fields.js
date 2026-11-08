'use strict';

const { parseRupees, MoneyError, MAX_ENTRY_PAISE } = require('../../lib/money');
const { parseInstant, isValidDateOnly } = require('../../lib/dates');

// Identifiers must start with a letter or digit. That alone rules out a leading = + - @
// (spreadsheet formula triggers) in the fields we later echo back in exports.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,63}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Collects field-level problems for a single row. Each helper returns the normalised value
 * or undefined and records an error; the row is rejected if any error was recorded.
 */
class RowChecker {
  constructor(obj) {
    this.obj = obj;
    this.errors = [];
  }

  raw(field) {
    return (this.obj[field] ?? '').trim();
  }

  fail(field, code, message) {
    this.errors.push({ field, code, message });
  }

  get ok() {
    return this.errors.length === 0;
  }

  id(field) {
    const v = this.raw(field);
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    if (!ID_RE.test(v)) {
      return this.fail(field, 'ID_FORMAT',
        `${field} "${v.slice(0, 40)}" must be 2–64 characters, start with a letter or digit, and use only letters, digits, . _ / -`);
    }
    return v;
  }

  oneOf(field, allowed) {
    const v = this.raw(field).toUpperCase();
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    if (!allowed.includes(v)) return this.fail(field, 'ENUM', `${field} "${v.slice(0, 20)}" must be one of ${allowed.join(', ')}`);
    return v;
  }

  currency(field = 'currency') {
    const v = this.raw(field).toUpperCase();
    if (!v) return this.fail(field, 'REQUIRED', 'currency is required');
    if (v !== 'INR') return this.fail(field, 'CURRENCY', `currency "${v.slice(0, 5)}" is not supported; only INR is accepted`);
    return v;
  }

  text(field, max) {
    const v = this.raw(field);
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    if (v.length > max) return this.fail(field, 'TOO_LONG', `${field} is longer than ${max} characters`);
    if (CONTROL_RE.test(v)) return this.fail(field, 'CONTROL_CHARS', `${field} contains control characters`);
    return v;
  }

  /** Amount in rupees -> signed paise. `sign`: 'positive' | 'negative' | 'any'. Zero is never valid for a transaction. */
  money(field, { sign = 'any', allowZero = false, max = MAX_ENTRY_PAISE } = {}) {
    const v = this.raw(field);
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    let paise;
    try {
      paise = parseRupees(v);
    } catch (e) {
      if (e instanceof MoneyError) return this.fail(field, e.code, e.message);
      throw e;
    }
    if (paise === 0 && !allowZero) return this.fail(field, 'AMOUNT_ZERO', `${field} must not be zero`);
    if (sign === 'positive' && paise < 0) return this.fail(field, 'AMOUNT_SIGN', `${field} must be positive`);
    if (sign === 'negative' && paise > 0) return this.fail(field, 'AMOUNT_SIGN', `${field} must be negative`);
    if (Math.abs(paise) > max) {
      return this.fail(field, 'AMOUNT_RANGE', `${field} exceeds the maximum of ₹${(max / 100).toLocaleString('en-IN')}`);
    }
    return paise;
  }

  instant(field) {
    const v = this.raw(field);
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    const d = parseInstant(v);
    if (!d) {
      return this.fail(field, 'DATETIME_FORMAT',
        `${field} "${v.slice(0, 40)}" must be an ISO-8601 timestamp with an explicit offset, e.g. 2026-11-06T14:30:00+05:30`);
    }
    return d;
  }

  date(field) {
    const v = this.raw(field);
    if (!v) return this.fail(field, 'REQUIRED', `${field} is required`);
    if (!isValidDateOnly(v)) return this.fail(field, 'DATE_FORMAT', `${field} "${v.slice(0, 20)}" must be a real date as YYYY-MM-DD`);
    return v;
  }

  mustBeEmpty(field) {
    if (this.raw(field) !== '') this.fail(field, 'NOT_ALLOWED', `${field} must be empty for this record type`);
  }
}

module.exports = { RowChecker, ID_RE };
