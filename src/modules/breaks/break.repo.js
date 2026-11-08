'use strict';

const { orderBy } = require('../../lib/paging');

const AGE_SQL = "((COALESCE(b.resolved_at, now()) AT TIME ZONE 'Asia/Kolkata')::date - b.reference_date)";

const SORTS = {
  age: AGE_SQL, impact: 'b.impact_paise', date: 'b.reference_date', type: 'b.break_type',
  status: 'b.status', reference: 'b.reference', created: 'b.id',
};

/** Builds the WHERE clause for the queue from validated filters. Every value is a bind parameter. */
function buildWhere(f) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.status === 'unresolved') where.push("b.status IN ('open','pending_review')");
  else if (f.status) add('b.status = ?', f.status);
  if (f.type) add('b.break_type = ?', f.type);
  if (f.side) add('b.side = ?', f.side);
  if (f.runId) add('b.run_id = ?', f.runId);
  if (f.batch) add('b.batch_ref = ?', f.batch);
  if (f.q) add("b.reference ILIKE ? ESCAPE '\\'", `%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
  if (f.minAmountPaise != null) add('b.impact_paise >= ?', f.minAmountPaise);
  if (f.maxAmountPaise != null) add('b.impact_paise <= ?', f.maxAmountPaise);
  if (f.minAge != null) add(`${AGE_SQL} >= ?`, f.minAge);
  if (f.maxAge != null) add(`${AGE_SQL} <= ?`, f.maxAge);
  if (f.from) add('b.reference_date >= ?', f.from);
  if (f.to) add('b.reference_date <= ?', f.to);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const LIST_SELECT = `
  SELECT b.id, b.run_id AS "runId", b.break_type AS "type", b.status, b.version, b.side, b.reference, b.batch_ref AS "batchRef",
         b.impact_paise AS "impactPaise", b.reference_date AS "referenceDate", ${AGE_SQL} AS "ageDays",
         b.created_at AS "createdAt", m.rule_id AS "ruleId", m.explanation, m.amount_diff_paise AS "amountDiffPaise",
         le.amount_paise AS "ledgerAmountPaise", sl.amount_paise AS "settlementAmountPaise"
    FROM breaks b
    JOIN match_results m ON m.id = b.match_result_id
    LEFT JOIN ledger_entries le ON le.id = m.ledger_entry_id
    LEFT JOIN settlement_lines sl ON sl.id = m.settlement_line_id`;

async function list(db, filters, { limit, offset, sort }) {
  const w = buildWhere(filters);
  const total = (await db.query(`SELECT count(*)::int AS n FROM breaks b ${w.sql}`, w.params)).rows[0].n;
  const order = orderBy(sort, SORTS, `${AGE_SQL} DESC`, 'b.id DESC');
  const { rows } = await db.query(`${LIST_SELECT} ${w.sql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, w.params);
  return { rows, total };
}

async function listForExport(db, filters, max = 10000) {
  const w = buildWhere(filters);
  const { rows } = await db.query(`${LIST_SELECT} ${w.sql} ORDER BY ${AGE_SQL} DESC, b.id DESC LIMIT ${max}`, w.params);
  return rows;
}

async function getBreakRow(db, id) {
  const { rows } = await db.query(
    `SELECT b.id, b.run_id AS "runId", b.match_result_id AS "matchResultId", b.break_type AS "type", b.status, b.version, b.side,
            b.reference, b.batch_ref AS "batchRef", b.impact_paise AS "impactPaise", b.reference_date AS "referenceDate",
            ${AGE_SQL} AS "ageDays", (r.as_of_date - b.reference_date) AS "ageAtRunDays",
            b.created_at AS "createdAt", b.status_changed_at AS "statusChangedAt", b.resolved_at AS "resolvedAt", b.resolution_code AS "resolutionCode",
            r.as_of_date AS "runAsOfDate", r.status AS "runStatus", r.config_snapshot AS "runConfig"
       FROM breaks b JOIN reconciliation_runs r ON r.id = b.run_id WHERE b.id = $1`, [id]);
  return rows[0] || null;
}

