'use strict';

const repo = require('./source.repo');
const audit = require('../audit/audit.service');
const { decodeUtf8, parseCsv, checkHeader } = require('./csv');
const { LEDGER_COLUMNS, parseLedgerRows } = require('./ledger-parser');
const { SETTLEMENT_COLUMNS, parseSettlementRows } = require('./settlement-parser');
const { sha256Hex } = require('../../lib/hash');
const { withTransaction } = require('../../db/pool');
const { AppError, conflict, unprocessable, badRequest } = require('../../lib/errors');

const MAX_STORED_ERRORS = 1000;
const SAMPLE_ERRORS = 50;

/** Reduces a client-supplied name to a safe display string (never used as a filesystem path). */
function cleanFilename(raw) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { name = String(raw || ''); }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!name) throw badRequest('Send the original file name in the X-Filename header');
  if (!/\.csv$/i.test(name)) throw unprocessable('UNSUPPORTED_FILE_TYPE', 'Only .csv files are accepted');
  return name;
}

function parseByKind(kind, buffer, config) {
  const text = decodeUtf8(buffer);
  const { header, records } = parseCsv(text, { maxRows: config.maxUploadRows });
  if (kind === 'ledger') {
    checkHeader(header, LEDGER_COLUMNS);
    const p = parseLedgerRows(header, records);
    return { ...p, totalRows: records.length, accepted: p.entries.length };
  }
  checkHeader(header, SETTLEMENT_COLUMNS);
  const p = parseSettlementRows(header, records);
  return { ...p, totalRows: records.length, accepted: p.lines.length + p.batches.length };
}

function errorReport(errors, rejectedRows) {
  const byCode = {};
  for (const e of errors) byCode[e.code] = (byCode[e.code] || 0) + 1;
  return { rejectedRows, totalIssues: errors.length, byCode, sample: errors.slice(0, SAMPLE_ERRORS) };
}

/**
 * Ingest one CSV upload.
 *   1. Parse and validate completely in memory. File-level problems reject the whole file.
 *   2. Row-level problems are recorded, not skipped silently; valid rows are accepted.
 *   3. In ONE transaction: insert the file row (the unique index decides duplicates), the
 *      records, the row errors and the audit event, and write the bytes to disk.
 */
async function ingest(ctx, actor, { kind, filename, buffer }) {
  const { pool, config, storage } = ctx;
  const sha256 = sha256Hex(buffer);
  let cleanName;
  let parsed;
  try {
    cleanName = cleanFilename(filename);
    parsed = parseByKind(kind, buffer, config);
    if (parsed.accepted === 0) {
      throw unprocessable('NO_VALID_ROWS', 'Every row in the file was rejected, so nothing was stored.', {
        errors: errorReport(parsed.errors, parsed.rejectedRows),
      });
    }
  } catch (err) {
    // Every rejected attempt leaves an audit trail, including bad file names.
    if (err instanceof AppError) {
      await audit.record(pool, actor, {
        action: 'source.upload_rejected', entityType: 'source_file',
        context: { kind, filename: cleanName ?? String(filename || '').slice(0, 120), sha256, sizeBytes: buffer.length, code: err.code, message: err.message },
      });
    }
    throw err;
  }
  const auditBase = { entityType: 'source_file', context: { kind, filename: cleanName, sha256, sizeBytes: buffer.length } };

  const outcome = await withTransaction(pool, async (tx) => {
    const file = await repo.insertFile(tx, {
      kind, filename: cleanName, sha256, sizeBytes: buffer.length, totalRows: parsed.totalRows,
      acceptedRows: parsed.accepted, rejectedRows: parsed.rejectedRows, uploadedBy: actor.user.id,
    });
    if (!file) return { duplicateOf: await repo.findDuplicate(tx, kind, sha256) };

    if (kind === 'ledger') await repo.insertLedgerEntries(tx, file.id, parsed.entries);
    else {
      await repo.insertSettlementLines(tx, file.id, parsed.lines);
      await repo.insertBatches(tx, file.id, parsed.batches);
    }
    await repo.insertRowErrors(tx, file.id, parsed.errors.slice(0, MAX_STORED_ERRORS));
    await storage.save(sha256, buffer);
    await audit.record(tx, actor, {
      action: 'source.ingested', entityType: 'source_file', entityId: file.id,
      context: { ...auditBase.context, totalRows: parsed.totalRows, acceptedRows: parsed.accepted, rejectedRows: parsed.rejectedRows },
    });
    return { file };
  });

  if (outcome.duplicateOf) {
    const d = outcome.duplicateOf;
    await audit.record(pool, actor, { ...auditBase, action: 'source.duplicate_rejected', entityId: d.id });
    throw conflict('DUPLICATE_FILE', `This exact file was already uploaded as "${d.filename}" (source #${d.id}).`, {
      existingSourceId: d.id, existingFilename: d.filename, uploadedAt: d.uploadedAt,
    });
  }
  return {
    file: {
      id: outcome.file.id, kind, filename: cleanName, sha256, sizeBytes: buffer.length, uploadedAt: outcome.file.uploadedAt,
      totalRows: parsed.totalRows, acceptedRows: parsed.accepted, rejectedRows: parsed.rejectedRows,
    },
    errors: errorReport(parsed.errors, parsed.rejectedRows),
  };
}

module.exports = { ingest, cleanFilename };
