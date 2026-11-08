'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./source.service');
const repo = require('./source.repo');
const { requirePermission } = require('../../middleware/auth');
const { parseWith, parseId } = require('../../lib/validate');
const { pagingSchema, pageResponse } = require('../../lib/paging');
const { notFound, AppError } = require('../../lib/errors');

const listQuery = z.object({ kind: z.enum(['ledger', 'settlement']).optional(), ...pagingSchema });
const recordsQuery = z.object({ q: z.string().trim().max(64).optional(), view: z.enum(['lines', 'batches']).optional(), ...pagingSchema });
const errorsQuery = z.object({ ...pagingSchema });

function sourceRoutes(ctx) {
  const router = express.Router();
  const { pool, config } = ctx;
  const csvBody = express.raw({ type: 'text/csv', limit: config.maxUploadBytes });

  async function loadFile(req) {
    const file = await repo.getFile(pool, parseId(req.params.id));
    if (!file) throw notFound('Source file');
    return file;
  }

  router.get('/', requirePermission('sources:read'), async (req, res) => {
    const q = parseWith(listQuery, req.query);
    const { rows, total } = await repo.listFiles(pool, { kind: q.kind, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  // Raw CSV body (Content-Type: text/csv) with the original name in X-Filename; no multipart parser needed.
  router.post('/:kind', requirePermission('sources:upload'), csvBody, async (req, res) => {
    const kind = parseWith(z.enum(['ledger', 'settlement']), req.params.kind);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as the request body with Content-Type: text/csv');
    }
    const result = await service.ingest(ctx, req.actor, { kind, filename: req.headers['x-filename'], buffer: req.body });
    res.status(201).json({ data: result });
  });

  router.get('/:id', requirePermission('sources:read'), async (req, res) => {
    const file = await loadFile(req);
    const [totals, errorsByCode] = await Promise.all([repo.fileTotals(pool, file), repo.errorSummary(pool, file.id)]);
    res.json({ data: { ...file, totals, errorsByCode } });
  });

  router.get('/:id/errors', requirePermission('sources:read'), async (req, res) => {
    const file = await loadFile(req);
    const q = parseWith(errorsQuery, req.query);
    const { rows, total } = await repo.listRowErrors(pool, file.id, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  router.get('/:id/records', requirePermission('sources:read'), async (req, res) => {
    const file = await loadFile(req);
    const q = parseWith(recordsQuery, req.query);
    const { rows, total } = await repo.listRecords(pool, file, { view: q.view, q: q.q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  return router;
}

module.exports = { sourceRoutes };
