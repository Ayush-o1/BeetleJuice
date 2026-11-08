-- 0004: engine output (immutable) and the break work items built on top of it (mutable workflow state).

CREATE TABLE match_results (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id              bigint  NOT NULL REFERENCES reconciliation_runs (id),
  scope               text    NOT NULL CHECK (scope IN ('TRANSACTION', 'BATCH')),
  outcome             text    NOT NULL CHECK (outcome IN ('MATCHED', 'PENDING', 'BREAK')),
  break_type          text    CHECK (break_type IN (
                        'AMOUNT_MISMATCH', 'DUPLICATE_SETTLEMENT', 'MISSING_IN_LEDGER',
                        'MISSING_IN_SETTLEMENT', 'BATCH_PAYOUT_MISMATCH', 'FEE_VARIANCE',
                        'AMBIGUOUS_REFERENCE')),
  rule_id             text    NOT NULL CHECK (rule_id ~ '^R[0-9]{2}$'),
  explanation         text    NOT NULL,
  ledger_entry_id     bigint  REFERENCES ledger_entries (id),
  settlement_line_id  bigint  REFERENCES settlement_lines (id),
  batch_ref           text,
  reference           text,
  group_key           text,
  -- Signed: settlement amount minus ledger amount (fee variance: actual minus expected fee).
  amount_diff_paise   bigint,
  -- Unsigned "money at issue" used for ranking and amount-range filters.
  impact_paise        bigint  NOT NULL DEFAULT 0 CHECK (impact_paise >= 0),
  expected_fee_paise  bigint,
  actual_fee_paise    bigint,
  reference_date      date    NOT NULL,
  details             jsonb   NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'BREAK') = (break_type IS NOT NULL)),
  CHECK (
    (scope = 'TRANSACTION' AND batch_ref IS NULL AND (ledger_entry_id IS NOT NULL OR settlement_line_id IS NOT NULL))
    OR
    (scope = 'BATCH' AND batch_ref IS NOT NULL AND ledger_entry_id IS NULL AND settlement_line_id IS NULL)
  )
);
-- One-to-one is a database invariant: a record can appear in at most one result per run.
CREATE UNIQUE INDEX match_results_ledger_key ON match_results (run_id, ledger_entry_id) WHERE ledger_entry_id IS NOT NULL;
CREATE UNIQUE INDEX match_results_settlement_key ON match_results (run_id, settlement_line_id) WHERE settlement_line_id IS NOT NULL;
CREATE UNIQUE INDEX match_results_batch_key ON match_results (run_id, batch_ref) WHERE scope = 'BATCH';
CREATE INDEX match_results_run_outcome_idx ON match_results (run_id, outcome);
CREATE TRIGGER match_results_immutable BEFORE UPDATE OR DELETE ON match_results
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A break is the operational work item for one BREAK result. Descriptive columns are copied
-- from the (immutable) result so the queue can be filtered and sorted without joins.
CREATE TABLE breaks (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          bigint  NOT NULL REFERENCES reconciliation_runs (id),
  match_result_id bigint  NOT NULL UNIQUE REFERENCES match_results (id),
  break_type      text    NOT NULL,
  status          text    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_review', 'resolved')),
  -- Incremented on every status change; reviewers must quote the version they looked at.
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  side            text    NOT NULL CHECK (side IN ('ledger', 'settlement', 'both')),
  reference       text,
  batch_ref       text,
  impact_paise    bigint  NOT NULL CHECK (impact_paise >= 0),
  reference_date  date    NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolution_code text,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK ((status = 'resolved') = (resolution_code IS NOT NULL))
);
CREATE INDEX breaks_queue_idx ON breaks (status, break_type, reference_date);
CREATE INDEX breaks_run_idx ON breaks (run_id);
CREATE INDEX breaks_reference_idx ON breaks (reference);
CREATE INDEX breaks_batch_idx ON breaks (batch_ref) WHERE batch_ref IS NOT NULL;

CREATE FUNCTION enforce_break_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'breaks cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'break % is resolved and can no longer change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status = 'pending_review') OR
       (OLD.status = 'pending_review' AND NEW.status IN ('open', 'resolved'))
     ) THEN
    RAISE EXCEPTION 'illegal break transition % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.run_id <> OLD.run_id OR NEW.match_result_id <> OLD.match_result_id
     OR NEW.break_type <> OLD.break_type OR NEW.impact_paise <> OLD.impact_paise THEN
    RAISE EXCEPTION 'break identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER breaks_transition BEFORE UPDATE OR DELETE ON breaks
  FOR EACH ROW EXECUTE FUNCTION enforce_break_transition();

CREATE TABLE break_notes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  break_id   bigint NOT NULL REFERENCES breaks (id),
  author_id  bigint NOT NULL REFERENCES users (id),
  body       text   NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX break_notes_break_idx ON break_notes (break_id, created_at);
CREATE TRIGGER break_notes_immutable BEFORE UPDATE OR DELETE ON break_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
