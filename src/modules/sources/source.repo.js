'use strict';

const CHUNK = 2000;
const chunks = (arr) => Array.from({ length: Math.ceil(arr.length / CHUNK) }, (_, i) => arr.slice(i * CHUNK, (i + 1) * CHUNK));

/** ON CONFLICT DO NOTHING + the unique (kind, sha256) index = race-free duplicate detection. */
async function insertFile(db, f) {
  const { rows } = await db.query(
    `INSERT INTO source_files
       (kind, original_filename, content_sha256, size_bytes, total_rows, accepted_rows, rejected_rows, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (kind, content_sha256) DO NOTHING
     RETURNING id, uploaded_at AS "uploadedAt"`,
    [f.kind, f.filename, f.sha256, f.sizeBytes, f.totalRows, f.acceptedRows, f.rejectedRows, f.uploadedBy],
  );
  return rows[0] || null;
}

async function findDuplicate(db, kind, sha256) {
  const { rows } = await db.query(
    'SELECT id, original_filename AS "filename", uploaded_at AS "uploadedAt" FROM source_files WHERE kind = $1 AND content_sha256 = $2',
    [kind, sha256],
  );
  return rows[0] || null;
}

async function insertLedgerEntries(db, fileId, entries) {
  for (const part of chunks(entries)) {
    await db.query(
      `INSERT INTO ledger_entries (source_file_id, row_number, ledger_id, reference, merchant, entry_type, amount_paise, currency, recorded_at)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::text[], $9::timestamptz[])`,
      [fileId, part.map((e) => e.rowNumber), part.map((e) => e.ledgerId), part.map((e) => e.reference), part.map((e) => e.merchant),
        part.map((e) => e.entryType), part.map((e) => e.amountPaise), part.map((e) => e.currency), part.map((e) => e.recordedAt)],
    );
  }
}

async function insertSettlementLines(db, fileId, lines) {
  for (const part of chunks(lines)) {
    await db.query(
      `INSERT INTO settlement_lines (source_file_id, row_number, line_id, batch_ref, reference, txn_type, amount_paise, fee_paise, currency, settled_on)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::bigint[], $9::text[], $10::date[])`,
      [fileId, part.map((e) => e.rowNumber), part.map((e) => e.lineId), part.map((e) => e.batchRef), part.map((e) => e.reference),
        part.map((e) => e.txnType), part.map((e) => e.amountPaise), part.map((e) => e.feePaise), part.map((e) => e.currency), part.map((e) => e.settledOn)],
    );
  }
}

async function insertBatches(db, fileId, batches) {
  for (const part of chunks(batches)) {
    await db.query(
      `INSERT INTO settlement_batches (source_file_id, row_number, batch_ref, settled_on, declared_gross_paise, declared_fee_paise, declared_payout_paise)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::date[], $5::bigint[], $6::bigint[], $7::bigint[])`,
      [fileId, part.map((e) => e.rowNumber), part.map((e) => e.batchRef), part.map((e) => e.settledOn),
        part.map((e) => e.declaredGrossPaise), part.map((e) => e.declaredFeePaise), part.map((e) => e.declaredPayoutPaise)],
    );
  }
}

async function insertRowErrors(db, fileId, errors) {
  for (const part of chunks(errors)) {
    await db.query(
      `INSERT INTO source_row_errors (source_file_id, row_number, line_number, field, code, message, raw_excerpt)
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[])`,
      [fileId, part.map((e) => e.rowNumber), part.map((e) => e.lineNumber), part.map((e) => e.field ?? null),
        part.map((e) => e.code), part.map((e) => e.message), part.map((e) => e.rawExcerpt ?? null)],
    );
  }
}

const FILE_SELECT = `
  SELECT f.id, f.kind, f.original_filename AS filename, f.content_sha256 AS sha256, f.size_bytes AS "sizeBytes",
         f.total_rows AS "totalRows", f.accepted_rows AS "acceptedRows", f.rejected_rows AS "rejectedRows",
         f.uploaded_at AS "uploadedAt", u.username AS "uploadedBy", u.display_name AS "uploadedByName",
         (SELECT count(*)::int FROM reconciliation_runs r WHERE r.ledger_file_id = f.id OR r.settlement_file_id = f.id) AS "runCount"
    FROM source_files f JOIN users u ON u.id = f.uploaded_by`;

