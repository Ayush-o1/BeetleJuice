'use strict';

const { z } = require('zod');
const repo = require('./resolution.repo');
const breakRepo = require('../breaks/break.repo');
const audit = require('../audit/audit.service');
const { withTransaction } = require('../../db/pool');
const { notFound, conflict, AppError } = require('../../lib/errors');

const RESOLUTION_CODES = ['CORRECT_LEDGER', 'DISPUTE_WITH_PROCESSOR', 'RECOVER_DUPLICATE', 'WRITE_OFF', 'NO_ACTION'];

const proposalSchema = z.object({
  resolutionCode: z.enum(RESOLUTION_CODES),
  note: z.string().trim().min(10, 'Explain the proposal in at least 10 characters').max(2000),
  breakVersion: z.number().int().positive(),
}).strict();

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
  breakVersion: z.number().int().positive(),
}).strict().refine((v) => v.decision === 'approved' || (v.note && v.note.length >= 5), {
  message: 'A rejection needs a reason of at least 5 characters', path: ['note'],
});

/**
 * Maker step. Locks the break row, checks it is still `open` and still at the version the analyst
 * was looking at, then records the proposal, moves the break to `pending_review` and writes the
 * audit event — all in one transaction.
 */
async function propose(ctx, actor, breakId, input) {
  return withTransaction(ctx.pool, async (tx) => {
    const brk = await breakRepo.lockBreak(tx, breakId);
    if (!brk) throw notFound('Break');
    if (brk.status !== 'open') {
      throw conflict('BREAK_NOT_OPEN', brk.status === 'resolved' ? 'This break is already resolved.' : 'This break already has a proposal awaiting review.', { status: brk.status, version: brk.version });
    }
    if (brk.version !== input.breakVersion) {
      throw conflict('BREAK_CHANGED', 'This break changed since you opened it. Reload and review it again.', { currentVersion: brk.version });
    }
    const id = await repo.insert(tx, { breakId, proposedBy: actor.user.id, resolutionCode: input.resolutionCode, note: input.note, breakVersion: brk.version });
    await tx.query("UPDATE breaks SET status = 'pending_review', version = version + 1, status_changed_at = now() WHERE id = $1", [breakId]);
    await audit.record(tx, actor, {
      action: 'proposal.created', entityType: 'proposal', entityId: id, relatedRunId: brk.runId, relatedBreakId: breakId,
      context: { resolutionCode: input.resolutionCode, note: input.note },
    });
    return repo.getById(tx, id);
  });
}

/**
 * Checker step. Concurrency design:
 *  - Lock order is always break -> proposal, so two deciders can never deadlock.
 *  - The second reviewer blocks on the break lock; when it proceeds, READ COMMITTED re-reads the
 *    committed row, sees the proposal is no longer pending (or the break version moved) and gets 409.
 *  - `breakVersion` is what the reviewer saw; if the break moved on, the decision is refused rather
 *    than applied to something they did not review (no time-of-check/time-of-use gap).
 *  - Partial unique indexes and the maker-checker trigger enforce the same rules in the database.
 */
async function decide(ctx, actor, proposalId, input) {
  try {
    return await decideInTransaction(ctx, actor, proposalId, input);
  } catch (err) {
    // Recorded after the rollback on a fresh connection: writing it inside the transaction would be
    // rolled back with it, and writing it concurrently would wait on the row lock the transaction holds.
    if (err.code === 'SELF_DECISION_FORBIDDEN') {
      await audit.record(ctx.pool, actor, {
        action: 'proposal.self_decision_blocked', entityType: 'proposal', entityId: proposalId, relatedBreakId: err.details.breakId, relatedRunId: err.details.runId,
      });
    }
    throw err;
  }
}

async function decideInTransaction(ctx, actor, proposalId, input) {
  return withTransaction(ctx.pool, async (tx) => {
    const breakId = await repo.peekBreakId(tx, proposalId);
    if (!breakId) throw notFound('Proposal');
    const brk = await breakRepo.lockBreak(tx, breakId);
    const proposal = await repo.lockById(tx, proposalId);

    if (proposal.proposedById === actor.user.id) {
      throw new AppError(403, 'SELF_DECISION_FORBIDDEN', 'You cannot approve or reject a resolution you proposed.', { breakId, runId: brk.runId });
    }
    if (proposal.status !== 'pending') {
      throw conflict('PROPOSAL_ALREADY_DECIDED', `This proposal was already ${proposal.status}.`, { status: proposal.status });
    }
    if (brk.version !== input.breakVersion || brk.status !== 'pending_review') {
      throw conflict('BREAK_CHANGED', 'The break changed since you opened it. Reload and review it again.', { currentVersion: brk.version, status: brk.status });
    }

    await repo.insertDecision(tx, { proposalId, decidedBy: actor.user.id, decision: input.decision, note: input.note });
    await repo.markDecided(tx, proposalId, input.decision);
    if (input.decision === 'approved') {
      await tx.query(
        `UPDATE breaks SET status = 'resolved', version = version + 1, status_changed_at = now(), resolved_at = now(), resolution_code = $2 WHERE id = $1`,
        [breakId, proposal.resolutionCode]);
    } else {
      await tx.query("UPDATE breaks SET status = 'open', version = version + 1, status_changed_at = now() WHERE id = $1", [breakId]);
    }
    const base = { entityType: 'proposal', entityId: proposalId, relatedBreakId: breakId, relatedRunId: brk.runId };
    await audit.record(tx, actor, { ...base, action: `proposal.${input.decision}`, context: { note: input.note ?? null, resolutionCode: proposal.resolutionCode, proposedBy: proposal.proposedById } });
    await audit.record(tx, actor, {
      ...base, entityType: 'break', entityId: breakId,
      action: input.decision === 'approved' ? 'break.resolved' : 'break.reopened', context: { proposalId, resolutionCode: proposal.resolutionCode },
    });
    return repo.getById(tx, proposalId);
  });
}

module.exports = { RESOLUTION_CODES, proposalSchema, decisionSchema, propose, decide };
