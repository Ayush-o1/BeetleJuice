# Performance

Measured with `npm run bench` on 2026-11-08: Apple M4 (10 cores), Node 24.22, PostgreSQL 18.6 on the same machine,
default configuration, a throwaway `beetlejuice_bench` database. Synthetic data: 45,000 ledger rows and 44,556
settlement lines plus batch rows (3.4 MiB and 3.1 MiB), ~2% missing, ~3% amount mismatches, ~1% duplicated.

| Step | Time |
|---|---:|
| Ingest ledger (decode, parse, validate, bulk insert, audit) | 1.32 s |
| Ingest settlement | 1.38 s |
| Run end to end (load rows → reconcile → persist 45,428 results and 2,313 breaks → audit) | 1.89 s |
| of which the engine itself | 0.35 s |
| Break queue page (unresolved, age desc, 2,313 breaks) | 13.6 ms |
| Break queue, type + amount filter + sort | 1.8 ms |
| Break queue, reference contains | 2.6 ms |
| Audit log latest 50 / run results page | 0.8 ms / 0.6 ms |
| RSS growth during the above | ≈ 180 MiB |
| Database size afterwards | 53 MB |

Your numbers will differ; rerun the script. It is a single run, not a statistical benchmark.

## Observations and decisions

* Bulk inserts use `INSERT … SELECT FROM unnest(arrays)` in chunks of 2,000 rows: one round trip per chunk
  instead of per row.
* The engine groups by key in a `Map` and sorts once; it is O(n log n). It runs synchronously, so a very large
  run briefly occupies the event loop when the worker is in-process. For files near the 50,000-row limit that is
  about a third of a second; if inputs grow much larger, run the worker separately (`WORKER_IN_PROCESS=false`,
  `npm run worker`).
* The queue's ordering uses an expression (age) so the first page scans and sorts the unresolved set; at 2.3k
  breaks that is 14 ms. If the queue reached hundreds of thousands of rows an index on
  `(status, reference_date)` or keyset pagination would be the next step; it was not added speculatively.
* `reference ILIKE '%…%'` cannot use a b-tree index. At this size it is fast; `pg_trgm` would be the upgrade.
* The ingest path holds the whole file in memory (limit 10 MiB by default). Streaming parsing was not
  introduced because the row limit already bounds memory and the simple path is easier to reason about.
* Frontend: tables are paged (25–50 rows) so rendering cost is constant; no virtualisation is needed.
