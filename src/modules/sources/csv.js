'use strict';

const { parse } = require('csv-parse/sync');
const { unprocessable } = require('../../lib/errors');

/**
 * Structural CSV handling shared by both source types. Anything that makes the *file* unusable
 * (not UTF-8, unbalanced quotes, wrong headers, too many rows) throws a 422 with a specific code.
 * Problems with individual rows are NOT thrown here; the row validators report them.
 */

function decodeUtf8(buffer) {
  if (buffer.includes(0)) throw unprocessable('CSV_NOT_TEXT', 'The file contains binary (NUL) bytes and is not a CSV text file.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw unprocessable('CSV_ENCODING', 'The file is not valid UTF-8. Re-export it as UTF-8 CSV.');
  }
}

/** @returns {{header: string[], records: {values: string[], rowNumber: number, lineNumber: number}[]}} */
function parseCsv(text, { maxRows }) {
  let raw;
  try {
    raw = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, info: true });
  } catch (err) {
    throw unprocessable('CSV_MALFORMED', `The file is not well-formed CSV: ${err.message}`);
  }
  if (raw.length === 0) throw unprocessable('CSV_EMPTY', 'The file is empty.');
  const header = raw[0].record.map((h) => h.trim().toLowerCase());
  const dataRows = raw.length - 1;
  if (dataRows === 0) throw unprocessable('CSV_EMPTY', 'The file has a header row but no data rows.');
  if (dataRows > maxRows) {
    throw unprocessable('CSV_TOO_MANY_ROWS', `The file has ${dataRows} data rows; the limit is ${maxRows}.`);
  }
  const records = raw.slice(1).map((r, i) => ({ values: r.record, rowNumber: i + 1, lineNumber: r.info.lines }));
  return { header, records };
}

/** Exact header contract: every required column present, nothing unexpected, no duplicates. */
function checkHeader(header, required) {
  const dup = header.filter((h, i) => header.indexOf(h) !== i);
  const missing = required.filter((h) => !header.includes(h));
  const unexpected = header.filter((h) => !required.includes(h));
  if (dup.length || missing.length || unexpected.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length) parts.push(`unexpected: ${unexpected.join(', ')}`);
    if (dup.length) parts.push(`duplicated: ${[...new Set(dup)].join(', ')}`);
    throw unprocessable('CSV_HEADER_INVALID',
      `Header does not match the expected format (${parts.join('; ')}). Expected columns: ${required.join(', ')}.`,
      { missing, unexpected, duplicated: [...new Set(dup)], expected: required });
  }
}

/** Safe, bounded excerpt of a raw row for the error report (no control characters). */
function excerpt(values) {
  return values.join(',').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
}

module.exports = { decodeUtf8, parseCsv, checkHeader, excerpt };
