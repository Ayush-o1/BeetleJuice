-- 0002: uploaded source files and their normalised records.
-- All money is bigint paise. Records are immutable once ingested so a
-- reconciliation run can always be traced to exactly the data it saw.

CREATE TABLE source_files (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind              text        NOT NULL CHECK (kind IN ('ledger', 'settlement')),
  original_filename text        NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  content_sha256    char(64)    NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes        integer     NOT NULL CHECK (size_bytes > 0),
  total_rows        integer     NOT NULL CHECK (total_rows >= 0),
  accepted_rows     integer     NOT NULL CHECK (accepted_rows >= 0),
  rejected_rows     integer     NOT NULL CHECK (rejected_rows >= 0),
  uploaded_by       bigint      NOT NULL REFERENCES users (id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (total_rows = accepted_rows + rejected_rows),
  CHECK (accepted_rows > 0)
);
-- Duplicate-file protection lives in the database, not only in the service:
-- two concurrent uploads of the same bytes cannot both succeed.
CREATE UNIQUE INDEX source_files_kind_sha_key ON source_files (kind, content_sha256);
CREATE INDEX source_files_uploaded_idx ON source_files (uploaded_at DESC);

CREATE TABLE ledger_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file_id  bigint      NOT NULL REFERENCES source_files (id),
  row_number      integer     NOT NULL CHECK (row_number > 0),
  ledger_id       text        NOT NULL,
  reference       text        NOT NULL,
  merchant        text        NOT NULL,
  entry_type      text        NOT NULL CHECK (entry_type IN ('PAYMENT', 'REFUND')),
  -- Signed: payments positive, refunds negative. Bounded to ±₹1 crore per entry
  -- so that sums over a 50,000-row file stay far below 2^53.
  amount_paise    bigint      NOT NULL CHECK (amount_paise <> 0 AND abs(amount_paise) <= 1000000000),
  currency        char(3)     NOT NULL CHECK (currency = 'INR'),
  recorded_at     timestamptz NOT NULL,
  -- Business date is always the calendar date in India Standard Time.
  business_date   date GENERATED ALWAYS AS ((recorded_at AT TIME ZONE 'Asia/Kolkata')::date) STORED,
  CHECK ((entry_type = 'PAYMENT' AND amount_paise > 0) OR (entry_type = 'REFUND' AND amount_paise < 0)),
  UNIQUE (source_file_id, ledger_id),
  UNIQUE (source_file_id, row_number)
);
CREATE INDEX ledger_entries_ref_idx ON ledger_entries (source_file_id, reference);

CREATE TABLE settlement_batches (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file_id        bigint  NOT NULL REFERENCES source_files (id),
  row_number            integer NOT NULL CHECK (row_number > 0),
  batch_ref             text    NOT NULL,
  settled_on            date    NOT NULL,
  declared_gross_paise  bigint  NOT NULL CHECK (abs(declared_gross_paise) <= 100000000000000),
  declared_fee_paise    bigint  NOT NULL CHECK (declared_fee_paise >= 0 AND declared_fee_paise <= 100000000000000),
  declared_payout_paise bigint  NOT NULL CHECK (abs(declared_payout_paise) <= 100000000000000),
  UNIQUE (source_file_id, batch_ref),
  UNIQUE (source_file_id, row_number)
);

CREATE TABLE settlement_lines (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file_id  bigint  NOT NULL REFERENCES source_files (id),
  row_number      integer NOT NULL CHECK (row_number > 0),
  line_id         text    NOT NULL,
  batch_ref       text    NOT NULL,
  reference       text    NOT NULL,
  txn_type        text    NOT NULL CHECK (txn_type IN ('SALE', 'REFUND')),
  -- Signed gross amount as reported by the processor: sales positive, refunds negative.
  amount_paise    bigint  NOT NULL CHECK (amount_paise <> 0 AND abs(amount_paise) <= 1000000000),
  fee_paise       bigint  NOT NULL CHECK (fee_paise >= 0 AND fee_paise <= abs(amount_paise)),
  currency        char(3) NOT NULL CHECK (currency = 'INR'),
  settled_on      date    NOT NULL,
  CHECK ((txn_type = 'SALE' AND amount_paise > 0) OR (txn_type = 'REFUND' AND amount_paise < 0)),
  UNIQUE (source_file_id, line_id),
  UNIQUE (source_file_id, row_number)
);
CREATE INDEX settlement_lines_ref_idx ON settlement_lines (source_file_id, reference);
CREATE INDEX settlement_lines_batch_idx ON settlement_lines (source_file_id, batch_ref);

-- Row-level problems found during ingestion. Rejected rows are never silently dropped.
CREATE TABLE source_row_errors (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file_id bigint  NOT NULL REFERENCES source_files (id),
  row_number     integer NOT NULL,
  line_number    integer NOT NULL,
  field          text,
  code           text    NOT NULL,
  message        text    NOT NULL,
  raw_excerpt    text
);
CREATE INDEX source_row_errors_file_idx ON source_row_errors (source_file_id, row_number);

CREATE TRIGGER source_files_immutable BEFORE UPDATE OR DELETE ON source_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER settlement_batches_immutable BEFORE UPDATE OR DELETE ON settlement_batches
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER settlement_lines_immutable BEFORE UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER source_row_errors_immutable BEFORE UPDATE OR DELETE ON source_row_errors
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
