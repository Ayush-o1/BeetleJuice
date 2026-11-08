'use strict';

const { z } = require('zod');
const repo = require('./break.repo');
const resolutions = require('../resolutions/resolution.repo');
const audit = require('../audit/audit.service');
const { RULES } = require('../engine/constants');
const { parseRupees } = require('../../lib/money');
const { isValidDateOnly } = require('../../lib/dates');
const { pagingSchema } = require('../../lib/paging');
const { withTransaction } = require('../../db/pool');
const { notFound, conflict } = require('../../lib/errors');

const rupees = z.string().trim().transform((v, ctx) => {
  try { return parseRupees(v); } catch { ctx.addIssue({ code: 'custom', message: 'must be an amount such as 1500 or 1500.50' }); return z.NEVER; }
});
const dateOnly = z.string().refine(isValidDateOnly, 'must be YYYY-MM-DD');

const BREAK_TYPES = ['AMOUNT_MISMATCH', 'DUPLICATE_SETTLEMENT', 'MISSING_IN_LEDGER', 'MISSING_IN_SETTLEMENT', 'BATCH_PAYOUT_MISMATCH', 'FEE_VARIANCE', 'AMBIGUOUS_REFERENCE'];

const filterSchema = z.object({
  status: z.enum(['open', 'pending_review', 'resolved', 'unresolved']).optional(),
  type: z.enum(BREAK_TYPES).optional(),
  side: z.enum(['ledger', 'settlement', 'both']).optional(),
  runId: z.coerce.number().int().positive().optional(),
  batch: z.string().trim().max(64).optional(),
  q: z.string().trim().max(64).optional(),
  minAmount: rupees.optional(),
  maxAmount: rupees.optional(),
  minAge: z.coerce.number().int().min(0).max(36500).optional(),
  maxAge: z.coerce.number().int().min(0).max(36500).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  sort: z.string().max(32).optional(),
}).transform(({ minAmount, maxAmount, ...rest }) => ({ ...rest, minAmountPaise: minAmount, maxAmountPaise: maxAmount }));

const listSchema = z.object({ ...pagingSchema }).and(filterSchema);

const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

/** Full picture of one break: result, both source records, batch context, notes, proposals, timeline. */
async function getDetail(db, id) {
  const brk = await repo.getBreakRow(db, id);
  if (!brk) throw notFound('Break');
  const result = await repo.getResult(db, brk.matchResultId);
  const [ledger, settlement, related, batch, notes, proposals, timeline] = await Promise.all([
    repo.getLedgerEntry(db, result.ledgerEntryId),
    repo.getSettlementLine(db, result.settlementLineId),
    brk.reference && result.scope === 'TRANSACTION'
      ? repo.relatedRecords(db, brk.runId, brk.reference, result.ledgerEntryId, result.settlementLineId) : { ledger: [], settlement: [] },
    repo.getBatchContext(db, brk.runId, brk.batchRef),
    repo.listNotes(db, id),
    resolutions.listForBreak(db, id),
    db.query(
      `SELECT a.id, a.occurred_at AS "occurredAt", a.action, a.actor_username AS "actor", a.actor_role AS "actorRole", a.context
         FROM audit_events a WHERE a.related_break_id = $1 ORDER BY a.occurred_at, a.id`, [id]).then((r) => r.rows),
  ]);
  const { runConfig, ...rest } = brk;
  return {
    ...rest,
    run: { id: brk.runId, asOfDate: brk.runAsOfDate, settingsVersion: runConfig.settingsVersion, config: runConfig },
    result: { ...result, ruleName: RULES[result.ruleId]?.name },
    ledger, settlement, related, batch, notes, proposals, timeline,
  };
}

async function addNote(ctx, actor, breakId, body) {
  return withTransaction(ctx.pool, async (tx) => {
    const brk = await repo.lockBreak(tx, breakId);
    if (!brk) throw notFound('Break');
    if (brk.status === 'resolved') throw conflict('BREAK_RESOLVED', 'Notes cannot be added to a resolved break.');
    const note = await repo.insertNote(tx, breakId, actor.user.id, body);
    await audit.record(tx, actor, { action: 'break.note_added', entityType: 'break', entityId: breakId, relatedBreakId: breakId, relatedRunId: brk.runId, context: { noteId: note.id } });
    return { id: note.id, body, createdAt: note.createdAt, author: actor.user.username, authorName: actor.user.displayName };
  });
}

module.exports = { listSchema, filterSchema, noteSchema, getDetail, addNote, BREAK_TYPES };
