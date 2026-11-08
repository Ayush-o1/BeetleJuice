-- 0003: versioned reconciliation settings and the run queue.

-- Settings are append-only. "Current settings" is simply the highest version, and each
-- run copies the values it used into its own snapshot, so later edits never rewrite history.
CREATE TABLE settings_versions (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version                integer      NOT NULL UNIQUE CHECK (version > 0),
  amount_tolerance_paise integer      NOT NULL CHECK (amount_tolerance_paise BETWEEN 0 AND 100000),
  fee_rate_percent       numeric(7,4) NOT NULL CHECK (fee_rate_percent BETWEEN 0 AND 20),
  fee_tolerance_paise    integer      NOT NULL CHECK (fee_tolerance_paise BETWEEN 0 AND 100000),
  settlement_window_days integer      NOT NULL CHECK (settlement_window_days BETWEEN 0 AND 30),
  changed_by             bigint REFERENCES users (id),
  note                   text,
  created_at             timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER settings_versions_immutable BEFORE UPDATE OR DELETE ON settings_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO settings_versions
  (version, amount_tolerance_paise, fee_rate_percent, fee_tolerance_paise, settlement_window_days, note)
VALUES (1, 0, 2.0000, 1, 2, 'Initial defaults');

-- A run is both the unit of work and its own job record: workers claim queued runs
-- directly (see src/modules/runs/run.repo.js), so no separate queue table is needed.
CREATE TABLE reconciliation_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status            text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  ledger_file_id    bigint      NOT NULL REFERENCES source_files (id),
  settlement_file_id bigint     NOT NULL REFERENCES source_files (id),
  as_of_date        date        NOT NULL,
  -- Frozen copy of the rule configuration and input identities used by this run.
  config_snapshot   jsonb       NOT NULL,
  -- SHA-256 over input hashes + canonical config. Identical work cannot be queued twice.
  input_fingerprint char(64)    NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by        bigint      NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  attempts          integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts      integer     NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  locked_by         text,
  lease_expires_at  timestamptz,
  error_code        text,
  error_message     text,
  summary           jsonb,
  CHECK (status <> 'running' OR (locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'completed' OR (finished_at IS NOT NULL AND summary IS NOT NULL)),
  CHECK (status <> 'failed' OR (finished_at IS NOT NULL AND error_code IS NOT NULL))
);
-- Failed runs may be repeated; queued/running/completed runs may not duplicate each other.
CREATE UNIQUE INDEX runs_fingerprint_active_key ON reconciliation_runs (input_fingerprint)
  WHERE status <> 'failed';
CREATE INDEX runs_claim_idx ON reconciliation_runs (status, created_at);

CREATE FUNCTION enforce_run_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation runs cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'run % is % and can no longer change', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'queued'  AND NEW.status = 'running') OR
       (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'queued'))
     ) THEN
    RAISE EXCEPTION 'illegal run transition % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.ledger_file_id <> OLD.ledger_file_id OR NEW.settlement_file_id <> OLD.settlement_file_id
     OR NEW.config_snapshot <> OLD.config_snapshot OR NEW.as_of_date <> OLD.as_of_date THEN
    RAISE EXCEPTION 'run inputs and configuration are frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER runs_transition BEFORE UPDATE OR DELETE ON reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION enforce_run_transition();
