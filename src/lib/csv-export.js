'use strict';

/**
 * CSV output with spreadsheet-formula neutralisation (OWASP "CSV Injection"). A text cell that
 * begins with = + - @ tab or CR (or their full-width forms) is prefixed with a single quote so
 * Excel/Sheets treat it as text. `numeric` cells are numbers we generated from integers
 * (e.g. -250.00) and must NOT be altered.
 */
const DANGEROUS_START = /^[=+\-@\t\r＝＋－＠]/;

function cell(value, { numeric = false } = {}) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (!numeric && DANGEROUS_START.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(header, rows) {
  const lines = [header.map((h) => cell(h)).join(',')];
  for (const row of rows) lines.push(row.map((c) => (c && typeof c === 'object' && 'n' in c ? cell(c.n, { numeric: true }) : cell(c))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Wrap a pre-formatted number so toCsv leaves it alone. */
const num = (n) => ({ n });

module.exports = { cell, toCsv, num };
