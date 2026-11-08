# 0006 — A pure, multi-pass engine with an explicit ambiguity guard

**Status:** accepted.

**Decision.** `reconcile(input)` is a pure function over in-memory records. Records are grouped by
`(reference, direction)`; fixed passes claim records in order (R01, R02, R09, R03, R04, R05, R06, then batch R07 and
fee R08). Anything with candidates on both sides that does not pair one-to-one becomes an explicit
`AMBIGUOUS_REFERENCE` break rather than a guess. The as-of date is configuration, so no clock is read.

**Alternatives.** A single SQL join per rule: fast, but expressing "pair equal amounts in file order, then leave a
surplus" and its explanation text in SQL is opaque. Greedy first-match: silently mis-pairs repeated references.
Subset-sum for batches: unnecessary because processors give batch ids.

**Consequences.** Trivially testable (fixtures, property-style invariant, shuffled-input determinism, constructed
ground truth). Results are stored, so history never depends on code changes (engine version is in each snapshot).
Cost: all inputs fit in memory (bounded by the row limit).
