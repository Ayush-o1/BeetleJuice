'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./run.service');
const repo = require('./run.repo');
const sourceRepo = require('../sources/source.repo');
const { RULES } = require('../engine/constants');
const { requirePermission } = require('../../middleware/auth');
const { parseWith, parseId } = require('../../lib/validate');
const { pagingSchema, pageResponse, orderBy } = require('../../lib/paging');
const { notFound, unprocessable } = require('../../lib/errors');

const listSchema = z.object({ status: z.enum(['queued', 'running', 'completed', 'failed']).optional(), ...pagingSchema });
const resultsSchema = z.object({
  outcome: z.enum(['MATCHED', 'PENDING', 'BREAK']).optional(),
  type: z.string().regex(/^[A-Z_]{3,40}$/).optional(),
  scope: z.enum(['TRANSACTION', 'BATCH']).optional(),
  q: z.string().trim().max(64).optional(),
  sort: z.string().max(32).optional(),
  ...pagingSchema,
});
const suggestSchema = z.object({ ledgerFileId: z.coerce.number().int().positive(), settlementFileId: z.coerce.number().int().positive() });

const RESULT_SORTS = { reference: 'm.reference', outcome: 'm.outcome', rule: 'm.rule_id', impact: 'm.impact_paise', date: 'm.reference_date' };

function runRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('runs:read'), async (req, res) => {
    const q = parseWith(listSchema, req.query);
    const { rows, total } = await repo.listRuns(pool, { status: q.status, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  router.post('/', requirePermission('runs:create'), async (req, res) => {
    const input = parseWith(service.createSchema, req.body);
    res.status(202).json({ data: await service.createRun(ctx, req.actor, input) });
  });

  // Lets the "new run" form pre-fill the as-of date from the chosen files.
  router.get('/suggest', requirePermission('runs:read'), async (req, res) => {
    const q = parseWith(suggestSchema, req.query);
    const [l, s] = await Promise.all([sourceRepo.getFile(pool, q.ledgerFileId), sourceRepo.getFile(pool, q.settlementFileId)]);
    if (!l || !s || l.kind !== 'ledger' || s.kind !== 'settlement') throw unprocessable('INVALID_SOURCES', 'Choose one ledger file and one settlement file');
    res.json({ data: { asOfDate: await service.suggestAsOf(pool, l, s) } });
  });

  router.get('/rules', requirePermission('runs:read'), (req, res) => {
    res.json({ data: Object.values(RULES) });
  });

  router.get('/:id', requirePermission('runs:read'), async (req, res) => {
    const run = await repo.getRun(pool, parseId(req.params.id));
    if (!run) throw notFound('Run');
    res.json({ data: run });
  });

  router.get('/:id/results', requirePermission('runs:read'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await repo.getRun(pool, id))) throw notFound('Run');
    const q = parseWith(resultsSchema, req.query);
    const w = ['m.run_id = $1']; const p = [id];
    const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
    if (q.outcome) add('m.outcome = ?', q.outcome);
    if (q.type) add('m.break_type = ?', q.type);
    if (q.scope) add('m.scope = ?', q.scope);
    if (q.q) add("m.reference ILIKE ? ESCAPE '\\'", `%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    const total = (await pool.query(`SELECT count(*)::int AS n FROM match_results m WHERE ${w.join(' AND ')}`, p)).rows[0].n;
    const { rows } = await pool.query(
      `SELECT m.id, m.scope, m.outcome, m.break_type AS "breakType", m.rule_id AS "ruleId", m.explanation, m.reference, m.batch_ref AS "batchRef",
              m.amount_diff_paise AS "amountDiffPaise", m.impact_paise AS "impactPaise", m.reference_date AS "referenceDate",
              le.amount_paise AS "ledgerAmountPaise", sl.amount_paise AS "settlementAmountPaise", b.id AS "breakId", b.status AS "breakStatus"
         FROM match_results m
         LEFT JOIN ledger_entries le ON le.id = m.ledger_entry_id
         LEFT JOIN settlement_lines sl ON sl.id = m.settlement_line_id
         LEFT JOIN breaks b ON b.match_result_id = m.id
        WHERE ${w.join(' AND ')}
        ORDER BY ${orderBy(q.sort, RESULT_SORTS, 'm.scope DESC, m.reference', 'm.id')}
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, p);
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  return router;
}

module.exports = { runRoutes };
