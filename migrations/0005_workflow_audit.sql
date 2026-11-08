-- 0005: maker-checker workflow and the append-only audit log.

CREATE TABLE resolution_proposals (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  break_id       bigint  NOT NULL REFERENCES breaks (id),
  proposed_by    bigint  NOT NULL REFERENCES users (id),
  resolution_code text   NOT NULL CHECK (resolution_code IN (
                   'CORRECT_LEDGER', 'DISPUTE_WITH_PROCESSOR', 'RECOVER_DUPLICATE', 'WRITE_OFF', 'NO_ACTION')),
  note           text    NOT NULL CHECK (length(note) BETWEEN 10 AND 2000),
  break_version  integer NOT NULL,
  status         text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- Last line of defence against conflicting decisions: at most one open proposal per break and
-- at most one approved (final) proposal per break, whatever the application layer does.
CREATE UNIQUE INDEX proposals_one_pending_key  ON resolution_proposals (break_id) WHERE status = 'pending';
CREATE UNIQUE INDEX proposals_one_approved_key ON resolution_proposals (break_id) WHERE status = 'approved';
CREATE INDEX proposals_status_idx ON resolution_proposals (status, created_at);

-- Only the one-way move pending -> approved/rejected is allowed; every other column is frozen.
CREATE FUNCTION enforce_proposal_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'proposals cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal % is already %', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.break_id <> OLD.break_id OR NEW.proposed_by <> OLD.proposed_by OR NEW.resolution_code <> OLD.resolution_code
     OR NEW.note <> OLD.note OR NEW.break_version <> OLD.break_version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'proposal content is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER proposals_update_guard BEFORE UPDATE OR DELETE ON resolution_proposals
  FOR EACH ROW EXECUTE FUNCTION enforce_proposal_update();

CREATE TABLE resolution_decisions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id bigint  NOT NULL UNIQUE REFERENCES resolution_proposals (id),
  decided_by  bigint  NOT NULL REFERENCES users (id),
  decision    text    NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note        text,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (decision = 'approved' OR (note IS NOT NULL AND length(note) >= 5)),
  CHECK (note IS NULL OR length(note) <= 2000)
);
CREATE TRIGGER resolution_decisions_immutable BEFORE UPDATE OR DELETE ON resolution_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Maker-checker enforced in the database as well as the service: the decider must be an
-- active supervisor and must not be the person who proposed the resolution.
CREATE FUNCTION enforce_maker_checker() RETURNS trigger AS $$
DECLARE
  maker bigint;
  checker_role text;
BEGIN
  SELECT proposed_by INTO maker FROM resolution_proposals WHERE id = NEW.proposal_id;
  SELECT role INTO checker_role FROM users WHERE id = NEW.decided_by;
  IF maker = NEW.decided_by THEN
    RAISE EXCEPTION 'a proposal cannot be decided by its author' USING ERRCODE = 'restrict_violation';
  END IF;
  IF checker_role IS DISTINCT FROM 'supervisor' THEN
    RAISE EXCEPTION 'only a supervisor can decide a proposal' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER resolution_decisions_maker_checker BEFORE INSERT ON resolution_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_maker_checker();

-- Application-level append-only audit history. Triggers reject UPDATE, DELETE and TRUNCATE.
-- This is NOT tamper-proof: the table owner or a superuser can still drop the triggers.
CREATE TABLE audit_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  actor_user_id     bigint REFERENCES users (id),
  actor_username    text,
  actor_role        text,
  action            text   NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
  entity_type       text   NOT NULL,
  entity_id         text,
  related_run_id    bigint REFERENCES reconciliation_runs (id),
  related_break_id  bigint REFERENCES breaks (id),
  context           jsonb  NOT NULL DEFAULT '{}',
  ip                text,
  request_id        text
);
CREATE INDEX audit_events_time_idx ON audit_events (occurred_at DESC, id DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_break_idx ON audit_events (related_break_id) WHERE related_break_id IS NOT NULL;
CREATE INDEX audit_events_run_idx ON audit_events (related_run_id) WHERE related_run_id IS NOT NULL;
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id);
CREATE INDEX audit_events_action_idx ON audit_events (action);

CREATE TRIGGER audit_events_no_rowchange BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
