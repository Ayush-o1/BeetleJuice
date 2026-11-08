'use strict';

/**
 * Time handling rules:
 *  - Instants (ledger recorded_at) must carry an explicit UTC offset and are stored as timestamptz.
 *  - The business calendar is India Standard Time (UTC+05:30, no DST). A transaction's
 *    "business date" is its calendar date in IST.
 *  - Plain dates are 'YYYY-MM-DD' strings end to end (never JS Date objects in local time).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validYmd(y, m, d) {
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function isValidDateOnly(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  return Boolean(m) && validYmd(+m[1], +m[2], +m[3]);
}

/** Strict ISO-8601 instant with mandatory offset. Returns a Date, or null if invalid. */
function parseInstant(s) {
  const m = typeof s === 'string' ? INSTANT_RE.exec(s.trim()) : null;
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const sec = m[6] ? +m[6] : 0;
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null;
  let offsetMin = 0;
  if (m[8] !== 'Z') {
    const oh = +m[8].slice(1, 3);
    const om = +m[8].slice(4, 6);
    if (oh > 14 || om > 59) return null;
    offsetMin = (m[8][0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const ms = m[7] ? +m[7].padEnd(3, '0') : 0;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - offsetMin * 60000);
}

/** Calendar date ('YYYY-MM-DD') of an instant in IST. */
function businessDateOf(instant) {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function todayIst(now = new Date()) {
  return businessDateOf(now);
}

function utcMs(ymd) {
  const m = DATE_RE.exec(ymd);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function addDays(ymd, days) {
  return new Date(utcMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
function diffDays(a, b) {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

module.exports = { isValidDateOnly, parseInstant, businessDateOf, todayIst, addDays, diffDays };
