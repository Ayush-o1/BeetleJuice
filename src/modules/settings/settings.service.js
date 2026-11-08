'use strict';

const { z } = require('zod');
const audit = require('../audit/audit.service');
const { withTransaction } = require('../../db/pool');
const { conflict } = require('../../lib/errors');

const updateSchema = z.object({
  amountTolerancePaise: z.number().int().min(0).max(100000),
  // Strings keep exact decimals end to end; a JS number like 1.1 would round-trip through floating point.
  feeRatePercent: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,2}(\.\d{1,4})?$/, 'up to 4 decimals, e.g. 2.0000'))
    .refine((v) => Number(v) <= 20, 'must be at most 20'),
  feeTolerancePaise: z.number().int().min(0).max(100000),
  settlementWindowDays: z.number().int().min(0).max(30),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(200).optional(),
}).strict();

const SELECT = `SELECT s.version, s.amount_tolerance_paise AS "amountTolerancePaise", s.fee_rate_percent::text AS "feeRatePercent",
  s.fee_tolerance_paise AS "feeTolerancePaise", s.settlement_window_days AS "settlementWindowDays",
  s.note, s.created_at AS "createdAt", u.username AS "changedBy"
  FROM settings_versions s LEFT JOIN users u ON u.id = s.changed_by`;

async function getCurrent(db) {
  const { rows } = await db.query(`${SELECT} ORDER BY s.version DESC LIMIT 1`);
  return rows[0];
}

async function history(db, { limit, offset }) {
  const total = (await db.query('SELECT count(*)::int AS n FROM settings_versions')).rows[0].n;
  const { rows } = await db.query(`${SELECT} ORDER BY s.version DESC LIMIT ${limit} OFFSET ${offset}`);
  return { rows, total };
}

/**
 * Settings are never edited in place: an update appends version N+1. Past runs keep their own
 * frozen snapshot, so this cannot change any historical result. `expectedVersion` makes a stale
 * form (two supervisors editing at once) fail with 409 instead of silently overwriting.
 */
async function update(ctx, actor, input) {
  return withTransaction(ctx.pool, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727002)'); // serialise settings writers
    const current = await getCurrent(tx);
    if (current.version !== input.expectedVersion) {
      throw conflict('SETTINGS_STALE', `Settings are now at version ${current.version}; reload and try again.`, { currentVersion: current.version });
    }
    await tx.query(
      `INSERT INTO settings_versions (version, amount_tolerance_paise, fee_rate_percent, fee_tolerance_paise, settlement_window_days, changed_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [current.version + 1, input.amountTolerancePaise, input.feeRatePercent, input.feeTolerancePaise, input.settlementWindowDays, actor.user.id, input.note || null],
    );
    const next = await getCurrent(tx);
    await audit.record(tx, actor, {
      action: 'settings.updated', entityType: 'settings', entityId: next.version,
      context: { from: pick(current), to: pick(next), note: input.note || null },
    });
    return next;
  });
}

const pick = (s) => ({
  version: s.version, amountTolerancePaise: s.amountTolerancePaise, feeRatePercent: s.feeRatePercent,
  feeTolerancePaise: s.feeTolerancePaise, settlementWindowDays: s.settlementWindowDays,
});

module.exports = { updateSchema, getCurrent, history, update };
