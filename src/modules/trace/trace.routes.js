'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/auth');
const { parseWith } = require('../../lib/validate');

const querySchema = z.object({ reference: z.string().trim().min(2).max(64) });
const LIMIT = 50;

/**
 * "What happened to this reference?" Answers the support question for any reference, matched or not:
 * every ledger entry and settlement line carrying it, and how each completed run classified them.
 * Read-only; same permission as the break queue.
 */
function traceRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('breaks:read'), async (req, res) => {
    const { reference: raw } = parseWith(querySchema, req.query);
    const reference = raw.toUpperCase();           // parsers store references upper-cased
    const [ledger, settlement, results] = await Promise.all([
      pool.query(`SELECT l.id, l.ledger_id AS "ledgerId", l.source_file_id AS "sourceFileId", f.original_filename AS filename, l.row_number AS "rowNumber",
                         l.amount_paise AS "amountPaise", l.entry_type AS "entryType", l.merchant, l.recorded_at AS "recordedAt", l.business_date AS "businessDate"
                    FROM ledger_entries l JOIN source_files f ON f.id = l.source_file_id
                   WHERE l.reference = $1 ORDER BY l.recorded_at DESC, l.id DESC LIMIT ${LIMIT}`, [reference]),
      pool.query(`SELECT s.id, s.line_id AS "lineId", s.source_file_id AS "sourceFileId", f.original_filename AS filename, s.row_number AS "rowNumber", s.batch_ref AS "batchRef",
                         s.amount_paise AS "amountPaise", s.fee_paise AS "feePaise", s.txn_type AS "txnType", s.settled_on AS "settledOn"
                    FROM settlement_lines s JOIN source_files f ON f.id = s.source_file_id
                   WHERE s.reference = $1 ORDER BY s.settled_on DESC, s.id DESC LIMIT ${LIMIT}`, [reference]),
      pool.query(`SELECT m.id, m.run_id AS "runId", r.as_of_date AS "asOfDate", m.outcome, m.break_type AS "breakType", m.rule_id AS "ruleId", m.explanation,
                         m.ledger_entry_id AS "ledgerEntryId", m.settlement_line_id AS "settlementLineId", m.amount_diff_paise AS "amountDiffPaise",
                         b.id AS "breakId", b.status AS "breakStatus"
                    FROM match_results m JOIN reconciliation_runs r ON r.id = m.run_id AND r.status = 'completed'
                    LEFT JOIN breaks b ON b.match_result_id = m.id
                   WHERE m.scope = 'TRANSACTION' AND m.reference = $1 ORDER BY m.run_id DESC, m.id LIMIT ${LIMIT * 2}`, [reference]),
    ]);
    res.json({ data: { reference, ledger: ledger.rows, settlement: settlement.rows, results: results.rows, truncated: ledger.rows.length === LIMIT || settlement.rows.length === LIMIT } });
  });

  return router;
}

module.exports = { traceRoutes };
