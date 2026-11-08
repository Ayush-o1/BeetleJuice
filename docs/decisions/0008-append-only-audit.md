# 0008 — Append-only audit and immutable history via triggers

**Status:** accepted, with stated limits.

**Decision.** `audit_events` and every table that records facts (sources, results, settings versions, decisions,
notes) reject `UPDATE`/`DELETE` (and `TRUNCATE` for audit) through a shared `forbid_mutation()` trigger. Mutable
work-item tables (runs, breaks, proposals) enforce allowed transitions with triggers. Audit rows are written inside
the same transaction as the change they describe.

**Limits.** This is application-level append-only history with database protections. The table owner can drop a
trigger, and there is no hash chain or external anchor, so it is **not** tamper-proof and the documentation never
claims it is. Deployment guidance: run the app as a non-owner role and export the log to write-once storage.

**Alternatives.** Revoking privileges only (does nothing to the owner role); hash chaining (adds complexity without
solving the owner problem alone); a separate event store (more infrastructure).
