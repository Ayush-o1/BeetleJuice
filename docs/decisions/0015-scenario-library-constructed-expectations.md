# 0015 — Scenario library with constructed expectations

**Status:** accepted (v1.1.0). Extends [0011](0011-testing-strategy.md).

**Problem.** One 330-row demo cannot show different operational situations or regress them individually, and a test that compares the engine with *its own output* proves nothing.

**Decision.** `scripts/lib/scenario-library.js` generates ten scenarios at four sizes from `(name, size, seed)`. Each injection function creates the records **and increments the expected outcome**
(matched, pending, each break type, which batches are broken, which rows are rejected and why). Tests run the real parsers and engine and demand an exact match, then check invariants (one result per record,
no silent amount match, order independence, repeatability). Small sets are committed and checked for staleness; larger sizes are generated on demand.

**Consequences.** A bug in the engine and a matching bug in the generator would have to be the same mistake in two independent descriptions of the same rule; the generator follows the written rules, not the engine's code.
A mutation of the generator is caught (verified). Scenario sizes are bounded by the upload row limit (xl ≈ 28k rows). The generator is not a statistical model of real traffic and does not try to be.

**Rejected.** A property-testing library (generators already exist; a dependency would not add coverage); random data without a seed; snapshotting engine output as "expected".
