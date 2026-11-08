-- 0006: support "trace a reference" lookups across all uploaded files and runs.
-- References are stored upper-cased by the parsers, so plain btree indexes serve the exact-match lookup.
-- The existing (source_file_id, reference) indexes cannot be used when the file is not known.
CREATE INDEX ledger_entries_reference_idx     ON ledger_entries (reference);
CREATE INDEX settlement_lines_reference_idx   ON settlement_lines (reference);
CREATE INDEX match_results_reference_idx      ON match_results (reference) WHERE scope = 'TRANSACTION';
