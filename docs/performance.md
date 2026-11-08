# Performance

Measured with `npm run bench -- --browser` on 2026-11-08 (re-measured for v1.1.0; the figures below replace the v1.0.0 run): Apple M4 (10 cores), Node 24.22, PostgreSQL 18.6 on the same machine,
default configuration, a throwaway `beetlejuice_bench` database. Synthetic data: 45,000 ledger rows and 44,556
settlement lines plus batch rows (3.4 MiB and 3.1 MiB), ~2% missing, ~3% amount mismatches, ~1% duplicated.

| Step | Time |
|---|---:|
| Ingest ledger (decode, parse, validate, bulk insert, audit) | 1.49 s |
| Ingest settlement | 1.61 s |
| Run end to end (load rows → reconcile → persist 45,428 results and 2,313 breaks → audit) | 2.00 s |
| of which the engine itself | 0.36 s |
| Break queue page (unresolved, age desc, 2,313 breaks) | 12.6 ms |
| Break queue, type + amount filter + sort | 2.1 ms |
| Break queue, reference contains | 3.0 ms |
| Audit log latest 50 / run results page | 1.4 ms / 1.2 ms |
| RSS growth during the above | ≈ 184 MiB |
| Database size afterwards | 57 MB |

### HTTP API through the real Express app

Median of 7 warm calls, same machine, same data (the numbers include JSON serialisation but not network latency):

| Endpoint | Median |
|---|---:|
| `GET /api/overview` (counts, ageing buckets, recent activity) | 5.1 ms |
| `GET /api/breaks?status=unresolved` (page 1 of 25) | 9.4 ms |
| `GET /api/breaks/:id` (detail with both records, batch context, timeline) | 2.6 ms |
| `GET /api/trace` for a reference with a break / a matched reference / an unknown one | 1.4 / 1.3 / 1.2 ms |
| `GET /api/runs/:id` | 1.1 ms |

The trace lookup depends on migration 0006 (`ledger_entries(reference)`, `settlement_lines(reference)`, `match_results(reference)`);
without those indexes the existing `(source_file_id, reference)` indexes cannot be used when the file is unknown.

### Browser (Chrome, headless, 1440×900, same machine)

Time from changing the route inside the app to the screen's data being on screen, and the main-thread time spent in long tasks
(>50 ms) meanwhile. Data: the 45k-row database above (the break queue holds 2,313 unresolved breaks, 25 rendered per page).

| Screen | Data on screen | Long-task blocking |
|---|---:|---:|
| Overview | 24 ms | 0 ms |
| Break queue (25 of 2,313) | 59 ms | 0 ms |
| Break queue with a type filter | 33 ms | 0 ms |
| Break detail | 21 ms | 0 ms |
| Trace a reference | 19 ms | 0 ms |
| Run summary | 38 ms | 0 ms |

Headless Chrome on a fast machine over loopback: these show that nothing in the front end is slow, not what a user on a slow
network would see. Tables render a fixed number of rows per page, so render time does not grow with the dataset.

### Scenario generator and engine on the larger synthetic sizes

Median of 5 runs of the `break-storm` scenario (parse + engine are the same code paths as production; no database), `scripts/lib/scenario-library.js`:

| Size | Rows (both files) | Generate | Parse + validate | Engine |
|---|---:|---:|---:|---:|
| small | 34 | <1 ms | 1 ms | <1 ms |
| normal | 297 | 1 ms | 2 ms | 1 ms |
| large | 2,832 | 9 ms | 19 ms | 6 ms |
| xl | 28,212 | 98 ms | 170 ms | 58 ms |

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