async function listFiles(db, { kind, limit, offset }) {
  const where = kind ? 'WHERE f.kind = $1' : '';
  const params = kind ? [kind] : [];
  const total = (await db.query(`SELECT count(*)::int AS n FROM source_files f ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `${FILE_SELECT} ${where} ORDER BY f.uploaded_at DESC, f.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { rows, total };
}

async function getFile(db, id) {
  const { rows } = await db.query(`${FILE_SELECT} WHERE f.id = $1`, [id]);
  return rows[0] || null;
}

async function errorSummary(db, fileId) {
  const { rows } = await db.query(
    'SELECT code, count(*)::int AS count FROM source_row_errors WHERE source_file_id = $1 GROUP BY code ORDER BY count DESC, code', [fileId]);
  return rows;
}

async function listRowErrors(db, fileId, { limit, offset }) {
  const total = (await db.query('SELECT count(*)::int AS n FROM source_row_errors WHERE source_file_id = $1', [fileId])).rows[0].n;
  const { rows } = await db.query(
    `SELECT row_number AS "rowNumber", line_number AS "lineNumber", field, code, message, raw_excerpt AS "rawExcerpt"
       FROM source_row_errors WHERE source_file_id = $1 ORDER BY row_number, id LIMIT ${limit} OFFSET ${offset}`, [fileId]);
  return { rows, total };
}

async function fileTotals(db, file) {
  if (file.kind === 'ledger') {
    const { rows } = await db.query(
      `SELECT count(*)::int AS entries, COALESCE(sum(amount_paise),0)::bigint AS "netPaise",
              min(business_date) AS "firstDate", max(business_date) AS "lastDate"
         FROM ledger_entries WHERE source_file_id = $1`, [file.id]);
    return rows[0];
  }
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM settlement_lines WHERE source_file_id = $1) AS lines,
            (SELECT count(*)::int FROM settlement_batches WHERE source_file_id = $1) AS batches,
            COALESCE((SELECT sum(amount_paise) FROM settlement_lines WHERE source_file_id = $1),0)::bigint AS "grossPaise",
            COALESCE((SELECT sum(fee_paise) FROM settlement_lines WHERE source_file_id = $1),0)::bigint AS "feesPaise",
            (SELECT min(settled_on) FROM settlement_lines WHERE source_file_id = $1) AS "firstDate",
            (SELECT max(settled_on) FROM settlement_lines WHERE source_file_id = $1) AS "lastDate"`, [file.id]);
  return rows[0];
}

async function listRecords(db, file, { view, q, limit, offset }) {
  const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  if (file.kind === 'ledger') {
    const params = [file.id]; let where = 'source_file_id = $1';
    if (like) { params.push(like); where += ` AND (reference ILIKE $2 OR ledger_id ILIKE $2 OR merchant ILIKE $2)`; }
    const total = (await db.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE ${where}`, params)).rows[0].n;
    const { rows } = await db.query(
      `SELECT id, row_number AS "rowNumber", ledger_id AS "ledgerId", reference, merchant, entry_type AS "entryType",
              amount_paise AS "amountPaise", recorded_at AS "recordedAt", business_date AS "businessDate"
         FROM ledger_entries WHERE ${where} ORDER BY row_number LIMIT ${limit} OFFSET ${offset}`, params);
    return { rows, total };
  }
  if (view === 'batches') {
    const total = (await db.query('SELECT count(*)::int AS n FROM settlement_batches WHERE source_file_id = $1', [file.id])).rows[0].n;
    const { rows } = await db.query(
      `SELECT id, row_number AS "rowNumber", batch_ref AS "batchRef", settled_on AS "settledOn",
              declared_gross_paise AS "grossPaise", declared_fee_paise AS "feePaise", declared_payout_paise AS "payoutPaise"
         FROM settlement_batches WHERE source_file_id = $1 ORDER BY row_number LIMIT ${limit} OFFSET ${offset}`, [file.id]);
    return { rows, total };
  }
  const params = [file.id]; let where = 'source_file_id = $1';
  if (like) { params.push(like); where += ` AND (reference ILIKE $2 OR line_id ILIKE $2 OR batch_ref ILIKE $2)`; }
  const total = (await db.query(`SELECT count(*)::int AS n FROM settlement_lines WHERE ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT id, row_number AS "rowNumber", line_id AS "lineId", batch_ref AS "batchRef", reference, txn_type AS "txnType",
            amount_paise AS "amountPaise", fee_paise AS "feePaise", settled_on AS "settledOn"
       FROM settlement_lines WHERE ${where} ORDER BY row_number LIMIT ${limit} OFFSET ${offset}`, params);
  return { rows, total };
}

module.exports = {
  insertFile, findDuplicate, insertLedgerEntries, insertSettlementLines, insertBatches, insertRowErrors,
  listFiles, getFile, errorSummary, listRowErrors, fileTotals, listRecords,
};