async function getResult(db, matchResultId) {
  const { rows } = await db.query(
    `SELECT id, scope, outcome, break_type AS "breakType", rule_id AS "ruleId", explanation, amount_diff_paise AS "amountDiffPaise",
            expected_fee_paise AS "expectedFeePaise", actual_fee_paise AS "actualFeePaise", group_key AS "groupKey",
            ledger_entry_id AS "ledgerEntryId", settlement_line_id AS "settlementLineId", details
       FROM match_results WHERE id = $1`, [matchResultId]);
  return rows[0] || null;
}

const LEDGER_COLS = `id, source_file_id AS "sourceFileId", row_number AS "rowNumber", ledger_id AS "ledgerId", reference, merchant,
  entry_type AS "entryType", amount_paise AS "amountPaise", currency, recorded_at AS "recordedAt", business_date AS "businessDate"`;
const LINE_COLS = `id, source_file_id AS "sourceFileId", row_number AS "rowNumber", line_id AS "lineId", batch_ref AS "batchRef", reference,
  txn_type AS "txnType", amount_paise AS "amountPaise", fee_paise AS "feePaise", currency, settled_on AS "settledOn"`;

async function getLedgerEntry(db, id) {
  if (!id) return null;
  return (await db.query(`SELECT ${LEDGER_COLS} FROM ledger_entries WHERE id = $1`, [id])).rows[0] || null;
}
async function getSettlementLine(db, id) {
  if (!id) return null;
  return (await db.query(`SELECT ${LINE_COLS} FROM settlement_lines WHERE id = $1`, [id])).rows[0] || null;
}

/** Other records in the same run's sources that share the reference — context for duplicates and ambiguity. */
async function relatedRecords(db, runId, reference, excludeLedgerId, excludeLineId) {
  const run = (await db.query('SELECT ledger_file_id, settlement_file_id FROM reconciliation_runs WHERE id = $1', [runId])).rows[0];
  const ledger = (await db.query(`SELECT ${LEDGER_COLS} FROM ledger_entries WHERE source_file_id = $1 AND reference = $2 AND id <> COALESCE($3, 0) ORDER BY row_number`,
    [run.ledger_file_id, reference, excludeLedgerId])).rows;
  const settlement = (await db.query(`SELECT ${LINE_COLS} FROM settlement_lines WHERE source_file_id = $1 AND reference = $2 AND id <> COALESCE($3, 0) ORDER BY row_number`,
    [run.settlement_file_id, reference, excludeLineId])).rows;
  return { ledger, settlement };
}

async function getBatchContext(db, runId, batchRef) {
  if (!batchRef) return null;
  const run = (await db.query('SELECT settlement_file_id FROM reconciliation_runs WHERE id = $1', [runId])).rows[0];
  const summary = (await db.query(
    `SELECT batch_ref AS "batchRef", settled_on AS "settledOn", declared_gross_paise AS "declaredGrossPaise",
            declared_fee_paise AS "declaredFeePaise", declared_payout_paise AS "declaredPayoutPaise"
       FROM settlement_batches WHERE source_file_id = $1 AND batch_ref = $2`, [run.settlement_file_id, batchRef])).rows[0] || null;
  const result = (await db.query(
    `SELECT outcome, rule_id AS "ruleId", explanation, details, amount_diff_paise AS "amountDiffPaise"
       FROM match_results WHERE run_id = $1 AND scope = 'BATCH' AND batch_ref = $2`, [runId, batchRef])).rows[0] || null;
  return { summary, result };
}

async function listNotes(db, breakId) {
  const { rows } = await db.query(
    `SELECT n.id, n.body, n.created_at AS "createdAt", u.username AS "author", u.display_name AS "authorName"
       FROM break_notes n JOIN users u ON u.id = n.author_id WHERE n.break_id = $1 ORDER BY n.created_at, n.id`, [breakId]);
  return rows;
}

async function insertNote(db, breakId, authorId, body) {
  const { rows } = await db.query(
    'INSERT INTO break_notes (break_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, created_at AS "createdAt"', [breakId, authorId, body]);
  return rows[0];
}

async function lockBreak(db, id) {
  const { rows } = await db.query('SELECT id, status, version, run_id AS "runId", break_type AS "type", reference FROM breaks WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

module.exports = {
  list, listForExport, getBreakRow, getResult, getLedgerEntry, getSettlementLine, relatedRecords, getBatchContext,
  listNotes, insertNote, lockBreak,
};
