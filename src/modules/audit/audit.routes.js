'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/auth');
const { parseWith } = require('../../lib/validate');
const { pagingSchema, pageResponse } = require('../../lib/paging');
const { isValidDateOnly } = require('../../lib/dates');
const { toCsv } = require('../../lib/csv-export');

const dateOnly = z.string().refine(isValidDateOnly, 'must be YYYY-MM-DD');
const filterSchema = z.object({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(40).optional(),
  actor: z.string().trim().max(40).optional(),
  runId: z.coerce.number().int().positive().optional(),
  breakId: z.coerce.number().int().positive().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  hide: z.enum(['auth']).optional(),     // opt-in noise filter: sign-in/out events
});
const listSchema = z.object({ ...pagingSchema }).and(filterSchema);

const SELECT = `SELECT a.id, a.occurred_at AS "occurredAt", a.actor_username AS "actor", u.display_name AS "actorName", a.actor_role AS "actorRole", a.action,
  a.entity_type AS "entityType", a.entity_id AS "entityId", a.related_run_id AS "runId", a.related_break_id AS "breakId",
  a.context, a.ip, a.request_id AS "requestId" FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id`;

function where(f) {
  const w = []; const p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  // "auth." matches every action in that family; otherwise exact match.
  if (f.action) { if (f.action.endsWith('.')) add("a.action LIKE ?", `${f.action}%`); else add('a.action = ?', f.action); }
  if (f.hide === 'auth') w.push("a.action NOT LIKE 'auth.%'");
  if (f.entityType) add('a.entity_type = ?', f.entityType);
  if (f.entityId) add('a.entity_id = ?', f.entityId);
  if (f.actor) add('a.actor_username = ?', f.actor.toLowerCase());
  if (f.runId) add('a.related_run_id = ?', f.runId);
  if (f.breakId) add('a.related_break_id = ?', f.breakId);
  // Dates are IST calendar days, matching how the rest of the product reports time.
  if (f.from) add("a.occurred_at >= (?::date::timestamp AT TIME ZONE 'Asia/Kolkata')", f.from);
  if (f.to) add("a.occurred_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')", f.to);
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

function auditRoutes(ctx) {
  const router = express.Router();
  const { pool } = ctx;

  router.get('/', requirePermission('audit:read'), async (req, res) => {
    const q = parseWith(listSchema, req.query);
    const w = where(q);
    const total = (await pool.query(`SELECT count(*)::int AS n FROM audit_events a ${w.sql}`, w.params)).rows[0].n;
    const { rows } = await pool.query(`${SELECT} ${w.sql} ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, w.params);
    res.json(pageResponse(rows, total, q.page, q.pageSize));
  });

  router.get('/actions', requirePermission('audit:read'), async (req, res) => {
    const { rows } = await pool.query('SELECT DISTINCT action FROM audit_events ORDER BY action');
    res.json({ data: rows.map((r) => r.action) });
  });

  router.get('/export.csv', requirePermission('audit:read'), async (req, res) => {
    const f = parseWith(filterSchema, req.query);
    const w = where(f);
    const { rows } = await pool.query(`${SELECT} ${w.sql} ORDER BY a.occurred_at DESC, a.id DESC LIMIT 10000`, w.params);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="beetlejuice-audit.csv"');
    res.send(toCsv(
      ['id', 'occurred_at', 'actor', 'role', 'action', 'entity_type', 'entity_id', 'run_id', 'break_id', 'context', 'request_id'],
      rows.map((r) => [r.id, r.occurredAt.toISOString(), r.actor, r.actorRole, r.action, r.entityType, r.entityId, r.runId, r.breakId, JSON.stringify(r.context), r.requestId]),
    ));
  });

  return router;
}

module.exports = { auditRoutes };
