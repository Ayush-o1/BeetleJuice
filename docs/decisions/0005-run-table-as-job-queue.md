# 0005 — The runs table is the job queue

**Status:** accepted. **Source consulted:** PostgreSQL docs for `SELECT … FOR UPDATE SKIP LOCKED` (documented
as suitable for queue-like tables with multiple consumers) and READ COMMITTED re-evaluation.

**Decision.** `reconciliation_runs` holds status, attempts, `locked_by` and `lease_expires_at`. A worker claims with
one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, extends the lease by heartbeat, and writes
results only if still `running` and `locked_by` itself (fencing), all in one transaction. A lapsed lease makes the
run claimable again; once `attempts = max_attempts` it is failed (`WORKER_LOST`). Failed attempts re-queue with
the error recorded. A partial unique index on `input_fingerprint WHERE status <> 'failed'` stops duplicate work.

**Alternatives.** Redis/BullMQ, pg-boss: more infrastructure for one job type. In-process `setImmediate`: loses
queued work on restart and cannot be scaled to a second worker.

**Consequences.** Durable, observable (status is the UI), no new service. No priority or delayed retry (retry is
immediate); acceptable for deterministic, seconds-long jobs. The engine is synchronous, so very large runs should
use a separate worker process (see performance).
