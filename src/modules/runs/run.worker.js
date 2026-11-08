'use strict';

const crypto = require('node:crypto');
const repo = require('./run.repo');
const audit = require('../audit/audit.service');
const { reconcile } = require('../engine');
const { withTransaction } = require('../../db/pool');

const SYSTEM_ACTOR = { user: null, ip: null, requestId: null };

/**
 * Durable run worker. The reconciliation_runs table is the queue:
 *
 *  claim    one atomic UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1). SKIP LOCKED
 *           lets several workers poll the same table without blocking or double-claiming; the claim
 *           also bumps `attempts` and sets a lease.
 *  lease    a worker that dies leaves status='running' with an expiring lease. Any worker may reclaim
 *           it once the lease lapses, until max_attempts is exhausted, after which the run is failed.
 *  fencing  results are only written if the run is still 'running' AND locked_by is still this worker,
 *           checked under a row lock, so a slow worker that lost its lease cannot clobber a newer attempt.
 *  atomic   all results, breaks, audit rows and the completed status go in ONE transaction, so a crash
 *           can never leave partial output.
 */
function createWorker(ctx, { workerId = `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`, engine = reconcile } = {}) {
  const { pool, config, logger } = ctx;
  let timer = null;
  let stopping = false;
  let current = null;

  async function failExhausted() {
    const { rows } = await pool.query(
      `UPDATE reconciliation_runs
          SET status = 'failed', finished_at = now(), error_code = 'WORKER_LOST',
              error_message = 'The worker stopped responding and the retry limit was reached', locked_by = NULL, lease_expires_at = NULL
        WHERE status = 'running' AND lease_expires_at < now() AND attempts >= max_attempts
        RETURNING id`);
    for (const r of rows) {
      await audit.record(pool, SYSTEM_ACTOR, { action: 'run.failed', entityType: 'run', entityId: r.id, relatedRunId: r.id, context: { code: 'WORKER_LOST' } });
    }
  }

  async function claim() {
    await failExhausted();
    const { rows } = await pool.query(
      `UPDATE reconciliation_runs r
          SET status = 'running', attempts = r.attempts + 1, locked_by = $1, started_at = now(),
              lease_expires_at = now() + make_interval(secs => $2)
         FROM (SELECT id FROM reconciliation_runs
                WHERE status = 'queued' OR (status = 'running' AND lease_expires_at < now())
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED LIMIT 1) next
        WHERE r.id = next.id
        RETURNING r.id, r.ledger_file_id, r.settlement_file_id, r.config_snapshot, r.attempts, r.max_attempts`,
      [workerId, config.runLeaseSeconds]);
    return rows[0] || null;
  }

  async function heartbeat(runId) {
    await pool.query(
      `UPDATE reconciliation_runs SET lease_expires_at = now() + make_interval(secs => $3)
        WHERE id = $1 AND status = 'running' AND locked_by = $2`, [runId, workerId, config.runLeaseSeconds]);
  }

  async function execute(run) {
    const started = Date.now();
    const input = await repo.loadEngineInput(pool, run);
    const out = engine({ ...input, config: run.config_snapshot });
    const summary = { ...out.summary, execution: { engineVersion: out.engineVersion, durationMs: Date.now() - started, attempt: run.attempts, workerId } };

    await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query(
        "SELECT id FROM reconciliation_runs WHERE id = $1 AND status = 'running' AND locked_by = $2 FOR UPDATE", [run.id, workerId]);
      if (rows.length === 0) throw Object.assign(new Error('lease lost before results were written'), { code: 'LEASE_LOST' });

      await repo.insertResults(tx, run.id, out.results);
      const breaks = await repo.createBreaks(tx, run.id);
      await tx.query(
        `UPDATE reconciliation_runs SET status = 'completed', finished_at = now(), summary = $2, locked_by = NULL,
                lease_expires_at = NULL, error_code = NULL, error_message = NULL WHERE id = $1`, [run.id, JSON.stringify(summary)]);
      // One audit row per break, written set-wise inside the same transaction.
      await tx.query(
        `INSERT INTO audit_events (action, entity_type, entity_id, related_run_id, related_break_id, context)
         SELECT 'break.created', 'break', b.id::text, b.run_id, b.id,
                jsonb_build_object('breakType', b.break_type, 'reference', b.reference, 'impactPaise', b.impact_paise)
           FROM breaks b WHERE b.run_id = $1 ORDER BY b.id`, [run.id]);
      await audit.record(tx, SYSTEM_ACTOR, {
        action: 'run.completed', entityType: 'run', entityId: run.id, relatedRunId: run.id,
        context: { matched: summary.matched, pending: summary.pending, breaks: breaks.length, totalBreaks: summary.totalBreaks, durationMs: summary.execution.durationMs },
      });
    });
  }

  /** Failure policy: re-queue while attempts remain, otherwise mark failed. Fenced on this worker's claim. */
  async function recordFailure(run, err) {
    if (err.code === 'LEASE_LOST') return; // someone else owns the run now; do not touch it
    const code = String(err.code && /^[A-Z0-9_]{3,40}$/.test(err.code) ? err.code : 'ENGINE_ERROR');
    const message = String(err.message || 'unknown error').slice(0, 300);
    const retry = run.attempts < run.max_attempts;
    await withTransaction(pool, async (tx) => {
      const res = await tx.query(
        retry
          ? `UPDATE reconciliation_runs SET status = 'queued', locked_by = NULL, lease_expires_at = NULL, error_code = $3, error_message = $4
              WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING id`
          : `UPDATE reconciliation_runs SET status = 'failed', finished_at = now(), locked_by = NULL, lease_expires_at = NULL, error_code = $3, error_message = $4
              WHERE id = $1 AND status = 'running' AND locked_by = $2 RETURNING id`,
        [run.id, workerId, code, message]);
      if (res.rowCount === 1) {
        await audit.record(tx, SYSTEM_ACTOR, {
          action: retry ? 'run.retry_scheduled' : 'run.failed', entityType: 'run', entityId: run.id, relatedRunId: run.id,
          context: { code, message, attempt: run.attempts, maxAttempts: run.max_attempts },
        });
      }
    });
  }

  /** Claims and executes at most one run. Returns the run id processed, or null if the queue was empty. */
  async function processNext() {
    const run = await claim();
    if (!run) return null;
    current = run.id;
    const beat = setInterval(() => heartbeat(run.id).catch((e) => logger.warn({ err: e.message }, 'heartbeat failed')), Math.max(1000, (config.runLeaseSeconds * 1000) / 3));
    try {
      await execute(run);
      logger.info({ runId: run.id, workerId }, 'run completed');
    } catch (err) {
      logger.error({ runId: run.id, workerId, err: { message: err.message, code: err.code } }, 'run attempt failed');
      await recordFailure(run, err);
    } finally {
      clearInterval(beat);
      current = null;
    }
    return run.id;
  }

  async function loop() {
    if (stopping) return;
    let didWork = false;
    try { didWork = (await processNext()) !== null; } catch (err) { logger.error({ err: err.message }, 'worker poll failed'); }
    if (!stopping) timer = setTimeout(loop, didWork ? 0 : config.workerPollMs);
  }

  return {
    workerId,
    processNext,
    start() { stopping = false; timer = setTimeout(loop, 0); },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      while (current !== null) await new Promise((r) => setTimeout(r, 25)); // let an in-flight run finish
    },
  };
}

module.exports = { createWorker };
