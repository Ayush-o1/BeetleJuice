'use strict';

const RUN_COLS = `r.id, r.status, r.as_of_date AS "asOfDate", r.created_at AS "createdAt", r.started_at AS "startedAt",
  r.finished_at AS "finishedAt", r.attempts, r.max_attempts AS "maxAttempts", r.error_code AS "errorCode",
  r.error_message AS "errorMessage", r.summary, r.config_snapshot AS config,
  r.ledger_file_id AS "ledgerFileId", r.settlement_file_id AS "settlementFileId",
  lf.original_filename AS "ledgerFilename", sf.original_filename AS "settlementFilename",
  u.username AS "createdBy", u.display_name AS "createdByName"`;
const RUN_FROM = `FROM reconciliation_runs r
  JOIN source_files lf ON lf.id = r.ledger_file_id JOIN source_files sf ON sf.id = r.settlement_file_id
  JOIN users u ON u.id = r.created_by`;

async function insertQueued(db, run) {
  const { rows } = await db.query(
    `INSERT INTO reconciliation_runs
       (ledger_file_id, settlement_file_id, as_of_date, config_snapshot, input_fingerprint, created_by, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (input_fingerprint) WHERE status <> 'failed' DO NOTHING
     RETURNING id`,
    [run.ledgerFileId, run.settlementFileId, run.asOfDate, JSON.stringify(run.config), run.fingerprint, run.createdBy, run.maxAttempts],
  );
  return rows[0] || null;
}

async function findActiveByFingerprint(db, fingerprint) {
  const { rows } = await db.query("SELECT id, status FROM reconciliation_runs WHERE input_fingerprint = $1 AND status <> 'failed'", [fingerprint]);
  return rows[0] || null;
}

async function getRun(db, id) {
  const { rows } = await db.query(`SELECT ${RUN_COLS} ${RUN_FROM} WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

async function listRuns(db, { status, limit, offset }) {
  const params = status ? [status] : [];
  const where = status ? 'WHERE r.status = $1' : '';
  const total = (await db.query(`SELECT count(*)::int AS n FROM reconciliation_runs r ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${RUN_COLS}, (SELECT count(*)::int FROM breaks b WHERE b.run_id = r.id AND b.status <> 'resolved') AS "openBreaks"
       ${RUN_FROM} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { rows, total };
}

async function loadEngineInput(db, run) {
  const ledger = (await db.query(
    `SELECT id, ledger_id AS "sourceId", reference, amount_paise AS "amountPaise", business_date AS "businessDate", row_number AS "rowNumber"
       FROM ledger_entries WHERE source_file_id = $1 ORDER BY row_number`, [run.ledger_file_id])).rows
    .map((r) => ({ ...r, direction: r.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  const settlement = (await db.query(
    `SELECT id, line_id AS "sourceId", reference, amount_paise AS "amountPaise", fee_paise AS "feePaise", batch_ref AS "batchRef",
            settled_on AS "settledOn", row_number AS "rowNumber"
       FROM settlement_lines WHERE source_file_id = $1 ORDER BY row_number`, [run.settlement_file_id])).rows
    .map((r) => ({ ...r, direction: r.amountPaise < 0 ? 'REFUND' : 'PAYMENT' }));
  const batches = (await db.query(
    `SELECT batch_ref AS "batchRef", settled_on AS "settledOn", declared_gross_paise AS "declaredGrossPaise",
            declared_fee_paise AS "declaredFeePaise", declared_payout_paise AS "declaredPayoutPaise"
       FROM settlement_batches WHERE source_file_id = $1 ORDER BY row_number`, [run.settlement_file_id])).rows;
  return { ledger, settlement, batches };
}

const CHUNK = 2000;
async function insertResults(db, runId, results) {
  for (let i = 0; i < results.length; i += CHUNK) {
    const p = results.slice(i, i + CHUNK);
    const col = (f) => p.map(f);
    await db.query(
      `INSERT INTO match_results
         (run_id, scope, outcome, break_type, rule_id, explanation, ledger_entry_id, settlement_line_id, batch_ref, reference,
          group_key, amount_diff_paise, impact_paise, expected_fee_paise, actual_fee_paise, reference_date, details)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::bigint[], $9::text[], $10::text[],
          $11::text[], $12::bigint[], $13::bigint[], $14::bigint[], $15::bigint[], $16::date[], $17::jsonb[])`,
      [runId, col((r) => r.scope), col((r) => r.outcome), col((r) => r.breakType), col((r) => r.ruleId), col((r) => r.explanation),
        col((r) => r.ledgerEntryId ?? null), col((r) => r.settlementLineId ?? null), col((r) => r.batchRef ?? null), col((r) => r.reference),
        col((r) => r.groupKey), col((r) => r.amountDiffPaise ?? null), col((r) => r.impactPaise), col((r) => r.expectedFeePaise ?? null),
        col((r) => r.actualFeePaise ?? null), col((r) => r.referenceDate), col((r) => JSON.stringify(r.details ?? {}))],
    );
  }
}

/** One break work item per BREAK result, copying the descriptive columns used by the queue filters. */
async function createBreaks(db, runId) {
  const { rows } = await db.query(
    `INSERT INTO breaks (run_id, match_result_id, break_type, side, reference, batch_ref, impact_paise, reference_date)
     SELECT m.run_id, m.id, m.break_type,
            CASE WHEN m.scope = 'BATCH' THEN 'settlement'
                 WHEN m.ledger_entry_id IS NOT NULL AND m.settlement_line_id IS NOT NULL THEN 'both'
                 WHEN m.ledger_entry_id IS NOT NULL THEN 'ledger' ELSE 'settlement' END,
            m.reference,
            COALESCE(m.batch_ref, (SELECT s.batch_ref FROM settlement_lines s WHERE s.id = m.settlement_line_id)),
            m.impact_paise, m.reference_date
       FROM match_results m WHERE m.run_id = $1 AND m.outcome = 'BREAK'
      ORDER BY m.id
     RETURNING id, break_type AS "breakType"`, [runId]);
  return rows;
}

module.exports = { insertQueued, findActiveByFingerprint, getRun, listRuns, loadEngineInput, insertResults, createBreaks };
