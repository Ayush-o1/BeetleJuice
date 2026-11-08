'use strict';

const express = require('express');
const { requirePermission } = require('../../middleware/auth');

/** Every figure here is computed from persisted rows at request time — nothing is hard-coded. */
function overviewRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('overview:read'), async (req, res) => {
    const [files, runs, latest, byType, totals, review, mine, ageing, activity, failed] = await Promise.all([
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
      // Ageing of unresolved breaks, in IST calendar days since the break's reference date.
      pool.query(`SELECT CASE WHEN age <= 1 THEN 'd0_1' WHEN age <= 3 THEN 'd2_3' WHEN age <= 7 THEN 'd4_7' ELSE 'd8_plus' END AS bucket,
                         count(*)::int AS count, COALESCE(sum(impact_paise),0)::bigint AS "impactPaise"
                    FROM (SELECT impact_paise, GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - reference_date) AS age
                            FROM breaks WHERE status <> 'resolved') b GROUP BY 1`),
      // Recent business activity from the data tables every role may read (not the audit log, which is permissioned).
      pool.query(`(SELECT 'upload' AS type, f.uploaded_at AS at, u.display_name AS actor, f.id AS "refId", f.original_filename AS label,
                          jsonb_build_object('kind', f.kind, 'accepted', f.accepted_rows, 'rejected', f.rejected_rows) AS detail
                     FROM source_files f JOIN users u ON u.id = f.uploaded_by ORDER BY f.uploaded_at DESC LIMIT 6)
                  UNION ALL
                  (SELECT 'run_' || r.status, r.finished_at, NULL, r.id, NULL, jsonb_build_object('matched', r.summary->'matched', 'pending', r.summary->'pending', 'totalBreaks', r.summary->'totalBreaks', 'errorCode', r.error_code)
                     FROM reconciliation_runs r WHERE r.status IN ('completed','failed') ORDER BY r.finished_at DESC LIMIT 6)
                  UNION ALL
                  (SELECT 'decision_' || d.decision, d.decided_at, u.display_name, p.break_id, b.reference, jsonb_build_object('resolution', p.resolution_code, 'breakId', p.break_id)
                     FROM resolution_decisions d JOIN resolution_proposals p ON p.id = d.proposal_id JOIN breaks b ON b.id = p.break_id JOIN users u ON u.id = d.decided_by
                    ORDER BY d.decided_at DESC LIMIT 6)
                  ORDER BY at DESC LIMIT 8`),
      pool.query(`SELECT r.id, r.finished_at AS "finishedAt", r.error_code AS "errorCode" FROM reconciliation_runs r
                   WHERE r.status = 'failed' AND r.finished_at > now() - interval '7 days' ORDER BY r.finished_at DESC LIMIT 3`),
    ]);
    const buckets = Object.fromEntries(ageing.rows.map((r) => [r.bucket, r]));
    const kinds = Object.fromEntries(files.rows.map((r) => [r.kind, r]));
    const runCounts = Object.fromEntries(runs.rows.map((r) => [r.status, r.n]));
    res.json({
      data: {
        sources: { ledgerFiles: kinds.ledger?.n ?? 0, settlementFiles: kinds.settlement?.n ?? 0 },
        runs: { queued: runCounts.queued ?? 0, running: runCounts.running ?? 0, completed: runCounts.completed ?? 0, failed: runCounts.failed ?? 0 },
        latestRun: latest.rows[0] || null,
        breaks: { ...totals.rows[0], byType: byType.rows },
        ageing: ['d0_1', 'd2_3', 'd4_7', 'd8_plus'].map((k) => ({ bucket: k, count: buckets[k]?.count ?? 0, impactPaise: buckets[k]?.impactPaise ?? 0 })),
        recentActivity: activity.rows,
        recentFailures: failed.rows,
        awaitingReview: review.rows[0].n,
        myAwaitingReview: mine.rows[0].n,
      },
    });
  });

  return router;
}

module.exports = { overviewRoutes };
