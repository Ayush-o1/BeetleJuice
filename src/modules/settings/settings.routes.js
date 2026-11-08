'use strict';

const express = require('express');
const service = require('./settings.service');
const { requirePermission } = require('../../middleware/auth');
const { parseWith } = require('../../lib/validate');
const { pagingSchema, pageResponse } = require('../../lib/paging');
const { z } = require('zod');

function settingsRoutes(ctx) {
  const router = express.Router();

  router.get('/', requirePermission('settings:read'), async (req, res) => {
    res.json({ data: await service.getCurrent(ctx.pool) });
  });

  router.put('/', requirePermission('settings:update'), async (req, res) => {
    const input = parseWith(service.updateSchema, req.body);
    res.json({ data: await service.update(ctx, req.actor, input) });
  });

  router.get('/history', requirePermission('settings:read'), async (req, res) => {
    const q = parseWith(z.object(pagingSchema), req.query);
    const { rows, total } = await service.history(ctx.pool, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  return router;
}

module.exports = { settingsRoutes };
