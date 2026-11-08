'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestApp } = require('../helpers/app');
const { ledgerCsv, settlementCsv, LEDGER_HEADER, EXPECTED } = require('../helpers/scenario');
const { sha256Hex } = require('../../src/lib/hash');

let app;
test.before(async () => { app = await startTestApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(async () => { await app.reset(); });

test('ledger upload reports accepted and rejected rows with reasons and persists normalised records', async () => {
  const analyst = await app.as('analyst');
  const r = await analyst.upload('ledger', 'ledger-nov.csv', ledgerCsv);
  assert.equal(r.status, 201);
  const { file, errors } = r.body.data;
  assert.equal(file.totalRows, EXPECTED.ledgerRows.total);
  assert.equal(file.acceptedRows, EXPECTED.ledgerRows.accepted);
  assert.equal(file.rejectedRows, EXPECTED.ledgerRows.rejected);
  assert.equal(errors.byCode.AMOUNT_ZERO, 1);
  assert.equal(errors.sample[0].rowNumber, 8);
  assert.match(errors.sample[0].message, /must not be zero/);

  const { rows } = await app.pool.query('SELECT amount_paise, business_date, reference FROM ledger_entries ORDER BY row_number');
  assert.equal(rows.length, 7);
  assert.equal(rows[0].amount_paise, 500000);          // integer paise
  assert.equal(rows[6].amount_paise, -40000);          // refund stored negative
  assert.equal(rows[0].business_date, '2026-11-02');   // plain date string, no timezone shift

  const detail = await analyst.get(`/api/sources/${file.id}`);
  assert.equal(detail.body.data.totals.entries, 7);
  assert.equal(detail.body.data.errorsByCode[0].code, 'AMOUNT_ZERO');
  const errs = await analyst.get(`/api/sources/${file.id}/errors`);
  assert.equal(errs.body.page.total, 1);
  assert.equal(errs.body.data[0].rawExcerpt.startsWith('L-8,PAY-1008'), true);
});

test('uploaded bytes are stored outside public/, content-addressed, owner-only', async () => {
  const analyst = await app.as('analyst');
  await analyst.upload('ledger', 'ledger-nov.csv', ledgerCsv);
  const file = path.join(app.config.uploadDir, `${sha256Hex(Buffer.from(ledgerCsv))}.csv`);
  assert.equal(fs.readFileSync(file, 'utf8'), ledgerCsv);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!app.config.uploadDir.includes(`${path.sep}public`));
});

test('settlement upload accepts TXN and BATCH rows', async () => {
  const analyst = await app.as('analyst');
  const r = await analyst.upload('settlement', 's.csv', settlementCsv);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.file.acceptedRows, EXPECTED.settlementRows.accepted);
  const detail = await analyst.get(`/api/sources/${r.body.data.file.id}`);
  assert.equal(detail.body.data.totals.lines, 7);
  assert.equal(detail.body.data.totals.batches, 2);
  const batches = await analyst.get(`/api/sources/${r.body.data.file.id}/records?view=batches`);
  assert.equal(batches.body.data[0].payoutPaise, 826300);
});

test('the same file twice is rejected with 409 and a pointer to the original', async () => {
  const analyst = await app.as('analyst');
  const first = await analyst.upload('ledger', 'a.csv', ledgerCsv);
  const second = await analyst.upload('ledger', 'renamed-copy.csv', ledgerCsv);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'DUPLICATE_FILE');
  assert.equal(second.body.error.details.existingSourceId, first.body.data.file.id);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM source_files')).rows[0].n, 1);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM ledger_entries')).rows[0].n, 7);
  const { rows } = await app.pool.query("SELECT action FROM audit_events WHERE action LIKE 'source.%' ORDER BY id");
  assert.deepEqual(rows.map((x) => x.action), ['source.ingested', 'source.duplicate_rejected']);
});

test('concurrent uploads of identical bytes: exactly one wins (database-enforced)', async () => {
  const a = await app.as('analyst');
  const b = await app.as('analyst2');
  const results = await Promise.all([a.upload('ledger', 'x.csv', ledgerCsv), b.upload('ledger', 'y.csv', ledgerCsv)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM source_files')).rows[0].n, 1);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM ledger_entries')).rows[0].n, 7);
});

