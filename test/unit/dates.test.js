'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInstant, businessDateOf, isValidDateOnly, addDays, diffDays } = require('../../src/lib/dates');

test('business date is the calendar date in IST, including around midnight', () => {
  const bd = (s) => businessDateOf(parseInstant(s));
  assert.equal(bd('2026-11-06T23:45:00+05:30'), '2026-11-06');
  assert.equal(bd('2026-11-07T00:00:00+05:30'), '2026-11-07');
  assert.equal(bd('2026-11-06T18:29:59Z'), '2026-11-06'); // 23:59:59 IST
  assert.equal(bd('2026-11-06T18:30:00Z'), '2026-11-07'); // 00:00:00 IST
  assert.equal(bd('2026-11-06T20:00:00-05:00'), '2026-11-07'); // 06:30 IST next day
  assert.equal(bd('2026-12-31T19:00:00Z'), '2027-01-01');
});

test('parseInstant demands an explicit offset and a real calendar date', () => {
  assert.equal(parseInstant('2026-11-06T10:00:00'), null);       // no offset: ambiguous
  assert.equal(parseInstant('2026-11-06 10:00:00Z'), null);
  assert.equal(parseInstant('2026-02-30T10:00:00Z'), null);
  assert.equal(parseInstant('2026-13-01T10:00:00Z'), null);
  assert.equal(parseInstant('2026-11-06T24:00:00Z'), null);
  assert.equal(parseInstant('2026-11-06T10:61:00Z'), null);
  assert.equal(parseInstant('1999-01-01T00:00:00Z'), null);
  assert.ok(parseInstant('2026-11-06T10:00Z'));
  assert.ok(parseInstant('2026-11-06T10:00:00.123+05:30'));
});

test('date-only helpers', () => {
  assert.equal(isValidDateOnly('2026-02-28'), true);
  assert.equal(isValidDateOnly('2026-02-29'), false);
  assert.equal(isValidDateOnly('2028-02-29'), true);
  assert.equal(isValidDateOnly('06/11/2026'), false);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-06', '2026-11-09'), 3);
  assert.equal(diffDays('2026-11-09', '2026-11-06'), -3);
});
