'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./resolution.service');
const repo = require('./resolution.repo');
const { requirePermission } = require('../../middleware/auth');
const { parseWith, parseId } = require('../../lib/validate');
const { pagingSchema, pageResponse } = require('../../lib/paging');
const { notFound } = require('../../lib/errors');

const queueSchema = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'), ...pagingSchema });

function resolutionRoutes(ctx) {
  const router = express.Router();

  router.get('/', requirePermission('proposals:read'), async (req, res) => {
    const q = parseWith(queueSchema, req.query);
    const { rows, total } = await repo.listQueue(ctx.pool, { status: q.status, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  router.get('/:id', requirePermission('proposals:read'), async (req, res) => {
    const p = await repo.getById(ctx.pool, parseId(req.params.id));
    if (!p) throw notFound('Proposal');
    res.json({ data: p });
  });

  router.post('/:id/decision', requirePermission('proposals:decide'), async (req, res) => {
    const input = parseWith(service.decisionSchema, req.body);
    res.json({ data: await service.decide(ctx, req.actor, parseId(req.params.id), input) });
  });

  return router;
}

module.exports = { resolutionRoutes };
