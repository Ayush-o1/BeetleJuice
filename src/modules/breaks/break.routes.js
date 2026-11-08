'use strict';

const express = require('express');
const service = require('./break.service');
const repo = require('./break.repo');
const resolutionService = require('../resolutions/resolution.service');
const { requirePermission } = require('../../middleware/auth');
const { parseWith, parseId } = require('../../lib/validate');
const { pageResponse } = require('../../lib/paging');
const { toCsv, num } = require('../../lib/csv-export');
const { toRupeesString } = require('../../lib/money');

const rupees = (p) => (p == null ? '' : num(toRupeesString(p)));

function breakRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('breaks:read'), async (req, res) => {
    const q = parseWith(service.listSchema, req.query);
    const { rows, total } = await repo.list(pool, q, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize, sort: q.sort });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  // Declared before '/:id' so "export.csv" is never parsed as an id.
  router.get('/export.csv', requirePermission('breaks:read'), async (req, res) => {
    const q = parseWith(service.filterSchema, req.query);
    const rows = await repo.listForExport(pool, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="beetlejuice-breaks.csv"');
    res.send(toCsv(
      ['break_id', 'run_id', 'type', 'status', 'reference', 'batch', 'reference_date', 'age_days', 'impact_inr', 'ledger_amount_inr', 'settlement_amount_inr', 'difference_inr', 'rule', 'explanation'],
      rows.map((r) => [r.id, r.runId, r.type, r.status, r.reference, r.batchRef, r.referenceDate, num(r.ageDays), rupees(r.impactPaise),
        rupees(r.ledgerAmountPaise), rupees(r.settlementAmountPaise), rupees(r.amountDiffPaise), r.ruleId, r.explanation]),
    ));
  });

  router.get('/:id', requirePermission('breaks:read'), async (req, res) => {
    res.json({ data: await service.getDetail(pool, parseId(req.params.id)) });
  });

  router.post('/:id/notes', requirePermission('breaks:note'), async (req, res) => {
    const { body } = parseWith(service.noteSchema, req.body);
    res.status(201).json({ data: await service.addNote(ctx, req.actor, parseId(req.params.id), body) });
  });

  router.post('/:id/proposals', requirePermission('proposals:create'), async (req, res) => {
    const input = parseWith(resolutionService.proposalSchema, req.body);
    res.status(201).json({ data: await resolutionService.propose(ctx, req.actor, parseId(req.params.id), input) });
  });

  return router;
}

module.exports = { breakRoutes };
