# 0007 — Maker-checker: row locks, version check and database backstops

**Status:** accepted.

**Decision.** Propose and decide run in one transaction that locks the break row (`FOR UPDATE`), then the proposal
(always that order, so no deadlock). Callers send the `breakVersion` they saw; a mismatch is a 409 — never silently
applied to a changed break. Under READ COMMITTED a second reviewer blocks on the lock, re-reads committed state and
gets 409. Independently, partial unique indexes (≤1 pending, ≤1 approved proposal per break), a trigger that requires
the decider to be a supervisor other than the proposer, and status-transition triggers mean a buggy or bypassed
service still cannot store an invalid state. Decision, break update and audit rows commit together.

**Alternatives.** Optimistic-only (version column without locks): works, but the lock gives a simple ordering of
decisions and clearer errors. `SERIALIZABLE` with retries: heavier than needed for a single hot row.

**Consequences.** The "blocked self-approval" audit row is written after rollback on a separate connection; writing
it inside the transaction would be rolled back, and writing it concurrently would wait on the transaction's own lock.
