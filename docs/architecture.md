# Architecture

BeetleJuice is a single Node.js process (Express) backed by one PostgreSQL database, serving a vanilla-JS
single-page frontend from the same origin. A reconciliation worker runs inside that process by default and
can be started separately (`npm run worker`).

```
 Browser (vanilla ES modules, hash router)
    │  fetch, same-origin cookie + X-CSRF-Token
    ▼
 Express app  (src/app.js)
    ├─ middleware: request id/log → helmet CSP → JSON body → session → CSRF
    ├─ modules/*  routes ─► service ─► repo (SQL)         ┐
    │                                                      ├─► PostgreSQL
    └─ worker (run.worker.js) ─► engine (pure) ─► repo    ┘
                     └────────► uploads/ (content-addressed CSV bytes, outside public/)
```

## Layout

| Path | Responsibility |
|---|---|
| `src/config` | Validates environment variables once at start-up (zod) and returns a frozen object. |
| `src/lib` | Pure helpers: `money` (paise parse/format), `rate` (exact fee maths), `dates` (IST rules), `errors`, `permissions`, `paging`, `csv-export`, `hash`, `validate`. |
| `src/db` | Pool (with type parsers for `bigint`/`date`), transaction helper, migration runner. |
| `src/middleware` | Request context, session loading, `requirePermission`, CSRF, rate limiter, central error handler. |
| `src/modules/auth` | scrypt passwords, session repository (hashed tokens), login/logout service, routes. |
| `src/modules/sources` | CSV structure + row validators, upload service (transactional ingest), storage, routes. |
| `src/modules/engine` | **Pure** reconciliation: passes R01–R09, batch pass, summary. No I/O, no clock. |
| `src/modules/runs` | Run creation (snapshot + fingerprint), durable worker, results queries. |
| `src/modules/breaks` | Break queue, detail assembly, notes, CSV export. |
| `src/modules/resolutions` | Maker-checker: propose and decide, with locking. |
| `src/modules/audit`, `settings`, `overview` | Audit recording/querying, versioned settings, dashboard figures. |
| `public/` | Frontend: `css/` design tokens + components, `js/` modules, `js/views/` one file per screen. |
| `migrations/` | Ordered SQL files; applied by `npm run migrate`. |
| `scripts/` | migrate, create-db, create-user, demo data + reset, benchmark, syntax check. |

Dependencies are injected: `createApp({config, pool, logger, storage})`. Nothing reads `process.env` outside
`config` and the CLI scripts, so tests run an isolated app against a disposable database.

## Request lifecycle

1. `requestContext` assigns a request id (returned as `X-Request-Id`, logged, stored on audit rows).
2. `helmet` applies a strict CSP (`script-src 'self'`, no inline script/style) and standard headers.
3. `loadSession` resolves the `bj_session` cookie to a user; `csrfProtection` checks Fetch-Metadata/Origin
   and, for authenticated writes, the `X-CSRF-Token` header.
4. A route calls `requirePermission('…')`, validates input with zod, and calls a service.
5. The service opens a transaction where it needs one, calls repositories (plain SQL, bind parameters) and
   writes the audit row **in the same transaction** as the change it describes.
6. Errors flow to one handler: `AppError` → its status/code; database rule violations → 409; anything else →
   logged with a stack, answered with a generic 500.

## Data flows

**Upload.** Raw `text/csv` body (limit `MAX_UPLOAD_BYTES`) → strict UTF-8 decode → CSV parse → header contract →
per-row validation (rows with problems are collected, not dropped) → one transaction: insert the
`source_files` row (the unique `(kind, sha256)` index decides duplicates), bulk-insert records and row errors,
write the bytes to `UPLOAD_DIR/<sha256>.csv`, write the audit event.

**Run.** `POST /api/runs` freezes the settings version, as-of date, engine version and input hashes into
`config_snapshot`, computes an input fingerprint (unique among non-failed runs) and inserts a `queued` row.
The worker claims it, loads both sources, calls the pure engine, and in one transaction writes all results,
creates a `breaks` row per break result, marks the run `completed` and writes audit rows.

**Resolution.** Propose: lock break → check `open` + version → insert proposal → break `pending_review`.
Decide: lock break, then proposal → check not self, still pending, version matches → insert decision, mark
proposal, move break to `resolved` or back to `open`. All with audit rows, one transaction.

## Background processing

`reconciliation_runs` is the queue. See [ADR 0005](decisions/0005-run-table-as-job-queue.md). Claiming uses
`FOR UPDATE SKIP LOCKED`; a lease (`RUN_LEASE_SECONDS`, extended by a heartbeat) lets another worker reclaim
a crashed worker's run; `attempts`/`max_attempts` bound retries; results are written only if the run is still
`running` and `locked_by` is this worker (fencing). Failed attempts re-queue until attempts are exhausted.

## Frontend

Hash-routed SPA of ES modules; no framework, no build. `dom.js` builds nodes with `createElement`/
`textContent` (never `innerHTML` with data). `ui.js` holds shared components (tables, badges, dialogs,
async regions with loading/error states). Filters live in the URL query so views are linkable and back/forward
work. `permissions` from `/api/auth/session` only decide which controls to show; the server enforces everything.

## Time

Instants carry an explicit UTC offset on input and are stored as `timestamptz`. The business calendar is IST
(UTC+05:30); `ledger_entries.business_date` is a generated column `(recorded_at AT TIME ZONE 'Asia/Kolkata')::date`.
Plain dates are `YYYY-MM-DD` strings end to end (the `pg` date parser is overridden), and the UI formats them
without constructing `Date` objects. Every displayed timestamp is labelled IST.
