# API reference

JSON over HTTP, same origin as the UI. All paths are under `/api`. Authentication is the `bj_session` cookie
(HttpOnly, SameSite=Strict, `Secure` in production). Every state-changing request from a signed-in user must
send `X-CSRF-Token` (the value returned by login / `GET /auth/session`).

**Success:** `{ "data": … }`; lists add `{ "page": { "number", "size", "total", "pages" } }` and accept
`page` (default 1) and `pageSize` (default 25, max 100).
**Error:** `{ "error": { "code", "message", "details"?, "requestId" } }`.

| Status | Meaning |
|---|---|
| 400 | `VALIDATION_FAILED` (with `details.issues[]`), `BAD_JSON`, `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED` (also bad login: generic message) |
| 403 | `FORBIDDEN` (role), CSRF/origin failure, `SELF_DECISION_FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `DUPLICATE_FILE`, `DUPLICATE_RUN`, `BREAK_CHANGED`, `BREAK_NOT_OPEN`, `BREAK_RESOLVED`, `PROPOSAL_ALREADY_DECIDED`, `SETTINGS_STALE`, `CONFLICT_*` (database rule) |
| 413/415 | body too large / wrong content type |
| 422 | file-level CSV problems: `CSV_HEADER_INVALID`, `CSV_EMPTY`, `CSV_MALFORMED`, `CSV_ENCODING`, `CSV_NOT_TEXT`, `CSV_TOO_MANY_ROWS`, `NO_VALID_ROWS`, `UNSUPPORTED_FILE_TYPE`, `INVALID_*_SOURCE` |
| 429 | login rate limit |
| 500 | `INTERNAL_ERROR` (generic; details only in the server log, keyed by `requestId`) |

Unknown JSON keys are rejected (strict schemas), so clients cannot set protected fields such as `status`.

Roles: **A**nalyst, **S**upervisor, **U** (auditor). "all" = any signed-in role.

## Auth

| Method & path | Roles | Notes |
|---|---|---|
| `POST /auth/login` | public | `{username, password}` → `{user, csrfToken, permissions}`; rate-limited per IP; 5 failures lock the account 15 min |
| `POST /auth/logout` | all | destroys the server-side session; 204 |
| `GET /auth/session` | public | same payload as login, or `{data: null}` when signed out |
| `GET /auth/me` | all | 401 when signed out |
| `GET /health` | public | `{status: "ok"}` or 503 |

## Sources

| Method & path | Roles | Notes |
|---|---|---|
| `GET /sources?kind=&page=` | all | list with row counts and usage |
| `POST /sources/ledger` \| `/sources/settlement` | A | body = raw CSV, `Content-Type: text/csv`, header `X-Filename: <url-encoded name>`. 201 `{file, errors:{rejectedRows, byCode, sample[]}}`; 409 duplicate; 422 file rejected |
| `GET /sources/:id` | all | metadata, totals, `errorsByCode` |
| `GET /sources/:id/errors` | all | rejected rows (paged) |
| `GET /sources/:id/records?q=&view=lines\|batches` | all | normalised records (paged) |

Example (Postman: *Body → binary*, header `Content-Type: text/csv`):

```bash
curl -b cookies -H "X-CSRF-Token: $CSRF" -H "Content-Type: text/csv" -H "X-Filename: ledger-nov.csv" \
     --data-binary @demo-data/ledger-2026-11.csv http://localhost:3000/api/sources/ledger
```

## Runs

| Method & path | Roles | Notes |
|---|---|---|
| `GET /runs?status=` | all | history with summaries |
| `POST /runs` | A | `{ledgerFileId, settlementFileId, asOfDate?}` → 202 `queued` run; 409 if an identical run exists |
| `GET /runs/suggest?ledgerFileId=&settlementFileId=` | all | default as-of date |
| `GET /runs/rules` | all | rule catalogue |
| `GET /runs/:id` | all | status, attempts, error, summary, frozen `config` |
| `GET /runs/:id/results?outcome=&type=&scope=&q=&sort=` | all | every record's outcome (`sort` ∈ reference, outcome, rule, impact, date) |

## Breaks and resolutions

| Method & path | Roles | Notes |
|---|---|---|
| `GET /breaks` | all | filters: `status` (open, pending_review, resolved, unresolved), `type`, `side`, `runId`, `batch`, `q` (reference contains), `minAmount`/`maxAmount` (rupees), `minAge`/`maxAge` (days), `from`/`to` (reference date); `sort=<age\|impact\|date\|type\|status\|reference\|created>:<asc\|desc>` |
| `GET /breaks/export.csv` | all | same filters; formula-neutralised CSV (max 10,000 rows) |
| `GET /breaks/:id` | all | result, rule, ledger/settlement records, related records, batch context, notes, proposals, timeline |
| `POST /breaks/:id/notes` | A | `{body}`; not on resolved breaks |
| `POST /breaks/:id/proposals` | A | `{resolutionCode, note, breakVersion}`; 409 `BREAK_CHANGED` if the version moved |
| `GET /proposals?status=pending\|approved\|rejected\|all` | all | review queue |
| `GET /proposals/:id` | all | |
| `POST /proposals/:id/decision` | S | `{decision: approved\|rejected, note?, breakVersion}`; reject needs a note; never by the proposer |

`resolutionCode` ∈ `CORRECT_LEDGER`, `DISPUTE_WITH_PROCESSOR`, `RECOVER_DUPLICATE`, `WRITE_OFF`, `NO_ACTION`.
Resolutions record a decision only; the simulation does not post anything to a ledger or processor.

## Settings, audit, overview

| Method & path | Roles | Notes |
|---|---|---|
| `GET /settings`, `GET /settings/history` | all | current / versions |
| `PUT /settings` | S | `{amountTolerancePaise, feeRatePercent, feeTolerancePaise, settlementWindowDays, expectedVersion, note?}` → new version; 409 `SETTINGS_STALE` |
| `GET /audit?action=&entityType=&actor=&runId=&breakId=&from=&to=` | S, U | `action=auth.` matches the family; dates are IST days |
| `GET /audit/actions`, `GET /audit/export.csv` | S, U | |
| `GET /overview` | all | figures computed from persisted data |