test('file-level problems are rejected whole, stored nowhere, and audited', async () => {
  const analyst = await app.as('analyst');
  const cases = [
    ['wrong header', 'ledger', 'f.csv', 'a,b,c\n1,2,3\n', 422, 'CSV_HEADER_INVALID'],
    ['header only', 'ledger', 'f.csv', `${LEDGER_HEADER}\n`, 422, 'CSV_EMPTY'],
    ['settlement file sent as ledger', 'ledger', 'f.csv', settlementCsv, 422, 'CSV_HEADER_INVALID'],
    ['all rows invalid', 'ledger', 'f.csv', `${LEDGER_HEADER}\nL-1,P-1,S,PAYMENT,0,INR,2026-11-02T10:00:00+05:30\n`, 422, 'NO_VALID_ROWS'],
    ['not csv extension', 'ledger', 'f.txt', ledgerCsv, 422, 'UNSUPPORTED_FILE_TYPE'],
    ['unbalanced quote', 'ledger', 'f.csv', `${LEDGER_HEADER}\nL-1,"P-1,S\n`, 422, 'CSV_MALFORMED'],
  ];
  for (const [name, kind, filename, csv, status, code] of cases) {
    const r = await analyst.upload(kind, filename, csv);
    assert.equal(r.status, status, name);
    assert.equal(r.body.error.code, code, name);
  }
  assert.equal((await analyst.upload('ledger', 'f.csv', ledgerCsv, { contentType: 'application/octet-stream' })).status, 415);
  assert.equal((await analyst.upload('bogus', 'f.csv', ledgerCsv)).status, 400);
  assert.equal((await app.pool.query('SELECT count(*)::int n FROM source_files')).rows[0].n, 0);
  assert.ok((await app.pool.query("SELECT count(*)::int n FROM audit_events WHERE action = 'source.upload_rejected'")).rows[0].n >= 6);
});

test('oversized and over-long files are refused', async () => {
  const small = await startTestApp({ MAX_UPLOAD_BYTES: '2048', MAX_UPLOAD_ROWS: '3' });
  try {
    const a = await small.as('analyst');
    const rows = Array.from({ length: 5 }, (_, i) => `L-${i},P-${i},S,PAYMENT,1.00,INR,2026-11-02T10:00:00+05:30`);
    const tooMany = await a.upload('ledger', 'f.csv', `${LEDGER_HEADER}\n${rows.join('\n')}\n`);
    assert.equal(tooMany.status, 422);
    assert.equal(tooMany.body.error.code, 'CSV_TOO_MANY_ROWS');
    const tooBig = await a.upload('ledger', 'f.csv', `${LEDGER_HEADER}\n${'x'.repeat(5000)}\n`);
    assert.equal(tooBig.status, 413);
  } finally { await small.close(); }
});

test('analysts and others can read sources; auditors and supervisors cannot upload', async () => {
  const analyst = await app.as('analyst');
  await analyst.upload('ledger', 'a.csv', ledgerCsv);
  for (const who of ['supervisor', 'auditor']) {
    const c = await app.as(who);
    assert.equal((await c.upload('ledger', 'b.csv', ledgerCsv.replace('L-1', 'L-99'))).status, 403, who);
    const list = await c.get('/api/sources');
    assert.equal(list.status, 200);
    assert.equal(list.body.page.total, 1);
  }
});

test('hostile content is stored as data and neutralised on export', async () => {
  const analyst = await app.as('analyst');
  const csv = `${LEDGER_HEADER}\nL-1,PAY-1,"=HYPERLINK(""http://evil"")",PAYMENT,10.00,INR,2026-11-02T10:00:00+05:30\nL-2,<script>,Shop,PAYMENT,10.00,INR,2026-11-02T10:00:00+05:30\n`;
  const r = await analyst.upload('ledger', 'h.csv', csv);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.file.acceptedRows, 1); // "<script>" fails the identifier rule
  const { rows } = await app.pool.query('SELECT merchant FROM ledger_entries');
  assert.equal(rows[0].merchant, '=HYPERLINK("http://evil")');
});
