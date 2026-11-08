'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/auth');

/** Every figure here is computed from persisted rows at request time — nothing is hard-coded. */
function overviewRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('overview:read'), async (req, res) => {
    const [files, runs, latest, byType, totals, review, mine] = await Promise.all([
      pool.query("SELECT kind, count(*)::int AS n, max(uploaded_at) AS \"lastUploadedAt\" FROM source_files GROUP BY kind"),
      pool.query("SELECT status, count(*)::int AS n FROM reconciliation_runs GROUP BY status"),
      pool.query(`SELECT r.id, r.as_of_date AS "asOfDate", r.finished_at AS "finishedAt", r.summary,
                         lf.original_filename AS "ledgerFilename", sf.original_filename AS "settlementFilename"
                    FROM reconciliation_runs r JOIN source_files lf ON lf.id = r.ledger_file_id JOIN source_files sf ON sf.id = r.settlement_file_id
                   WHERE r.status = 'completed' ORDER BY r.finished_at DESC, r.id DESC LIMIT 1`),
      pool.query(`SELECT break_type AS type, count(*)::int AS count, COALESCE(sum(impact_paise),0)::bigint AS "impactPaise"
                    FROM breaks WHERE status <> 'resolved' GROUP BY break_type ORDER BY count DESC, break_type`),
      pool.query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
                         count(*) FILTER (WHERE status = 'pending_review')::int AS "pendingReview",
                         count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                         COALESCE(sum(impact_paise) FILTER (WHERE status <> 'resolved'),0)::bigint AS "unresolvedImpactPaise",
                         max((now() AT TIME ZONE 'Asia/Kolkata')::date - reference_date) FILTER (WHERE status <> 'resolved') AS "oldestUnresolvedDays"
                    FROM breaks`),
      pool.query("SELECT count(*)::int AS n FROM resolution_proposals WHERE status = 'pending'"),
      pool.query("SELECT count(*)::int AS n FROM resolution_proposals WHERE status = 'pending' AND proposed_by = $1", [req.user.id]),
    ]);
    const kinds = Object.fromEntries(files.rows.map((r) => [r.kind, r]));
    const runCounts = Object.fromEntries(runs.rows.map((r) => [r.status, r.n]));
    res.json({
      data: {
        sources: { ledgerFiles: kinds.ledger?.n ?? 0, settlementFiles: kinds.settlement?.n ?? 0 },
        runs: { queued: runCounts.queued ?? 0, running: runCounts.running ?? 0, completed: runCounts.completed ?? 0, failed: runCounts.failed ?? 0 },
        latestRun: latest.rows[0] || null,
        breaks: { ...totals.rows[0], byType: byType.rows },
        awaitingReview: review.rows[0].n,
        myAwaitingReview: mine.rows[0].n,
      },
    });
  });

  return router;
}

module.exports = { overviewRoutes };
