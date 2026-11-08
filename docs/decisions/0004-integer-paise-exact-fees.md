# 0004 — Money as integer paise, fees as exact rationals

**Status:** accepted.

**Decision.** Amounts are `bigint` paise in PostgreSQL and `Number` paise in JS, bounded (±₹1 crore per line,
±₹1e12 for batch totals) so any sum over a 50,000-row file stays below 2⁵³; sums use a guard that throws if the
safe-integer range is left. CSV amounts are parsed from strings by regex and `BigInt`, never `parseFloat`.
Percentage fees are `BigInt` rationals: `fee = round_half_up(amount × rate_num / rate_den)` with the rate stored as
`numeric(7,4)` and parsed from its decimal text. Rounding is half-up, away from zero, defined once in `src/lib/rate.js`.

**Alternatives.** `numeric` end to end: exact, but JS would still need a decimal library. A decimal library
(big.js/decimal.js): reasonable, but one small function covers the one operation (percentage of an integer).
Floats: rejected (`4.35*100 = 434.99999999999994`).

**Consequences.** `pg` is configured to return `bigint` as `Number` and throws if a value ever exceeds the safe range.
Per-line caps are a business limit documented in the upload errors.
