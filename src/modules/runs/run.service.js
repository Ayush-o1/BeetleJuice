'use strict';

const { z } = require('zod');
const repo = require('./run.repo');
const sourceRepo = require('../sources/source.repo');
const settings = require('../settings/settings.service');
const audit = require('../audit/audit.service');
const { ENGINE_VERSION, RULE_SEQUENCE } = require('../engine/constants');
const { canonicalJson, sha256Hex } = require('../../lib/hash');
const { withTransaction } = require('../../db/pool');
const { isValidDateOnly } = require('../../lib/dates');
const { notFound, unprocessable, conflict } = require('../../lib/errors');

const createSchema = z.object({
  ledgerFileId: z.number().int().positive(),
  settlementFileId: z.number().int().positive(),
  asOfDate: z.string().refine(isValidDateOnly, 'must be a real date as YYYY-MM-DD').optional(),
}).strict();

/** Latest business date present in either source: the default "as of" so runs never depend on the wall clock. */
async function suggestAsOf(db, ledgerFile, settlementFile) {
  const [a, b] = await Promise.all([sourceRepo.fileTotals(db, ledgerFile), sourceRepo.fileTotals(db, settlementFile)]);
  return [a.lastDate, b.lastDate].filter(Boolean).sort().pop();
}

/**
 * Queues a run. Everything that influences the result — input file hashes, the settings in force,
 * the as-of date, the engine version — is frozen into config_snapshot now, so a supervisor changing
 * settings later cannot alter this run. The fingerprint of those inputs is unique among
 * non-failed runs, so double-clicks and concurrent requests cannot create duplicate work.
 */
async function createRun(ctx, actor, input) {
  const { pool, config } = ctx;
  const [ledgerFile, settlementFile] = await Promise.all([
    sourceRepo.getFile(pool, input.ledgerFileId), sourceRepo.getFile(pool, input.settlementFileId)]);
  if (!ledgerFile || ledgerFile.kind !== 'ledger') throw unprocessable('INVALID_LEDGER_SOURCE', 'ledgerFileId must refer to an uploaded ledger file');
  if (!settlementFile || settlementFile.kind !== 'settlement') throw unprocessable('INVALID_SETTLEMENT_SOURCE', 'settlementFileId must refer to an uploaded settlement file');

  const current = await settings.getCurrent(pool);
  const asOfDate = input.asOfDate || await suggestAsOf(pool, ledgerFile, settlementFile);
  const rules = {
    amountTolerancePaise: current.amountTolerancePaise, feeRatePercent: current.feeRatePercent,
    feeTolerancePaise: current.feeTolerancePaise, settlementWindowDays: current.settlementWindowDays, asOfDate,
  };
  const snapshot = {
    engineVersion: ENGINE_VERSION, ruleSequence: RULE_SEQUENCE, settingsVersion: current.version, ...rules,
    inputs: {
      ledger: { fileId: ledgerFile.id, filename: ledgerFile.filename, sha256: ledgerFile.sha256, acceptedRows: ledgerFile.acceptedRows },
      settlement: { fileId: settlementFile.id, filename: settlementFile.filename, sha256: settlementFile.sha256, acceptedRows: settlementFile.acceptedRows },
    },
  };
  const fingerprint = sha256Hex(canonicalJson({ ledger: ledgerFile.sha256, settlement: settlementFile.sha256, engine: ENGINE_VERSION, rules }));

  return withTransaction(pool, async (tx) => {
    const inserted = await repo.insertQueued(tx, {
      ledgerFileId: ledgerFile.id, settlementFileId: settlementFile.id, asOfDate, config: snapshot,
      fingerprint, createdBy: actor.user.id, maxAttempts: config.runMaxAttempts,
    });
    if (!inserted) {
      const existing = await repo.findActiveByFingerprint(tx, fingerprint);
      throw conflict('DUPLICATE_RUN', `An identical run already exists (run #${existing.id}, ${existing.status}).`, { existingRunId: existing.id, status: existing.status });
    }
    await audit.record(tx, actor, {
      action: 'run.created', entityType: 'run', entityId: inserted.id, relatedRunId: inserted.id,
      context: { ledgerFileId: ledgerFile.id, settlementFileId: settlementFile.id, asOfDate, settingsVersion: current.version },
    });
    return repo.getRun(tx, inserted.id);
  });
}

module.exports = { createSchema, createRun, suggestAsOf };
